import { Stage } from '../lib/stage';

/**
 * Demo: String Resource Hover — value + format spec + locale grid,
 * all three in one hover panel.
 *
 * Target: `R.string.msg_battle_won` — a message translated in both
 * `values/` (English) and `values-fr/` (French). The locale grid shows
 * the default and the French version side-by-side, with the actual
 * text previews — so the viewer sees "Victory!…" vs "Victoire !…"
 * at a glance.
 *
 * ~9 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Setup: cursor on the R.string ref ───────────────────────────────
  // StringFoldingDemo.kt line 46 (0-idx) = line 47 (1-idx) =
  //   `    val triple   = "${R.string.msg_battle_won} – ${R.string.msg_battle_lost} – …"`
  // The first `msg_battle_won` spans a known column range inside the
  // string interpolation. We aim for the word itself.
  await stage.openFile(
    'src/main/kotlin/com/example/demo/StringFoldingDemo.kt',
    { line: 46, column: 34 },  // inside `msg_battle_won`
  );
  await stage.dwellOn({ line: 46, column: 34 }, 900);
  await stage.caption('Is this message translated in every locale?', {
    duration: 2200,
  });

  // ── Action: trigger the hover ───────────────────────────────────────
  // `editor.action.showHover` = VS Code's Cmd+K Cmd+I command. The
  // StringResourceHoverProvider renders the value preview, the format
  // spec breakdown (none for this key), the source path, and the
  // locale grid with default + fr values.
  await stage.keystroke('⌘ + K  ⌘ + I', { label: 'Show Hover' });
  await stage.runCommand('editor.action.showHover');
  // 3 s — the hover is multi-line and the viewer needs time to scan
  // both language versions.
  await stage.pause(3000);

  await stage.caption('Every locale, side by side. No translation hunt. 🌍', {
    duration: 2800,
  });

  // Dismiss so the final frame is clean.
  await stage.runCommand('editor.action.hideHover').then(() => {}, () => {});
}
