const { Client, GatewayIntentBits, Events, ChannelType } = require('discord.js');
const pdfParse = require('pdf-parse');
require('dotenv').config();
const {
  extractReportFields,
  cleanName,
  parseFilename,
  buildTemplate,
} = require('./report-parser');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // #報告資料 の添付ファイルを読むために必須
  ],
});

// #報告資料(資料が投稿されるチャンネル)
const REPORT_CHANNEL_ID = process.env.REPORT_CHANNEL_ID;
// 議事録(フォーラムチャンネル)
const MINUTES_FORUM_ID = process.env.MINUTES_FORUM_ID;

client.once(Events.ClientReady, (c) => {
  console.log(`ログイン完了: ${c.user.tag}`);
});

// 日本時間で今日の日付を YYYY/MM/DD 形式にする
function getTodayJST() {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}/${m}/${d}`;
}

// ---------------------------------------------
// /report スラッシュコマンド(手動実行用)
// ---------------------------------------------
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'report') return;

  await interaction.deferReply();

  const type = interaction.options.getString('type');
  const pdfAttachment = interaction.options.getAttachment('pdf');

  let extracted = { title: null, name: null, reportContent: null, conclusion: null };

  if (pdfAttachment) {
    try {
      const res = await fetch(pdfAttachment.url);
      const buffer = Buffer.from(await res.arrayBuffer());
      const parsed = await pdfParse(buffer);
      extracted = extractReportFields(parsed.text);
    } catch (err) {
      console.error('PDF解析エラー:', err);
      await interaction.editReply('PDFの読み込みに失敗しました。手入力のオプションで実行し直してください。');
      return;
    }
  }

  const title = interaction.options.getString('title') ?? extracted.title ?? '';
  const name =
    interaction.options.getString('name') ??
    extracted.name ??
    interaction.member?.displayName ??
    interaction.user.username;

  const template = buildTemplate({
    dateStr: getTodayJST(),
    type,
    name,
    title,
    reportContent: extracted.reportContent,
    conclusion: extracted.conclusion,
  });

  await interaction.editReply({ content: template });
});

// ---------------------------------------------
// #報告資料 へのPDF投稿を検知 → 対応する議事録スレッドに自動反映
// ---------------------------------------------
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!REPORT_CHANNEL_ID || message.channelId !== REPORT_CHANNEL_ID) return;

  const pdfAttachments = message.attachments.filter((a) =>
    a.name?.toLowerCase().endsWith('.pdf'),
  );
  if (pdfAttachments.size === 0) return;

  for (const attachment of pdfAttachments.values()) {
    try {
      await handleReportPdf(message, attachment);
    } catch (err) {
      console.error('議事録スレッド反映エラー:', err);
      await message.reply(`⚠️ ${attachment.name} の処理中にエラーが発生しました。`);
    }
  }
});

// 対象スレッドに「①元のメッセージ(PDF)をDiscordのネイティブ転送機能で転送 → ②議事録テンプレートを投稿」の順で送る
// message.forward() はファイルを再アップロードしないため、日本語ファイル名なども完全に保持される
async function postToThread(thread, message, template) {
  await message.forward(thread); // ① 転送
  await thread.send({ content: template }); // ② テンプレート作成
}

async function handleReportPdf(message, attachment) {
  const res = await fetch(attachment.url);
  const buffer = Buffer.from(await res.arrayBuffer());
  const parsed = await pdfParse(buffer);
  const extracted = extractReportFields(parsed.text);
  const fromFilename = parseFilename(attachment.name);

  // 「日付が取れているか」を PDF が想定フォーマットかどうかの判定基準にする。
  // 取れていない場合、氏名の抽出結果は信頼できないため
  // Discordのユーザー名などにフォールバックせず「認識できなかった」ものとして扱う。
  const isRecognized = Boolean(extracted.date);
  const resolvedName = isRecognized ? (cleanName(extracted.name) || fromFilename.name) : null;

  const type = fromFilename.type || '報告会';
  const dateStr = extracted.date || getTodayJST();

  const template = buildTemplate({
    dateStr,
    type,
    name: resolvedName || `(氏名認識失敗: ${message.author.username})`,
    title: extracted.title,
    reportContent: extracted.reportContent,
    conclusion: extracted.conclusion,
  });

  if (!MINUTES_FORUM_ID) {
    await message.reply('⚠️ 議事録フォーラムの設定(MINUTES_FORUM_ID)がされていません。');
    return;
  }

  const forumChannel = await message.client.channels.fetch(MINUTES_FORUM_ID);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    await message.reply('⚠️ MINUTES_FORUM_ID がフォーラムチャンネルを指していません。');
    return;
  }

  const FALLBACK_THREAD_NAME = 'ERROR';

  const active = await forumChannel.threads.fetchActive();
  const archived = await forumChannel.threads.fetchArchived();
  const allThreads = [...active.threads.values(), ...archived.threads.values()];
  const fallbackThread = allThreads.find((t) => t.name === FALLBACK_THREAD_NAME);

  // フォーマットを認識できなかった場合: 氏名で検索せず即ERRORへ
  if (!isRecognized || !resolvedName) {
    const reason = !isRecognized
      ? 'PDF内に日付(YYYY/MM/DD)が見つからず、想定フォーマットと判断できませんでした'
      : '氏名を特定できませんでした(PDF・ファイル名のどちらからも取得失敗)';

    if (fallbackThread) {
      await postToThread(fallbackThread, message, template);
      await message.reply(
        `⚠️ ${attachment.name}: ${reason}。"${FALLBACK_THREAD_NAME}"スレッドに転送・投稿したので、手動で確認・振り分けをお願いします。`,
      );
    } else {
      await message.reply(
        `⚠️ ${attachment.name}: ${reason}。さらに"${FALLBACK_THREAD_NAME}"スレッドも見つからないため、投稿できませんでした。手動で対応してください。`,
      );
    }
    return;
  }

  const threadName = `${resolvedName}_議事録`;
  const existing = allThreads.find((t) => t.name === threadName);

  if (existing) {
    await postToThread(existing, message, template);
    const warnings = [];
    if (!extracted.reportContent) warnings.push('報告内容');
    if (!extracted.conclusion) warnings.push('結言');
    const warningNote = warnings.length
      ? `\n⚠️ ${warnings.join('・')}の見出しが検出できず、テンプレートの該当欄が空欄です。手動で確認してください。`
      : '';
    await message.reply(
      `✅ ${resolvedName}さんの議事録スレッドにPDFとテンプレートを追加しました: <#${existing.id}>${warningNote}`,
    );
    return;
  }

  // 氏名は認識できたが対応スレッドが見つからない場合も、新規作成はせずERRORへ
  if (fallbackThread) {
    await postToThread(fallbackThread, message, template);
    await message.reply(
      `⚠️ ${resolvedName}さんの議事録スレッドが見つからなかったため、"${FALLBACK_THREAD_NAME}"スレッドに転送・投稿しました: <#${fallbackThread.id}>\nお手数ですが手動で振り分けてください。`,
    );
  } else {
    await message.reply(
      `⚠️ ${resolvedName}さんの議事録スレッドが見つからず、"${FALLBACK_THREAD_NAME}"スレッドも見つかりませんでした。手動で対応してください。`,
    );
  }
}

client.login(process.env.DISCORD_TOKEN);
