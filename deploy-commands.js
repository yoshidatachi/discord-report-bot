const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
  new SlashCommandBuilder()
    .setName('report')
    .setDescription('Gセミ/報告会用のテンプレートを生成します')
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('種別')
        .setRequired(true)
        .addChoices(
          { name: 'Gセミ', value: 'Gセミ' },
          { name: '報告会', value: '報告会' },
        ),
    )
    .addAttachmentOption((option) =>
      option
        .setName('pdf')
        .setDescription('報告書PDF(指定するとタイトル/氏名/報告内容/結言を自動抽出)')
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription('タイトル(PDF指定時は上書き)')
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('発表者名(省略時はPDFから抽出 → あなたの表示名)')
        .setRequired(false),
    )
    .toJSON(),
];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('スラッシュコマンドを登録中...');

    // まずはサーバー限定登録(反映が速い)。全サーバーに公開したい場合は
    // applicationGuildCommands → applicationCommands に変更してください。
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands },
    );

    console.log('登録完了!Discordで /report を試してみてください。');
  } catch (error) {
    console.error(error);
  }
})();
