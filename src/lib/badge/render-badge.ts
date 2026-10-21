/**
 * Shields-style flat SVG badge. Pure: text is XML-escaped and widths are estimated
 * from per-character advances of 11px Verdana (the font badges conventionally use).
 */

const NARROW = new Set([..."fijlrt.,:;!|'()[]Iĳ1 "]);
const WIDE = new Set([..."mwMW@%"]);

export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) w += 4;
    else if (WIDE.has(ch)) w += 10;
    else if (ch >= "A" && ch <= "Z") w += 7.5;
    else w += 6.6;
  }
  return Math.ceil(w);
}

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

export type BadgeInput = { label: string; message: string; color: string };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function renderBadge({ label, message, color }: BadgeInput): string {
  const fill = HEX_COLOR.test(color) ? color : "#9f9f9f";
  const pad = 6;
  const lw = textWidth(label) + pad * 2;
  const mw = textWidth(message) + pad * 2;
  const total = lw + mw;
  const l = escapeXml(label);
  const m = escapeXml(message);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${l}: ${m}">
<title>${l}: ${m}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#0b1530"/><rect x="${lw}" width="${mw}" height="20" fill="${fill}"/><rect width="${total}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${l}</text><text x="${lw / 2}" y="14">${l}</text>
<text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3">${m}</text><text x="${lw + mw / 2}" y="14">${m}</text>
</g>
</svg>`;
}

/** Badge colour for a 0–100 score by band; dark enough for white text to stay readable. */
export function scoreBadgeColor(score: number): string {
  if (score >= 90) return "#1f883d";
  if (score >= 75) return "#2da44e";
  if (score >= 60) return "#9a6700";
  if (score >= 40) return "#bc4c00";
  return "#cf222e";
}
