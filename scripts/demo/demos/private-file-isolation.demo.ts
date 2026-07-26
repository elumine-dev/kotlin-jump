import { Stage } from '../lib/stage';

/**
 * Demo: top-level `private` is file-private — Find Usages must respect it.
 *
 * The fixture declares `private fun getQuantityString` in three sibling
 * files of `com.example.demo` (VisualBugsDemo.kt, PluralArrayDemo.kt) plus
 * one in `com.example.sprint1` (Sprint1VisualDemo.kt). They share the
 * exact same simple name and package — but in Kotlin, top-level `private`
 * is **file-private**: each is its own symbol with its own callers.
 *
 * Before the fix, the FQN map in `SymbolIndex` only kept ONE entry per
 * `pkg.name` collision, so `resolveBest` silently returned whichever was
 * indexed last. Cmd+Click on the declaration in VisualBugsDemo.kt jumped
 * to PluralArrayDemo.kt; Find Usages listed PluralArrayDemo's call sites
 * instead of the local two.
 *
 * This demo verifies the fix end-to-end: invoke Find Usages from the
 * VisualBugsDemo declaration, the panel populates with the two LOCAL
 * call sites only — `showCount` (line 27, 1-idx) and `ticketsLeft`
 * (line 79, 1-idx). No cross-file leakage.
 *
 * ~13 s.
 */
export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  // ── Setup ────────────────────────────────────────────────────────────
  // VisualBugsDemo.kt line 70 (1-idx) = line 69 (0-idx):
  //   `private fun getQuantityString(id: Int, q: Int, vararg args: Any): String = "$id-$q"`
  //                ^col 12 (0-idx) — 'g' of getQuantityString
  const editor = await stage.openFile(
    'src/main/kotlin/com/example/demo/VisualBugsDemo.kt',
    { line: 69, column: 12 },
  );
  await stage.dwellOn({ line: 69, column: 12 }, 1100);
  await stage.caption('Trois fichiers du même package, même nom, tous `private`.', {
    duration: 2600,
  });

  // ── Beat A: name the trap ───────────────────────────────────────────
  // Line 70 is 83 chars long. Callouts MUST land past EOL or they
  // render INSIDE the identifier and split the word visually
  // (`code-lens.demo.ts:38` calls this out explicitly).
  void stage.calloutAt({ line: 69, column: 90 }, 'file-private', 2200);
  await stage.caption('Top-level `private` means file-private. PluralArrayDemo cannot see this symbol.', {
    duration: 2800,
  });

  // ── Beat B: Find Usages → panel path ─────────────────────────────────
  // The panel path (`kotlin-jump.findUsages` WITH `exclude` args) routes
  // through `usagesPanel.search` (FindUsagesPanel.ts:70). Without args,
  // smartNavigation=false would short-circuit to `editor.action.goToReferences`
  // — the references peek, which works too but is harder to read in the
  // recording frame.
  await stage.keystroke('⌥ + F7', { label: 'Find Usages' });
  await stage.runCommand('kotlin-jump.findUsages', {
    excludeUri:  editor.document.uri.toString(),
    excludeLine: 69,
  });
  await stage.runCommand('kotlinJump.findUsages.focus');
  await stage.pause(2200);  // panel renders

  // ── Beat C: payoff ──────────────────────────────────────────────────
  // The panel header reads "2 usages of \"getQuantityString\"" and the
  // file list shows ONE node — VisualBugsDemo.kt — with two children:
  //   * line 27  showCount(...)
  //   * line 79  ticketsLeft(...)
  // No PluralArrayDemo, no Sprint1VisualDemo. Cross-file private siblings
  // are invisible.
  await stage.caption('Two callers, both inside VisualBugsDemo.kt 🔒', {
    duration: 2800,
  });
}
