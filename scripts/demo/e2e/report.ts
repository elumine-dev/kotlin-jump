/**
 * HTML report generator for demo E2E.
 *
 * Renders one self-contained `report.html` with:
 *   - A header summary (pass/fail, timing, WebP metadata).
 *   - An assertions table that adapts to each kind (color-match /
 *     color-differs / luma-above / range) — expected/actual columns swap
 *     meaning per kind, but the layout stays readable.
 *   - A keyframe gallery (thumbnails linking to the full PNGs on disk).
 *
 * The file sits next to the extracted PNGs, so `<img>` src attributes are
 * relative paths — open in any browser.
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';

import type { Keyframe }           from './keyframes';
import type { AssertionResult, Assertion } from './assertions';
import { rgbCss, type RGB }        from './sample-pixel';

export interface ReportContext {
  demoName:    string;
  webpPath:    string;
  webpFrames:  number;
  webpSeconds: number;
  recordedAt:  Date;
  results:     AssertionResult[];
  keyframes:   Keyframe[];
  /** file stem → png path (relative to the report's directory) */
  framePngs:   Record<string, string>;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rgbToHex(c: RGB): string {
  return '#' + [c.r, c.g, c.b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function swatch(style: string, title: string): string {
  return `<span class="swatch" style="${esc(style)}" title="${esc(title)}"></span>`;
}

/** Render the "Expected" cell — format depends on assertion kind. */
function expectedCell(a: Assertion): string {
  switch (a.kind) {
    case 'color-match':   return `${swatch('background:' + rgbToHex(a.expected), 'expected ' + rgbToHex(a.expected))}<div class="swatch-label">≈ ${rgbToHex(a.expected)}</div>`;
    case 'color-differs': return `${swatch('background:' + rgbToHex(a.reference), 'must differ from ' + rgbToHex(a.reference))}<div class="swatch-label">≠ ${rgbToHex(a.reference)}</div>`;
    case 'luma-above':    return `<div class="metric-threshold">luma ≥ ${a.minLuma}</div>`;
    case 'range':         return `<div class="metric-threshold">∈ [${a.min}, ${a.max}]</div>`;
    case 'ssim-above':    return `<div class="metric-threshold">SSIM ≥ ${a.minScore.toFixed(3)}</div>`;
  }
}

/** Render the "Actual" cell — format depends on assertion kind. */
function actualCell(r: AssertionResult): string {
  const k = r.assertion.kind;
  if (k === 'range')      return `<div class="metric-value">${r.metric.toFixed(2)}</div>`;
  if (k === 'ssim-above') return `<div class="metric-value">${r.metric.toFixed(3)}</div>`;
  const s = r.sampled;
  if (!s) return '';
  return `${swatch('background:' + rgbCss(s), 'actual ' + rgbToHex(s))}<div class="swatch-label">${rgbToHex(s)}</div>`;
}

export function generateReport(outDir: string, ctx: ReportContext): string {
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, 'report.html');

  const pass = ctx.results.filter(r => r.pass).length;
  const fail = ctx.results.length - pass;
  const allPass = fail === 0;

  const rows = ctx.results.map(r => {
    const a = r.assertion;
    const kind = a.kind;
    const frame = a.kind !== 'range' ? ctx.framePngs[a.keyframeLbl] : undefined;
    const keyframeRef = a.kind !== 'range'
      ? `frame ${r.frameNumber} · <code>${esc(a.keyframeLbl)}</code>`
      : `metadata · <code>${esc(a.source)}</code>`;

    return `
      <tr class="${r.pass ? 'ok' : 'fail'}">
        <td class="name">
          <div class="a-kind">${esc(kind)}</div>
          <div class="a-name">${esc(a.name)}</div>
          ${a.note ? `<div class="a-note">${esc(a.note)}</div>` : ''}
          <div class="a-keyframe">${keyframeRef}</div>
        </td>
        <td class="swatch-cell">${expectedCell(a)}</td>
        <td class="swatch-cell">${actualCell(r)}</td>
        <td class="dist"><span class="dist-val">${esc(r.verdict)}</span></td>
        <td class="verdict">${r.pass ? '<span class="ok-badge">PASS</span>' : '<span class="fail-badge">FAIL</span>'}</td>
        <td class="frame-link">${frame ? `<a href="${esc(frame)}"><img src="${esc(frame)}" alt=""></a>` : ''}</td>
      </tr>`;
  }).join('\n');

  const gallery = ctx.keyframes.map(k => {
    const png = ctx.framePngs[k.label];
    if (!png) return '';
    return `
      <figure>
        <a href="${esc(png)}"><img src="${esc(png)}" alt="${esc(k.label)}"></a>
        <figcaption>
          <strong>${esc(k.label)}</strong><br>
          frame ${k.frameNumber} · t=${k.t.toFixed(2)}s
        </figcaption>
      </figure>`;
  }).join('\n');

  const css = `
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { font: 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1e1e1e; color: #e6e6e6; margin: 0; padding: 32px; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    h2 { margin: 32px 0 12px; font-size: 16px; letter-spacing: 0.04em; text-transform: uppercase; color: #9da4af; }
    .summary { display: flex; gap: 24px; flex-wrap: wrap; padding: 16px; border: 1px solid #2f2f33; border-radius: 8px; background: #232327; }
    .summary > div { display: flex; flex-direction: column; gap: 4px; }
    .summary .k { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #7e8693; }
    .summary .v { font-weight: 600; }
    .summary .pass { color: #4caf50; }
    .summary .fail { color: #ff5252; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #2f2f33; vertical-align: middle; }
    th { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: #9da4af; font-weight: 600; }
    tr.fail td { background: rgba(255, 82, 82, 0.08); }
    .a-kind { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #6d7480; margin-bottom: 4px; }
    .a-name { font-weight: 600; }
    .a-note { color: #9da4af; font-size: 12px; margin-top: 2px; }
    .a-keyframe { color: #6d7480; font-size: 11px; margin-top: 4px; }
    .a-keyframe code { background: #2a2a2e; padding: 1px 6px; border-radius: 3px; font-family: 'JetBrains Mono', Menlo, monospace; font-size: 11px; }
    .swatch-cell { text-align: center; white-space: nowrap; }
    .swatch { display: inline-block; width: 32px; height: 32px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.1); vertical-align: middle; }
    .swatch-label { font-size: 10px; color: #6d7480; margin-top: 4px; font-family: 'JetBrains Mono', Menlo, monospace; }
    .metric-threshold { color: #9da4af; font-family: 'JetBrains Mono', Menlo, monospace; font-size: 12px; }
    .metric-value { font-family: 'JetBrains Mono', Menlo, monospace; font-weight: 600; font-size: 14px; }
    .dist-val { font-family: 'JetBrains Mono', Menlo, monospace; font-weight: 600; }
    .ok-badge   { background: #1f3a22; color: #71d175; padding: 2px 10px; border-radius: 12px; font-size: 11px; letter-spacing: 0.06em; font-weight: 600; }
    .fail-badge { background: #3a1f1f; color: #ff7a7a; padding: 2px 10px; border-radius: 12px; font-size: 11px; letter-spacing: 0.06em; font-weight: 600; }
    .frame-link img { width: 160px; height: auto; border-radius: 4px; display: block; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    .gallery figure { margin: 0; background: #232327; border: 1px solid #2f2f33; border-radius: 8px; overflow: hidden; }
    .gallery img { width: 100%; height: auto; display: block; }
    .gallery figcaption { padding: 10px 12px; font-size: 12px; color: #9da4af; border-top: 1px solid #2f2f33; }
    .gallery figcaption strong { color: #e6e6e6; font-family: 'JetBrains Mono', Menlo, monospace; font-size: 12px; }
    .kind-breakdown { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px; }
    .kind-breakdown span { background: #232327; border: 1px solid #2f2f33; padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #9da4af; }
    .kind-breakdown strong { color: #e6e6e6; margin-right: 4px; }
  `.trim();

  // Kind breakdown in the summary.
  const byKind: Record<string, number> = {};
  for (const r of ctx.results) byKind[r.assertion.kind] = (byKind[r.assertion.kind] ?? 0) + 1;
  const kindRow = Object.entries(byKind)
    .map(([k, n]) => `<span><strong>${n}</strong>${k}</span>`)
    .join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(ctx.demoName)} — demo E2E report</title>
<style>${css}</style>
</head><body>

<h1>${esc(ctx.demoName)} — demo E2E report</h1>

<div class="summary">
  <div><span class="k">Recorded at</span><span class="v">${esc(ctx.recordedAt.toISOString())}</span></div>
  <div><span class="k">WebP</span><span class="v">${esc(path.basename(ctx.webpPath))}</span></div>
  <div><span class="k">Frames</span><span class="v">${ctx.webpFrames}</span></div>
  <div><span class="k">Duration</span><span class="v">${ctx.webpSeconds.toFixed(2)} s</span></div>
  <div><span class="k">Assertions</span><span class="v ${allPass ? 'pass' : 'fail'}">${pass} / ${ctx.results.length} pass</span></div>
  <div><span class="k">Verdict</span><span class="v ${allPass ? 'pass' : 'fail'}">${allPass ? '✓ GREEN' : '✗ REGRESSION'}</span></div>
</div>
<div class="kind-breakdown">${kindRow}</div>

<h2>Assertions</h2>
<table>
  <thead><tr>
    <th>Name</th><th>Expected</th><th>Actual</th><th>Verdict</th><th>Status</th><th>Frame</th>
  </tr></thead>
  <tbody>
    ${rows}
  </tbody>
</table>

<h2>Keyframe gallery</h2>
<div class="gallery">
  ${gallery}
</div>

</body></html>`;

  fs.writeFileSync(reportPath, html, 'utf8');
  return reportPath;
}
