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

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of src.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? "");
  return attrs;
}

/** Inner text of every `<tag ...>...</tag>` block, in document order. */
export function blocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
}

/** Every `<tag .../>` or `<tag ...>` start tag, in document order. */
export function tags(xml: string, tag: string): XmlTag[] {
  return [...xml.matchAll(new RegExp(`<(${tag})(\\s[^>]*?)?/?>`, "g"))].map((m) => ({ name: m[1], attrs: parseAttrs(m[2] ?? "") }));
}

/** `<metadata key="k" value="v"/>` pairs of one block (or of another key/value tag). */
export function metadata(xml: string, tag = "metadata"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tags(xml, tag)) if (t.attrs.key !== undefined) out[t.attrs.key] = t.attrs.value ?? "";
  return out;
}
