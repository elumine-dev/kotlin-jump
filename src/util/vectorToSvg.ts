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
  let out = '';
  const PATH_RE = /<path\b([^/]*?)\/>|<path\b([^>]*)>([\s\S]*?)<\/path>/gi;

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
    if (tx || ty) transforms.push(`translate(${tx ?? '0'},${ty ?? '0'})`);
    if (rotate)   transforms.push(`rotate(${rotate},${px},${py})`);
    if (sx || sy) transforms.push(`scale(${sx ?? '1'},${sy ?? '1'})`);
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
    const fill        = attrOf(attrs, 'fillColor')   ?? 'none';
    const stroke      = attrOf(attrs, 'strokeColor');
    const strokeWidth = attrOf(attrs, 'strokeWidth');
    const fillRule    = attrOf(attrs, 'fillType')?.toLowerCase() === 'evenodd' ? 'evenodd' : undefined;
    const opacity     = attrOf(attrs, 'fillAlpha');

    const parts = [`d="${escapeAttr(d)}"`, `fill="${escapeAttr(fill)}"`];
    if (stroke)      parts.push(`stroke="${escapeAttr(stroke)}"`);
    if (strokeWidth) parts.push(`stroke-width="${escapeAttr(strokeWidth)}"`);
    if (fillRule)    parts.push(`fill-rule="${fillRule}"`);
    if (opacity)     parts.push(`fill-opacity="${escapeAttr(opacity)}"`);
    out += `<path ${parts.join(' ')}/>`;
  }

  for (const s of groupSpans) out += s.svg;
  return out;
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

function attrOf(attrs: string, name: string): string | undefined {
  // Android XML allows both "..." and '...' quoting styles for attribute
  // values. Matching only the double-quoted form silently drops any path
  // whose author reached for a single quote — see PR #… and the
  // corresponding `ADV-VEC` test case.
  const re = new RegExp(`(?:android:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m  = re.exec(attrs);
  return m?.[1] ?? m?.[2];
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
