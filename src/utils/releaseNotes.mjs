const decodeCodePoint = (value, radix) => {
  const codePoint = Number.parseInt(value, radix);
  return codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : '\ufffd';
};

const decodeEntities = (value) => value
  .replace(/&#(\d+);/g, (_, code) => decodeCodePoint(code, 10))
  .replace(/&#x([\da-f]+);/gi, (_, code) => decodeCodePoint(code, 16))
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'");

const toPlainLines = (value) => {
  const source = String(value || '').trim();
  if (!source) return [];

  const text = /<\/?[a-z][\s\S]*>/i.test(source)
    ? decodeEntities(source
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|li|h[1-6]|div)>/gi, '\n')
        .replace(/<[^>]*>/g, ''))
    : source;

  return text
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, '')
      .replace(/\[([^\]]+)]\([^\s)]+(?:\s+"[^"]*")?\)/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim())
    .filter((line) => line && !/^更新日志$/i.test(line));
};

export const normalizeReleaseNotes = (releaseNotes) => {
  const entries = Array.isArray(releaseNotes)
    ? releaseNotes
    : [{ version: '', note: releaseNotes }];

  return entries
    .map((entry) => ({
      version: typeof entry === 'object' && entry ? String(entry.version || '') : '',
      notes: toPlainLines(typeof entry === 'object' && entry ? entry.note : entry),
    }))
    .filter((entry) => entry.notes.length);
};
