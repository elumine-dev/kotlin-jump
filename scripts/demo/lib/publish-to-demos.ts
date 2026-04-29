import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Copy the manual-recording artefacts (.webp + poster + timeline) from
 * `media/walkthrough/<name>/` to the canonical `assets/demos/` location
 * the release pipeline (`./.publish`) expects.
 *
 * Filename conventions match the auto-recorder's output and what
 * `media/whats-new.json` references via the `media` field:
 *
 *   <name>.webp           — animated demo
 *   <name>-poster.png     — first-frame poster
 *   <name>.timeline.json  — caption track (renamed from `timeline.json`
 *                           so it sits next to the webp instead of
 *                           clashing with raw recording metadata)
 *
 * `raw.mov` deliberately stays in walkthrough — it's the source-of-truth
 * for `kjdemo manual-render <name>` reruns and never ships in releases
 * (gitignored under `media/walkthrough/**\/raw.mov`).
 */
export function publishWalkthroughToDemos(opts: {
  name:       string;
  walkthroughDir: string;
  repoRoot:   string;
  log:        (msg: string) => void;
}): void {
  const { name, walkthroughDir, repoRoot, log } = opts;
  const demosDir = path.join(repoRoot, 'assets', 'demos');
  fs.mkdirSync(demosDir, { recursive: true });

  const moves: Array<{ src: string; dest: string }> = [
    {
      src:  path.join(walkthroughDir, `${name}.webp`),
      dest: path.join(demosDir, `${name}.webp`),
    },
    {
      src:  path.join(walkthroughDir, `${name}-poster.png`),
      dest: path.join(demosDir, `${name}-poster.png`),
    },
    {
      src:  path.join(walkthroughDir, 'timeline.json'),
      dest: path.join(demosDir, `${name}.timeline.json`),
    },
  ];

  for (const { src, dest } of moves) {
    if (!fs.existsSync(src)) {
      log(`  ⚠ ${path.basename(dest)} skipped (no ${path.basename(src)} in walkthrough)`);
      continue;
    }
    fs.copyFileSync(src, dest);
    log(`  → ${path.relative(repoRoot, dest)}`);
  }
}
