/**
 * Minimal Android vector drawable → SVG converter.
 *
 * Scope: `<vector>`, `<path>`, and `<group>` (rotation/translate/scale only).
 * Clip-paths, gradients, and animations are dropped — the goal is a
 * tooltip thumbnail, not a rendering engine. Unparseable or unsupported
 * drawables fall back to `undefined` and the caller degrades to a
 * file-info hover.
 */
export function vectorXmlToSvg(xml: string): string | undefined {
  const vectorMatch = /<vector\b([^>]*)>([\s\S]*?)<\/vector>/i.exec(xml);
  if (!vectorMatch) return undefined;

  const attrs      = vectorMatch[1];
  const body       = vectorMatch[2];
  const viewportW  = attrOf(attrs, 'viewportWidth')  ?? attrOf(attrs, 'width')  ?? '24';
  const viewportH  = attrOf(attrs, 'viewportHeight') ?? attrOf(attrs, 'height') ?? '24';
  const width      = stripDp(attrOf(attrs, 'width')  ?? viewportW);
  const height     = stripDp(attrOf(attrs, 'height') ?? viewportH);

  const inner = convertChildren(body);
  if (!inner) return undefined;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${width}" height="${height}" ` +
    `viewBox="0 0 ${viewportW} ${viewportH}">` +
    inner +
    `</svg>`
  );
}

function convertChildren(body: string): string {
  // Paths and groups in document order: a `<group>` background emitted
  // after the top-level glyph `<path>` covered it.
  const frags: { at: number; svg: string }[] = [];
  // Self-closing form first. Attribute values may hold a '/'
  // (`@color/primary`, `?attr/colorControlNormal`), so the lazy class must
  // stop at '>' and not at '/': with [^/] such a path never matched, the body
  // converted to nothing and the whole drawable lost its preview.
  const PATH_RE = /<path\b([^>]*?)\/>|<path\b([^>]*)>([\s\S]*?)<\/path>/gi;

  // Depth-balanced <group> matching. A lazy regex would stop at the first
  // </group> and cut the outer group short when groups nest — we need to
  // count <group>/</group> openings/closings to find the right pair.
  const groupSpans: Array<{ start: number; end: number; svg: string }> = [];
  const openGroup = /<group\b([^>]*)>/g;
  let gm: RegExpExecArray | null;
  let skipUntil = -1;
  while ((gm = openGroup.exec(body))) {
    if (gm.index < skipUntil) continue; // inside an already-matched outer group
    const matched = findBalancedGroupEnd(body, openGroup.lastIndex);
    if (matched === -1) continue; // unbalanced — drop
    const attrs = gm[1];
    const inner = convertChildren(body.slice(openGroup.lastIndex, matched.contentEnd));
    const transforms: string[] = [];
    const rotate = attrOf(attrs, 'rotation');
    const tx     = attrOf(attrs, 'translateX');
    const ty     = attrOf(attrs, 'translateY');
    const sx     = attrOf(attrs, 'scaleX');
    const sy     = attrOf(attrs, 'scaleY');
    const px     = attrOf(attrs, 'pivotX') ?? '0';
    const py     = attrOf(attrs, 'pivotY') ?? '0';
    const pivoted = px !== '0' || py !== '0';
    if (tx || ty) transforms.push(`translate(${tx ?? '0'},${ty ?? '0'})`);
    if (rotate)   transforms.push(`rotate(${rotate},${px},${py})`);
    // Android scales about the pivot too (VGroup: T(-pivot) S R T(pivot +
    // translate)); a centred 0.5 badge used to shrink towards the corner.
    if (sx || sy) {
      if (pivoted) transforms.push(`translate(${px},${py})`);
      transforms.push(`scale(${sx ?? '1'},${sy ?? '1'})`);
      if (pivoted) transforms.push(`translate(${negate(px)},${negate(py)})`);
    }
    const transformAttr = transforms.length > 0 ? ` transform="${transforms.join(' ')}"` : '';
    groupSpans.push({ start: gm.index, end: matched.tagEnd, svg: `<g${transformAttr}>${inner}</g>` });
    skipUntil = matched.tagEnd;
    openGroup.lastIndex = matched.tagEnd;
  }

  // Replace group spans with placeholders so PATH_RE doesn't match inside.
  let scanBody = body;
  for (let i = groupSpans.length - 1; i >= 0; i--) {
    const s = groupSpans[i];
    scanBody = scanBody.slice(0, s.start) + ' '.repeat(s.end - s.start) + scanBody.slice(s.end);
  }

  // Flat paths.
  PATH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(scanBody))) {
    const attrs = m[1] ?? m[2] ?? '';
    const d     = attrOf(attrs, 'pathData');
    if (!d) continue;
    // `<aapt:attr name="android:fillColor"><gradient …>`: the first stop as
    // a flat colour, instead of an invisible shape.
    const inner = m[3] ?? '';
    const fill        = androidColor(attrOf(attrs, 'fillColor') ?? gradientColor(inner, 'fillColor') ?? 'none');
    const stroke      = androidColor(attrOf(attrs, 'strokeColor') ?? gradientColor(inner, 'strokeColor'));
    const strokeWidth = attrOf(attrs, 'strokeWidth');
    const lineCap     = attrOf(attrs, 'strokeLineCap');
    const lineJoin    = attrOf(attrs, 'strokeLineJoin');
    const miterLimit  = attrOf(attrs, 'strokeMiterLimit');
    const fillRule    = attrOf(attrs, 'fillType')?.toLowerCase() === 'evenodd' ? 'evenodd' : undefined;
    const fillAlpha   = attrOf(attrs, 'fillAlpha');
    const strokeAlpha = attrOf(attrs, 'strokeAlpha');
    const fillOpacity   = combineAlpha(fillAlpha, fill.alpha);
    const strokeOpacity = combineAlpha(strokeAlpha, stroke.alpha);

    const parts = [`d="${escapeAttr(d)}"`, `fill="${escapeAttr(fill.color ?? 'none')}"`];
    if (stroke.color)  parts.push(`stroke="${escapeAttr(stroke.color)}"`);
    if (strokeWidth)   parts.push(`stroke-width="${escapeAttr(strokeWidth)}"`);
    if (lineCap)       parts.push(`stroke-linecap="${escapeAttr(lineCap.toLowerCase())}"`);
    if (lineJoin)      parts.push(`stroke-linejoin="${escapeAttr(lineJoin.toLowerCase())}"`);
    if (miterLimit)    parts.push(`stroke-miterlimit="${escapeAttr(miterLimit)}"`);
    if (fillRule)      parts.push(`fill-rule="${fillRule}"`);
    if (fillOpacity)   parts.push(`fill-opacity="${escapeAttr(fillOpacity)}"`);
    if (strokeOpacity) parts.push(`stroke-opacity="${escapeAttr(strokeOpacity)}"`);
    frags.push({ at: m.index, svg: `<path ${parts.join(' ')}/>` });
  }

  for (const s of groupSpans) frags.push({ at: s.start, svg: s.svg });
  return frags.sort((a, b) => a.at - b.at).map(f => f.svg).join('');
}

function negate(v: string): string {
  const n = parseFloat(v);
  return Number.isFinite(n) ? String(-n) : `-${v}`;
}

function gradientColor(pathInner: string, name: 'fillColor' | 'strokeColor'): string | undefined {
  const re = new RegExp(`<aapt:attr\\s+name="android:${name}"[^>]*>[\\s\\S]*?<gradient\\b([^>]*)>`, 'i');
  const m = re.exec(pathInner);
  if (!m) return undefined;
  return attrOf(m[1], 'startColor') ?? attrOf(m[1], 'centerColor') ?? attrOf(m[1], 'endColor');
}

function findBalancedGroupEnd(
  body: string,
  startFrom: number,
): { contentEnd: number; tagEnd: number } | -1 {
  // Returns where the content of the current group ends (before </group>)
  // and where the whole closing tag ends. Scans by depth.
  const re = /<group\b|<\/group\s*>/g;
  re.lastIndex = startFrom;
  let depth = 1;
  let t: RegExpExecArray | null;
  while ((t = re.exec(body))) {
    if (t[0].startsWith('</')) {
      depth--;
      if (depth === 0) return { contentEnd: t.index, tagEnd: re.lastIndex };
    } else {
      depth++;
    }
  }
  return -1;
}

/**
 * Android hex colours put alpha FIRST (#AARRGGBB, #ARGB); CSS puts it last
 * (#RRGGBBAA). Every icon out of Vector Asset Studio is written
 * `#FF000000`, which a browser reads as red at alpha 0: an empty preview.
 * Alpha comes back separately so it can be multiplied into fillAlpha.
 */
export function androidColor(value: string | undefined): { color?: string; alpha?: number } {
  if (value === undefined) return {};
  // `?attr/colorControlNormal`, `@color/primary`, `@android:color/white`: the
  // real value lives in a theme or a resource file. Passed verbatim, SVG
  // treated it as an invalid paint (black fill, no stroke). currentColor lets
  // the surface choose: the preview panel sets it to the editor foreground.
  if (/^[?@]/.test(value.trim())) return { color: 'currentColor' };
  const m = /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!m) return { color: value };
  const hex = m[1];
  const alphaHex = hex.length === 4 ? hex[0] + hex[0] : hex.slice(0, 2);
  const rgb      = hex.length === 4 ? hex.slice(1)     : hex.slice(2);
  const alpha = parseInt(alphaHex, 16) / 255;
  return { color: `#${rgb}`, alpha: alpha < 1 ? alpha : undefined };
}

function combineAlpha(attr: string | undefined, colorAlpha: number | undefined): string | undefined {
  const a = attr !== undefined ? parseFloat(attr) : NaN;
  const fromAttr = Number.isFinite(a) ? a : undefined;
  if (fromAttr === undefined && colorAlpha === undefined) return attr;
  const product = (fromAttr ?? 1) * (colorAlpha ?? 1);
  return String(Math.round(product * 1000) / 1000);
}

function attrOf(attrs: string, name: string): string | undefined {
  // Android XML allows both "..." and '...' quoting styles for attribute
  // values. Matching only the double-quoted form silently drops any path
  // whose author reached for a single quote — see PR #… and the
  // corresponding `ADV-VEC` test case.
  // Anchored on a boundary: unanchored, `width` matched inside
  // `viewportWidth` and a hand-written file got width="24" instead of 48dp.
  const re = new RegExp(`(?:^|\\s)(?:android:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m  = re.exec(attrs);
  const raw = m?.[1] ?? m?.[2];
  // XML entities are decoded here and re-escaped by escapeAttr: `&amp;`
  // used to come out as `&amp;amp;`.
  return raw === undefined ? undefined : decodeXmlEntities(raw);
}

/** `&#1114112;` is past the last Unicode code point: String.fromCodePoint
 *  throws a RangeError on it, and that killed the whole preview. Leave the
 *  entity as written rather than lose the drawable. */
function codePointOr(raw: string, value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return raw;
  return String.fromCodePoint(value);
}

function decodeXmlEntities(v: string): string {
  if (!v.includes('&')) return v;
  return v
    .replace(/&#x([0-9a-f]+);/gi, (s, h) => codePointOr(s, parseInt(h, 16)))
    .replace(/&#(\d+);/g, (s, d) => codePointOr(s, parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripDp(v: string): string {
  // Strip the full dp/px/sp suffix — the previous regex `/dp|px|sp$/i`
  // only anchored `sp` and would eat a trailing `dp` or `px` in the
  // middle of any string ("24dpi" → "24i").
  return v.replace(/(dp|px|sp)$/i, '').trim();
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
