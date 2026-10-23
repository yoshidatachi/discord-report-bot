// PDFのテキストからタイトル、日付、氏名、報告内容、結言を抽出する
function extractReportFields(rawText) {
  const lines = rawText.split('\n').filter((l) => !/^\s*\d{1,3}\s*$/.test(l));
  const text = lines.join('\n');

  const result = { date: null, title: null, name: null, reportContent: null, conclusion: null };

  const dateMatch = text.match(/\d{4}\/\d{1,2}\/\d{1,2}/);
  if (!dateMatch) return result;
  const rawDate = dateMatch[0]; 
  const [y, m, d] = rawDate.split('/');
  result.date = `${y}/${m.padStart(2, '0')}/${d.padStart(2, '0')}`; 

  const idx = text.indexOf(rawDate);
  const before = text.slice(0, idx).trim();
  result.title = before.replace(/\n/g, ' ').trim();
  const after = text.slice(idx + rawDate.length).trim();
  result.name = after.split('\n')[0].trim();

  const SEPARATOR = '(?:[.．]\\s*|\\s+)';
  const EXTRA_STOP_LABELS = ['補足', '補足資料', '参考文献', '謝辞', '付録'];
  const HEADING_RE = new RegExp(
    `^\\s*(?:\\d+(?:\\.\\d+)*${SEPARATOR}\\S+.*|(?:${EXTRA_STOP_LABELS.join('|')}))\\s*$`,
    'm',
  );

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

// 学籍番号を除去し、氏名に含まれる空白（全角・半角）をすべて削除する
function cleanName(rawName) {
  if (!rawName) return rawName;
  let stripped = rawName.replace(/^[A-Za-z0-9]+\s+/, '').trim();
  stripped = stripped.replace(/[\s ]+/g, ''); 
  return stripped || rawName;
}

// 正規表現の特殊文字をエスケープする
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ファイル名から種別と氏名を抽出する
// ファイル名に「G」が含まれていれば「Gセミ」、それ以外は「報告会」とする
function parseFilename(filename) {
  let decodedName = filename;
  try {
    decodedName = decodeURIComponent(filename);
  } catch (e) {
    // デコードエラー時は元のファイル名をそのまま使う
  }
  decodedName = decodedName.normalize('NFKC');

  const base = decodedName.replace(/\.pdf$/i, '');
  const result = { type: '報告会', name: null };

  let rest = base;

  // 種別判定と該当文字列の除去
  if (/[gｇＧ]/i.test(base)) {
    result.type = 'Gセミ';
    rest = rest.replace(/[gｇＧ][ _ ]?セミ/ig, ''); 
    rest = rest.replace(/[gｇＧ]/ig, ''); 
  } else {
    rest = rest.replace(/報告会/g, ''); 
  }

  // 日付部分と余分なアンダースコアを除去
  rest = rest.replace(/\d{4}-?\d{2}-?\d{2}/g, ''); 
  rest = rest.replace(/_+/g, '_').replace(/^_+|_+$/g, ''); 

  // 氏名を抽出し、空白（全角・半角）をすべて削除する
  result.name = rest ? rest.replace(/[\s ]+/g, '') : null;

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
  ].join('\n');
}

module.exports = { extractReportFields, cleanName, parseFilename, buildTemplate };