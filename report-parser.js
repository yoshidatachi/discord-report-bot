// PDFのテキストから タイトル/日付/氏名/報告内容/結言 を抜き出す
// 「N. 見出し」「N.N. 見出し」のような番号付き見出し構造を前提とした簡易パーサー
function extractReportFields(rawText) {
  // ページ番号だけの行(単独の数字)を除去
  const lines = rawText.split('\n').filter((l) => !/^\s*\d{1,3}\s*$/.test(l));
  const text = lines.join('\n');

  const result = { date: null, title: null, name: null, reportContent: null, conclusion: null };

  // 報告日のよみとり
  const dateMatch = text.match(/\d{4}\/\d{1,2}\/\d{1,2}/);
  if (!dateMatch) return result;
  const rawDate = dateMatch[0]; // 位置特定にはPDF内の元の表記をそのまま使う
  const [y, m, d] = rawDate.split('/');
  result.date = `${y}/${m.padStart(2, '0')}/${d.padStart(2, '0')}`; // 表示用に2桁へ正規化

  const idx = text.indexOf(rawDate);
  const before = text.slice(0, idx).trim();
  result.title = before.replace(/\n/g, ' ').trim();
  const after = text.slice(idx + rawDate.length).trim();
  result.name = after.split('\n')[0].trim();

  // 次の見出し行にマッチする共通パターン
  // 番号(1 / 1.2 など)の後に「ピリオド(.or．)」または「空白」のどちらか一方があれば見出しとみなす
  // 例: "1. 諸言" "4．結言"(ピリオド直後にスペースなし) "1.2 報告内容"(ピリオドなし) いずれもOK
  const SEPARATOR = '(?:[.．]\\s*|\\s+)';
  const HEADING_RE = new RegExp(`^\\s*\\d+(?:\\.\\d+)*${SEPARATOR}\\S+.*$`, 'm');

  function extractSection(label) {
    const pattern = new RegExp(`^\\s*\\d+(?:\\.\\d+)*${SEPARATOR}${label}\\s*$`, 'm');
    const m = pattern.exec(text);
    if (!m) return null;
    const start = m.index + m[0].length;
    const rest = text.slice(start);
    const next = HEADING_RE.exec(rest);
    const end = next ? start + next.index : text.length;
    return rest.slice(0, end - start).trim();
  }

  result.reportContent = extractSection('報告内容');
  result.conclusion = extractSection('結言');

  return result;
}

// 「AC21059 吉田匠吾」のような 学籍番号+氏名 の表記から氏名だけを取り出す
function cleanName(rawName) {
  if (!rawName) return rawName;
  const stripped = rawName.replace(/^[A-Za-z0-9]+\s+/, '').trim();
  return stripped || rawName;
}

// 正規表現の特殊文字をエスケープする
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

// 種別(Gセミ/報告会)を検出するためのパターン
// 「G」と「セミ」、「グル」と「セミ」の間にアンダースコアや空白が入っていても検出できるようにしている
// 新しい表記が見つかったら、ここにパターンを1行追加するだけで対応可能
const TYPE_PATTERNS = [
  { canonical: 'Gセミ', pattern: /[gｇＧ][ _　]?セミ/i },
  { canonical: 'Gセミ', pattern: /グル[ _]?セミ/ },
  { canonical: '報告会', pattern: /報告会/ },
];

function detectType(text) {
  for (const { canonical, pattern } of TYPE_PATTERNS) {
    const m = text.match(pattern);
    if (m) return { canonical, matched: m[0] };
  }
  return null;
}

// 単体の文字列(例: "グルセミ")を正規化したい場合に使う
function normalizeType(rawType) {
  if (!rawType) return rawType;
  const match = detectType(rawType);
  return match ? match.canonical : rawType.trim();
}

// ファイル名(例: 2026-0724_報告会_吉田匠吾.pdf)から 種別 と 氏名 を推測する。
//
// 【背景】Discordの仕様上、添付ファイルのファイル名に含まれる日本語部分が
// 変換の過程で失われる/文字化けすることがある(絵文字や特定の記号との組み合わせ等で発生しやすい)。
// そのため「グルセミ」「報告会」のような日本語の見出し全体が読み取れないケースが実際に発生した。
// 一方で、半角/全角の英字("G"など)はこの現象の影響を受けにくく、生き残ることが多い。
//
// 【方針】
//   1. まずファイル名全体から「Gセミ」「グルセミ」「報告会」等のフルテキストとしての一致を試みる(最も正確)
//   2. 1で見つからず、かつ半角/全角の"G"が1文字でも含まれていれば「Gセミ」とみなす(フォールバック)
//   3. 1にも2にも該当しなければ種別は不明(呼び出し側で「報告会」がデフォルト採用される)
//
// 日本語がまるごと失われた場合(「グルセミ」が跡形もなく消えるケースなど)は
// 2のGフォールバックも効かないため、その場合は3の挙動(報告会扱い)になる制約がある。
function parseFilename(filename) {
  const base = filename.replace(/\.pdf$/i, '');
  const result = { type: null, name: null };

  let rest = base;

  const typeMatch = detectType(base);
  if (typeMatch) {
    result.type = typeMatch.canonical;
    rest = rest.replace(new RegExp(escapeRegExp(typeMatch.matched)), '');
  } else if (/[gｇＧ]/i.test(base)) {
    result.type = 'Gセミ';
    rest = rest.replace(/[gｇＧ]/i, '');
  }

  rest = rest.replace(/\d{4}-?\d{2}-?\d{2}/, ''); // 日付部分を除去
  rest = rest.replace(/_+/g, '_').replace(/^_+|_+$/g, ''); // 余分な"_"を整理

  result.name = rest || null;

  return result;
}

// テンプレート文字列を組み立てる
function buildTemplate({ dateStr, type, name, title, reportContent, conclusion }) {
  return [
    `${dateStr} ${type} ${name}`,
    `## ${title || ''}`,
    `### 報告内容`,
    reportContent || '',
    ``,
    `### 結言`,
    conclusion || '',
    ``,
    `### 議論`,
    ``,
  ].join('\n');
}

module.exports = { extractReportFields, cleanName, parseFilename, normalizeType, buildTemplate };
