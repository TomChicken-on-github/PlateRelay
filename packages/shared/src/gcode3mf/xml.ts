/*
 * Minimal reader for the flat XML that Bambu Studio writes into
 * Metadata/slice_info.config and Metadata/model_settings.config.
 * Those files are elements with attributes only (no mixed content), so a
 * tag scanner is enough and keeps the parser free of DOM APIs on the server.
 */

export type XmlTag = { name: string; attrs: Record<string, string> };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/*
 * Everything below scans with indexOf instead of regular expressions over the whole file: the files come
 * from uploads, and patterns like `<tag[^>]*?>` or `[\w]+\s*=` backtrack quadratically on input that never
 * closes (half a megabyte of "<metadata " took 40 s and blocked the panel). Each scan here is linear.
 */

const isNameChar = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === ":" || c === "." || c === "-";
const isSpace = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r";

/** `name="value"` and `name='value'` pairs; anything else between them is skipped. */
function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const n = src.length;
  let i = 0;
  while (i < n) {
    while (i < n && !isNameChar(src[i])) i++;
    const s = i;
    while (i < n && isNameChar(src[i])) i++;
    if (s === i) break;
    let j = i;
    while (isSpace(src[j])) j++;
    if (src[j] !== "=") continue;
    j++;
    while (isSpace(src[j])) j++;
    const q = src[j];
    if (q !== '"' && q !== "'") {
      i = j;
      continue;
    }
    const e = src.indexOf(q, j + 1);
    if (e === -1) break;
    attrs[src.slice(s, i)] = decodeEntities(src.slice(j + 1, e));
    i = e + 1;
  }
  return attrs;
}

/** Start tags `<tag` followed by whitespace, `>` or `/>` (so `<plates>` is not `<plate>`), with the attribute text and the index after `>`. */
function* startTags(xml: string, tag: string, selfClosing: boolean): Generator<{ src: string; end: number }> {
  const open = `<${tag}`;
  let i = 0;
  while ((i = xml.indexOf(open, i)) !== -1) {
    const next = xml[i + open.length];
    if (next !== ">" && !isSpace(next) && !(selfClosing && next === "/")) {
      i += open.length;
      continue;
    }
    const gt = xml.indexOf(">", i + open.length);
    if (gt === -1) return;
    let src = xml.slice(i + open.length, gt);
    if (src.endsWith("/")) src = src.slice(0, -1);
    yield { src, end: gt + 1 };
    i = gt + 1;
  }
}

/** Inner text of every `<tag ...>...</tag>` block, in document order. */
export function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const close = `</${tag}>`;
  let from = 0;
  for (const t of startTags(xml, tag, false)) {
    if (t.end < from) continue;
    const e = xml.indexOf(close, t.end);
    /* no closing tag after this one means none after any later one either */
    if (e === -1) break;
    out.push(xml.slice(t.end, e));
    from = e + close.length;
  }
  return out;
}

/** Every `<tag .../>` or `<tag ...>` start tag, in document order. */
export function tags(xml: string, tag: string): XmlTag[] {
  return [...startTags(xml, tag, true)].map((t) => ({ name: tag, attrs: parseAttrs(t.src) }));
}

/** `<metadata key="k" value="v"/>` pairs of one block (or of another key/value tag). */
export function metadata(xml: string, tag = "metadata"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tags(xml, tag)) if (t.attrs.key !== undefined) out[t.attrs.key] = t.attrs.value ?? "";
  return out;
}
