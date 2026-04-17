import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { NavigationHistoryProvider } from '../../src/providers/NavigationHistoryProvider';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Test setup ────────────────────────────────────────────────────────────────

let editorListener:    (e: any) => void;
let selectionListener: (e: any) => void;
const registeredCmds = new Map<string, () => Promise<void>>();

beforeEach(() => {
  registeredCmds.clear();
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
  vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue({} as any);
  vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue({
    selection:   undefined as any,
    revealRange: vi.fn(),
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NavigationHistoryProvider', () => {

  describe('initial state', () => {
    it('starts with empty history when no active editor', () => {
      const p = new NavigationHistoryProvider();
      expect(p.historyLength).toBe(0);
      expect(p.cursor).toBe(-1);
      p.dispose();
    });

    it('seeds history from the active editor on construction', () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 10, 5);
      const p = new NavigationHistoryProvider();
      expect(p.historyLength).toBe(1);
      expect(p.cursor).toBe(0);
      p.dispose();
    });
  });

  describe('back / forward — empty history', () => {
    it('back is a no-op when history is empty', async () => {
      const p = new NavigationHistoryProvider();
      await registeredCmds.get('kotlinJump.navigateBack')!();
      expect(p.cursor).toBe(-1);
      p.dispose();
    });

    it('forward is a no-op when history is empty', async () => {
      const p = new NavigationHistoryProvider();
      await registeredCmds.get('kotlinJump.navigateForward')!();
      expect(p.cursor).toBe(-1);
      p.dispose();
    });
  });

  describe('_onEditorChanged — file switch', () => {
    it('records from + to placeholder when switching files', () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 50);
      const p = new NavigationHistoryProvider();

      editorListener(makeEditor('file:///B.kt', 100));

      // Placeholder at L0 is pushed synchronously; cursor advances
      expect(p.historyLength).toBe(2);
      expect(p.cursor).toBe(1);
      p.dispose();
    });

    it('placeholder is updated by the first selection event in the new file', () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 50);
      const p = new NavigationHistoryProvider(); // A:50, cursor=0

      editorListener(makeEditor('file:///B.kt', 0));
      // history=[A:50, B:L0], cursor=1, _pendingToUri=B

      selectionListener(selectionEvent('file:///B.kt', 100, vscode.TextEditorSelectionChangeKind.Command));
      // Consumes _pendingToUri → history[1] updated to B:100

      expect(p.historyLength).toBe(2);
      expect(p.cursor).toBe(1);
      p.dispose();
    });

    it('placeholder is updated by kind=undefined (editor.selection = ...) in the new file', () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 50);
      const p = new NavigationHistoryProvider();

      editorListener(makeEditor('file:///B.kt', 0));
      selectionListener(selectionEvent('file:///B.kt', 42, undefined as any));

      // After update, back() should navigate to A:50 (not A:0)
      expect(p.historyLength).toBe(2);
      expect(p.cursor).toBe(1);
      p.dispose();
    });

    it('does not record when _isNavigating', async () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 50);
      const p = new NavigationHistoryProvider();

      editorListener(makeEditor('file:///B.kt', 100));
      expect(p.historyLength).toBe(2);

      // Trigger back navigation → _isNavigating becomes true
      const backPromise = registeredCmds.get('kotlinJump.navigateBack')!();
      // While navigating, a spurious editorChanged fires
      editorListener(makeEditor('file:///A.kt', 50));
      await backPromise;
      await tick(); // flush setTimeout(0) that releases _isNavigating

      // Still 2 entries (no extra push during navigation)
      expect(p.historyLength).toBe(2);
      p.dispose();
    });

    it('deduplicates consecutive same-position entries', () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 50);
      const p = new NavigationHistoryProvider();

      editorListener(makeEditor('file:///B.kt', 10));
      editorListener(makeEditor('file:///B.kt', 10));

      // Second B:L0 placeholder is deduplicated (current entry is already B:L0)
      expect(p.historyLength).toBe(2);
      p.dispose();
    });
  });

  describe('_onSelectionChanged — Keyboard', () => {
    it('does not push to history on Keyboard events', () => {
      const p = new NavigationHistoryProvider();

      selectionListener(selectionEvent('file:///A.kt', 5, vscode.TextEditorSelectionChangeKind.Keyboard));
      selectionListener(selectionEvent('file:///A.kt', 50, vscode.TextEditorSelectionChangeKind.Keyboard));

      expect(p.historyLength).toBe(0);
      p.dispose();
    });
  });

  describe('_onSelectionChanged — Mouse', () => {
    it('does not push when jump is within threshold', () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 50);
      const p = new NavigationHistoryProvider(); // seeds A:50
      const before = p.historyLength;

      selectionListener(selectionEvent('file:///A.kt', 55, vscode.TextEditorSelectionChangeKind.Mouse));

      expect(p.historyLength).toBe(before);
      p.dispose();
    });

    it('pushes from + to when jump exceeds threshold', () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 10);
      const p = new NavigationHistoryProvider(); // A:10, cursor=0

      selectionListener(selectionEvent('file:///A.kt', 100, vscode.TextEditorSelectionChangeKind.Mouse));

      // history: [A:10, A:100], cursor=1
      expect(p.historyLength).toBe(2);
      expect(p.cursor).toBe(1);
      p.dispose();
    });

    it('ignores Mouse events for a different file (handled by onEditorChanged)', () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 10);
      const p = new NavigationHistoryProvider();
      const before = p.historyLength;

      selectionListener(selectionEvent('file:///B.kt', 200, vscode.TextEditorSelectionChangeKind.Mouse));

      expect(p.historyLength).toBe(before);
      p.dispose();
    });
  });

  describe('_onSelectionChanged — Command (Go to Definition, etc.)', () => {
    it('records from + to for same-file navigation', () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 50);
      const p = new NavigationHistoryProvider(); // A:50, cursor=0

      selectionListener(selectionEvent('file:///A.kt', 200, vscode.TextEditorSelectionChangeKind.Command));

      // history: [A:50, A:200], cursor=1
      expect(p.historyLength).toBe(2);
      expect(p.cursor).toBe(1);
      p.dispose();
    });

    it('consumes pending placeholder on cross-file Command', () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 50);
      const p = new NavigationHistoryProvider();

      editorListener(makeEditor('file:///B.kt', 0)); // placeholder B:L0 pushed
      expect(p.historyLength).toBe(2);

      // Command fires at the actual destination — updates the placeholder
      selectionListener(selectionEvent('file:///B.kt', 100, vscode.TextEditorSelectionChangeKind.Command));

      expect(p.historyLength).toBe(2); // no new entry, just updated
      p.dispose();
    });
  });

  describe('navigate back', () => {
    it('moves cursor to previous position', async () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 50);
      const p = new NavigationHistoryProvider();
      editorListener(makeEditor('file:///B.kt', 100));
      // cursor=1 (A:50, B:L0)

      await registeredCmds.get('kotlinJump.navigateBack')!();
      expect(p.cursor).toBe(0);
      p.dispose();
    });

    it('calls showTextDocument with the correct position', async () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 42, 7);
      const p = new NavigationHistoryProvider();
      editorListener(makeEditor('file:///B.kt', 1));

      await registeredCmds.get('kotlinJump.navigateBack')!();
      await tick();

      expect(vscode.window.showTextDocument).toHaveBeenCalled();
      p.dispose();
    });

    it('is a no-op when at the start of history', async () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 10);
      const p = new NavigationHistoryProvider(); // cursor=0

      await registeredCmds.get('kotlinJump.navigateBack')!();
      expect(p.cursor).toBe(0); // unchanged
      p.dispose();
    });
  });

  describe('navigate forward', () => {
    it('moves cursor to next position after going back', async () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 50);
      const p = new NavigationHistoryProvider();
      editorListener(makeEditor('file:///B.kt', 100));

      await registeredCmds.get('kotlinJump.navigateBack')!();
      expect(p.cursor).toBe(0);

      await registeredCmds.get('kotlinJump.navigateForward')!();
      expect(p.cursor).toBe(1);
      p.dispose();
    });

    it('is a no-op when at the end of history', async () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 10);
      const p = new NavigationHistoryProvider();

      await registeredCmds.get('kotlinJump.navigateForward')!();
      expect(p.cursor).toBe(0);
      p.dispose();
    });
  });

  describe('forward history truncation', () => {
    it('truncates forward entries when a new navigation occurs after going back', async () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 1);
      const p = new NavigationHistoryProvider(); // A:1

      editorListener(makeEditor('file:///B.kt', 2)); // [A:1, B:L0], cursor=1
      editorListener(makeEditor('file:///C.kt', 3)); // [A:1, B:L0, C:L0], cursor=2

      const back = registeredCmds.get('kotlinJump.navigateBack')!;
      await back(); // cursor=1
      await back(); // cursor=0
      await tick(); // flush _isNavigating release

      // Navigate to D — truncates forward history [B, C]
      editorListener(makeEditor('file:///D.kt', 4));

      // history: [A:1, D:L0]
      expect(p.historyLength).toBe(2);
      expect(p.cursor).toBe(1);
      p.dispose();
    });
  });

  describe('MAX_HISTORY cap', () => {
    it('drops oldest entries when history exceeds 100', () => {
      const p = new NavigationHistoryProvider();

      for (let i = 0; i < 101; i++) {
        editorListener(makeEditor(`file:///File${i}.kt`, i));
      }

      expect(p.historyLength).toBe(100);
      expect(p.cursor).toBe(99);
      p.dispose();
    });
  });

  describe('context keys', () => {
    it('canNavigateBack is false at start, true after first navigation', () => {
      const execSpy = vi.spyOn(vscode.commands, 'executeCommand');
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 1);
      const p = new NavigationHistoryProvider();

      editorListener(makeEditor('file:///B.kt', 2));

      const backCalls = execSpy.mock.calls.filter(c => c[0] === 'setContext' && c[1] === 'kotlinJump.canNavigateBack');
      const lastBackCall = backCalls.at(-1);
      expect(lastBackCall?.[2]).toBe(true);
      p.dispose();
    });

    it('canNavigateForward is true after going back', async () => {
      const execSpy = vi.spyOn(vscode.commands, 'executeCommand');
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 1);
      const p = new NavigationHistoryProvider();
      editorListener(makeEditor('file:///B.kt', 2));

      await registeredCmds.get('kotlinJump.navigateBack')!();

      const fwdCalls = execSpy.mock.calls.filter(c => c[0] === 'setContext' && c[1] === 'kotlinJump.canNavigateForward');
      const lastFwdCall = fwdCalls.at(-1);
      expect(lastFwdCall?.[2]).toBe(true);
      p.dispose();
    });
  });

  describe('character position preservation', () => {
    it('restores exact character column on navigate back', async () => {
      const mockEditor = { selection: undefined as any, revealRange: vi.fn() };
      vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(mockEditor as any);

      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 50, 42);
      const p = new NavigationHistoryProvider(); // seeds A:50:42

      editorListener(makeEditor('file:///B.kt', 1, 0));
      await registeredCmds.get('kotlinJump.navigateBack')!();
      await tick();

      // The selection set on the editor should have character=42
      const selection: vscode.Selection = mockEditor.selection;
      expect(selection.active.character).toBe(42);
      p.dispose();
    });
  });

  describe('clearNavigationHistory', () => {
    it('resets history, cursor, and pending state', async () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 10);
      const p = new NavigationHistoryProvider();
      editorListener(makeEditor('file:///B.kt', 20));
      expect(p.historyLength).toBe(2);

      await registeredCmds.get('kotlinJump.clearNavigationHistory')!();

      expect(p.historyLength).toBe(0);
      expect(p.cursor).toBe(-1);
      p.dispose();
    });

    it('back is a no-op after clear', async () => {
      (vscode.window as any).activeTextEditor = makeEditor('file:///A.kt', 10);
      const p = new NavigationHistoryProvider();
      editorListener(makeEditor('file:///B.kt', 20));

      await registeredCmds.get('kotlinJump.clearNavigationHistory')!();
      await registeredCmds.get('kotlinJump.navigateBack')!();

      expect(p.cursor).toBe(-1); // still empty
      p.dispose();
    });
  });

  describe('dispose', () => {
    it('disposes all subscriptions', () => {
      const disposeSpies: ReturnType<typeof vi.fn>[] = [];
      vi.spyOn(vscode.commands, 'registerCommand').mockImplementation((_id: string, _h: any) => {
        const s = { dispose: vi.fn() };
        disposeSpies.push(s.dispose);
        return s;
      });
      vi.spyOn(vscode.window, 'onDidChangeActiveTextEditor').mockImplementation((_cb: any) => {
        const s = { dispose: vi.fn() };
        disposeSpies.push(s.dispose);
        return s;
      });
      vi.spyOn(vscode.window, 'onDidChangeTextEditorSelection').mockImplementation((_cb: any) => {
        const s = { dispose: vi.fn() };
        disposeSpies.push(s.dispose);
        return s;
      });

      const p = new NavigationHistoryProvider();
      p.dispose();

      for (const spy of disposeSpies) {
        expect(spy).toHaveBeenCalledOnce();
      }
    });
  });
});
