/**
 * ADV — NavigationHistoryProvider regressions Kevin reported in person:
 *   1. Back lands on the right line but at column 0 instead of the
 *      stored column when navigating across files.
 *   2. Forward stops working between files after a Back, even when
 *      the user hasn't moved the cursor in between.
 *
 * Each test pins the EXPECTED behaviour. Failures here mean Kevin's
 * complaint is reproducible and the underlying race / column-loss bug
 * is real.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { NavigationHistoryProvider } from '../../src/providers/NavigationHistoryProvider';

function makeEditor(uri: string, line: number, character = 0) {
  return {
    document: { uri: { toString: () => uri } },
    selection: { active: new vscode.Position(line, character) },
  } as any;
}

function selectionEvent(uri: string, line: number, kind: vscode.TextEditorSelectionChangeKind, character = 0) {
  return {
    textEditor: makeEditor(uri, line, character),
    selections: [{ active: new vscode.Position(line, character) }],
    kind,
  } as any;
}

const tick = () => new Promise<void>(r => setTimeout(r, 0));
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

let editorListener:    (e: any) => void;
let selectionListener: (e: any) => void;
const registeredCmds = new Map<string, () => Promise<void>>();

// Capture what _navigateTo does to the editor — selection setter and
// any selection passed in showTextDocument options.
let lastShowTextOptions: any | undefined;
let lastEditorSelectionSet: vscode.Selection | undefined;

beforeEach(() => {
  registeredCmds.clear();
  lastShowTextOptions = undefined;
  lastEditorSelectionSet = undefined;
  (vscode.window as any).activeTextEditor = undefined;

  vi.spyOn(vscode.commands, 'registerCommand').mockImplementation((id: string, handler: any) => {
    registeredCmds.set(id, handler);
    return { dispose: vi.fn() };
  });
  vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
  vi.spyOn(vscode.window, 'onDidChangeActiveTextEditor').mockImplementation((cb: any) => {
    editorListener = cb;
    return { dispose: vi.fn() };
  });
  vi.spyOn(vscode.window, 'onDidChangeTextEditorSelection').mockImplementation((cb: any) => {
    selectionListener = cb;
    return { dispose: vi.fn() };
  });
  vi.spyOn(vscode.workspace, 'openTextDocument').mockImplementation(async (uri: any) => ({
    uri: { toString: () => uri.toString?.() ?? String(uri) },
  } as any));
  vi.spyOn(vscode.window, 'showTextDocument').mockImplementation(async (doc: any, opts?: any) => {
    lastShowTextOptions = opts;
    const uri = doc.uri?.toString?.() ?? '';
    const editor: any = {
      document: { uri: { toString: () => uri } },
      get selection() { return lastEditorSelectionSet ?? new vscode.Selection(0, 0, 0, 0); },
      set selection(v: vscode.Selection) { lastEditorSelectionSet = v; },
      revealRange: vi.fn(),
    };
    // Real VS Code fires onDidChangeActiveTextEditor synchronously inside
    // showTextDocument when the editor actually changes. Simulate it so
    // _onEditorChanged runs (and either clears _navigatingToUri eagerly,
    // exposing the bug, or absorbs the event correctly post-fix).
    if (editorListener) editorListener(editor);
    return editor;
  });
});

afterEach(() => vi.restoreAllMocks());

// ── BUG 1 — column lost on cross-file Back ──────────────────────────────────

describe('ADV-NAV-1 — Back preserves column across files', () => {
  it('Back to file A lands at the EXACT (line, column) recorded — not (line, 0)', async () => {
    // Seed: user in A at (line 11, col 10)
    (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 11, 10);
    const p = new NavigationHistoryProvider();
    // User keeps editing A — the lastKnown for A advances to (11, 10).
    selectionListener(selectionEvent('file:///A.kt', 11, vscode.TextEditorSelectionChangeKind.Keyboard, 10));

    // User switches to B (e.g. clicked file). _onEditorChanged captures A:(11,10) into history.
    editorListener(makeEditor('file:///B.kt', 5, 3));
    selectionListener(selectionEvent('file:///B.kt', 5, vscode.TextEditorSelectionChangeKind.Command, 3));

    // Back to A. The provider must navigate to (11, 10), not (11, 0).
    await registeredCmds.get('kotlinJump.navigateBack')!();
    await tick();

    // Either the showTextDocument selection option (preferred — atomic)
    // or the post-show editor.selection setter must place the cursor
    // at (11, 10).
    const passedSel: vscode.Range | undefined = lastShowTextOptions?.selection;
    const setSel:    vscode.Selection | undefined = lastEditorSelectionSet;

    const finalLine = passedSel?.start.line      ?? setSel?.active.line;
    const finalChar = passedSel?.start.character ?? setSel?.active.character;

    expect(finalLine).toBe(11);
    expect(finalChar).toBe(10); // ← the bug: was 0
    p.dispose();
  });

  it('Forward to a previously-visited (line, col) preserves the column too', async () => {
    (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 1, 0);
    const p = new NavigationHistoryProvider();

    editorListener(makeEditor('file:///B.kt', 100, 25));
    selectionListener(selectionEvent('file:///B.kt', 100, vscode.TextEditorSelectionChangeKind.Command, 25));

    await registeredCmds.get('kotlinJump.navigateBack')!();
    await tick();
    lastShowTextOptions = undefined;
    lastEditorSelectionSet = undefined;

    await registeredCmds.get('kotlinJump.navigateForward')!();
    await tick();

    const passedSel: vscode.Range | undefined = lastShowTextOptions?.selection;
    const setSel:    vscode.Selection | undefined = lastEditorSelectionSet;
    const finalLine = passedSel?.start.line      ?? setSel?.active.line;
    const finalChar = passedSel?.start.character ?? setSel?.active.character;

    expect(finalLine).toBe(100);
    expect(finalChar).toBe(25);
    p.dispose();
  });
});

// ── BUG 2 — Forward broken cross-file after Back ────────────────────────────

describe('ADV-NAV-2 — Forward survives a late Command-kind selection event', () => {
  it('forward history is NOT trimmed when a late selection event arrives after Back navigation', async () => {
    (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 1);
    const p = new NavigationHistoryProvider();
    selectionListener(selectionEvent('file:///A.kt', 1, vscode.TextEditorSelectionChangeKind.Keyboard, 0));

    editorListener(makeEditor('file:///B.kt', 100));
    selectionListener(selectionEvent('file:///B.kt', 100, vscode.TextEditorSelectionChangeKind.Command, 0));

    expect(p.historyLength).toBe(2);

    // Back → cursor goes from 1 to 0 (A entry).
    await registeredCmds.get('kotlinJump.navigateBack')!();
    expect(p.cursor).toBe(0);

    // Late Command selection event for A — VS Code restored its
    // viewstate AFTER _isNavigating was cleared. A naive provider
    // would PUSH this event, trimming the forward entry [B].
    await tick();
    selectionListener(selectionEvent('file:///A.kt', 1, vscode.TextEditorSelectionChangeKind.Command, 0));

    // Forward should still have B as the next entry — the provider
    // must absorb the late event during a navigation grace window.
    expect(p.historyLength).toBe(2);
    await registeredCmds.get('kotlinJump.navigateForward')!();
    expect(p.cursor).toBe(1);
    p.dispose();
  });

  it('selection option is passed to showTextDocument for atomic placement', async () => {
    (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 5, 7);
    const p = new NavigationHistoryProvider();
    selectionListener(selectionEvent('file:///A.kt', 5, vscode.TextEditorSelectionChangeKind.Keyboard, 7));

    editorListener(makeEditor('file:///B.kt', 0, 0));
    selectionListener(selectionEvent('file:///B.kt', 1, vscode.TextEditorSelectionChangeKind.Command, 0));

    await registeredCmds.get('kotlinJump.navigateBack')!();

    // The selection option received by showTextDocument is the
    // single source of truth — VS Code applies it atomically.
    expect(lastShowTextOptions?.selection).toBeDefined();
    expect(lastShowTextOptions.selection.start.line).toBe(5);
    expect(lastShowTextOptions.selection.start.character).toBe(7);
    p.dispose();
  });

  it('late Command-kind selection events arriving AFTER setTimeout(0) cleared _isNavigating are absorbed', async () => {
    // Scenario this test pins: post-fix, _navigatingToUri remains set
    // for ~500 ms, so Command events arriving in the window are eaten.
    (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 1);
    const p = new NavigationHistoryProvider();
    selectionListener(selectionEvent('file:///A.kt', 1, vscode.TextEditorSelectionChangeKind.Keyboard, 0));

    editorListener(makeEditor('file:///B.kt', 5));
    selectionListener(selectionEvent('file:///B.kt', 5, vscode.TextEditorSelectionChangeKind.Command, 0));
    editorListener(makeEditor('file:///C.kt', 9));
    selectionListener(selectionEvent('file:///C.kt', 9, vscode.TextEditorSelectionChangeKind.Command, 0));

    expect(p.historyLength).toBe(3);

    await registeredCmds.get('kotlinJump.navigateBack')!(); // → B
    expect(p.cursor).toBe(1);

    // Three late events fire in quick succession — viewstate restore,
    // cursor restore, etc. None must push.
    await tick();
    selectionListener(selectionEvent('file:///B.kt', 5, vscode.TextEditorSelectionChangeKind.Command, 0));
    selectionListener(selectionEvent('file:///B.kt', 5, vscode.TextEditorSelectionChangeKind.Command, 0));
    selectionListener(selectionEvent('file:///B.kt', 5, vscode.TextEditorSelectionChangeKind.Command, 0));
    expect(p.historyLength).toBe(3); // not trimmed

    await registeredCmds.get('kotlinJump.navigateForward')!(); // → C
    expect(p.cursor).toBe(2);
    p.dispose();
  });

  it('rapid double Back never trims the stack from the inside', async () => {
    (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 1);
    const p = new NavigationHistoryProvider();
    selectionListener(selectionEvent('file:///A.kt', 1, vscode.TextEditorSelectionChangeKind.Keyboard, 0));
    editorListener(makeEditor('file:///B.kt', 5));
    selectionListener(selectionEvent('file:///B.kt', 5, vscode.TextEditorSelectionChangeKind.Command, 0));
    editorListener(makeEditor('file:///C.kt', 9));
    selectionListener(selectionEvent('file:///C.kt', 9, vscode.TextEditorSelectionChangeKind.Command, 0));

    // Double-back without yielding to the event loop in between.
    await Promise.all([
      registeredCmds.get('kotlinJump.navigateBack')!(),
      registeredCmds.get('kotlinJump.navigateBack')!(),
    ]);
    expect(p.cursor).toBe(0);
    expect(p.historyLength).toBe(3);
    p.dispose();
  });

  it('Back to a same-file entry preserves column too', async () => {
    (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 1, 0);
    const p = new NavigationHistoryProvider();
    selectionListener(selectionEvent('file:///A.kt', 1, vscode.TextEditorSelectionChangeKind.Keyboard, 0));

    // User Cmd+Click within A — same-file Command jump from (1,0) to (50, 12).
    // The Command branch deduplicates the (1,0) starting position because
    // the seed entry already matches, so we land at length 2.
    selectionListener(selectionEvent('file:///A.kt', 50, vscode.TextEditorSelectionChangeKind.Command, 12));
    expect(p.historyLength).toBe(2); // [A:(1,0)init, A:(50,12)to]

    await registeredCmds.get('kotlinJump.navigateBack')!();
    const passedSel = lastShowTextOptions?.selection;
    expect(passedSel?.start.line).toBe(1);
    // Column 0 was the original — column preservation is the property.
    expect(passedSel?.start.character).toBe(0);
    p.dispose();
  });

  it('back-then-forward across THREE files works (A → B → C → back back forward forward)', async () => {
    (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 1);
    const p = new NavigationHistoryProvider();
    selectionListener(selectionEvent('file:///A.kt', 1, vscode.TextEditorSelectionChangeKind.Keyboard, 0));

    editorListener(makeEditor('file:///B.kt', 5));
    selectionListener(selectionEvent('file:///B.kt', 5, vscode.TextEditorSelectionChangeKind.Command, 0));
    editorListener(makeEditor('file:///C.kt', 9));
    selectionListener(selectionEvent('file:///C.kt', 9, vscode.TextEditorSelectionChangeKind.Command, 0));

    expect(p.historyLength).toBe(3);
    expect(p.cursor).toBe(2);

    await registeredCmds.get('kotlinJump.navigateBack')!();    // → B
    await tick();
    selectionListener(selectionEvent('file:///B.kt', 5, vscode.TextEditorSelectionChangeKind.Command, 0));
    expect(p.cursor).toBe(1);
    expect(p.historyLength).toBe(3); // forward to C still possible

    await registeredCmds.get('kotlinJump.navigateBack')!();    // → A
    await tick();
    selectionListener(selectionEvent('file:///A.kt', 1, vscode.TextEditorSelectionChangeKind.Command, 0));
    expect(p.cursor).toBe(0);
    expect(p.historyLength).toBe(3);

    await registeredCmds.get('kotlinJump.navigateForward')!(); // → B
    await tick();
    selectionListener(selectionEvent('file:///B.kt', 5, vscode.TextEditorSelectionChangeKind.Command, 0));
    expect(p.cursor).toBe(1);

    await registeredCmds.get('kotlinJump.navigateForward')!(); // → C
    await tick();
    selectionListener(selectionEvent('file:///C.kt', 9, vscode.TextEditorSelectionChangeKind.Command, 0));
    expect(p.cursor).toBe(2);

    p.dispose();
  });
});
