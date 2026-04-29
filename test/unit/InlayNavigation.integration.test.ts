/**
 * Integration tests for the inlay-hint navigation wrapper.
 *
 * Bug context: cmd+click on a parameter inlay (`User(name: "John Doe", …)` →
 * inlay shows `name =`) used to pop the Find Usages panel ON TOP of the
 * navigation. Cause: VS Code re-fires `provideDefinition` at the new cursor
 * after vscode.open lands on a workspace declaration; that call lands AT the
 * parameter declaration → sets `_pendingDeclNav` → the selection-change
 * listener consumes it → fires `goToReferences`.
 *
 * Fix: `navigateFromInlay` clears `_pendingDeclNav` BEFORE and AFTER calling
 * vscode.open, so any post-navigation pending state is neutralised before the
 * listener runs.
 *
 * These tests exercise the contract end-to-end with a stubbed `vscode.open`:
 *  1. Pending is cleared before vscode.open is invoked.
 *  2. Pending is cleared after vscode.open returns, even if it gets set
 *     during the open() call (simulating VS Code's post-nav re-fire).
 *  3. The InlayHintsProvider wires its label parts to the wrapper command.
 *  4. The wrapper passes through the (uri, showOptions) arguments untouched.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from './__mocks__/vscode';
import {
  navigateFromInlay,
  getPendingDeclNav,
  clearPendingDeclNav,
  isInlayNavSuppressed,
  _setPendingDeclNavForTest,
  _getInlayNavSuppressUntilMsForTest,
  _setInlayNavSuppressUntilMsForTest,
} from '../../src/providers/DefinitionProvider';
import { KotlinInlayHintsProvider } from '../../src/providers/InlayHintsProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Position, Range } from './__mocks__/vscode';

const NULL_LOG = {
  info: () => {}, debug: () => {}, warn: () => {}, error: () => {},
} as any;
const TOKEN = { isCancellationRequested: false } as any;

beforeEach(() => {
  clearPendingDeclNav();
  _setInlayNavSuppressUntilMsForTest(0);
  vi.restoreAllMocks();
});

// ── 1. Wrapper clears pending BEFORE vscode.open ─────────────────────────

describe('navigateFromInlay — pending state guards', () => {
  it('clears pending state before invoking vscode.open', async () => {
    _setPendingDeclNavForTest({ uri: 'file:///stale.kt', line: 42, word: 'stale' });
    expect(getPendingDeclNav()).toBeDefined();                       // sanity

    let pendingObservedDuringOpen: ReturnType<typeof getPendingDeclNav>;
    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async () => {
      pendingObservedDuringOpen = getPendingDeclNav();
    });

    await navigateFromInlay(
      vscode.Uri.file('/User.kt'),
      { selection: new Range(new Position(2, 4), new Position(2, 8)) } as any,
    );

    expect(pendingObservedDuringOpen, 'pending must be cleared before vscode.open runs').toBeUndefined();
  });

  it('clears pending state AFTER vscode.open returns — even if it was re-set during open()', async () => {
    // Simulate VS Code's post-navigation provideDefinition refire by SETTING
    // pending DURING the vscode.open call.
    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async () => {
      _setPendingDeclNavForTest({ uri: 'file:///User.kt', line: 2, word: 'name' });
    });

    await navigateFromInlay(
      vscode.Uri.file('/User.kt'),
      { selection: new Range(new Position(2, 4), new Position(2, 8)) } as any,
    );

    expect(
      getPendingDeclNav(),
      'pending must be cleared post-navigation to neutralise the smart-nav listener',
    ).toBeUndefined();
  });

  it('forwards (uri, showOptions) verbatim to vscode.open', async () => {
    const calls: any[] = [];
    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (...args: any[]) => {
      calls.push(args);
    });

    const targetUri = vscode.Uri.file('/User.kt');
    const opts = {
      selection: new Range(new Position(2, 4), new Position(2, 8)),
      preview: true,
      preserveFocus: false,
    } as any;

    await navigateFromInlay(targetUri, opts);

    expect(calls).toHaveLength(1);
    const [cmd, uri, showOpts] = calls[0];
    expect(cmd).toBe('vscode.open');
    expect(uri).toBe(targetUri);
    expect(showOpts).toBe(opts);
  });

  it('still clears pending if vscode.open throws (defensive)', async () => {
    _setPendingDeclNavForTest({ uri: 'file:///stale.kt', line: 1, word: 'x' });

    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async () => {
      throw new Error('navigation failed');
    });

    await expect(navigateFromInlay(
      vscode.Uri.file('/User.kt'),
      {} as any,
    )).rejects.toThrow('navigation failed');

    // The pre-call clear ran. The post-call clear didn't (because we threw),
    // but the pre-call already neutralised the stale state. Either way, the
    // listener can't fire spuriously after this.
    expect(getPendingDeclNav()).toBeUndefined();
  });
});

// ── 2. InlayHintsProvider wires the wrapper command, not raw vscode.open ──

describe('InlayHintsProvider → navigateFromInlay wiring', () => {
  it('parameter inlay\'s labelPart.command points at kotlin-jump._navigateInlay', async () => {
    const idx = new SymbolIndex();
    const uri = 'file:///User.kt';
    const code =
      'data class User(\n' +
      '    val id: String,\n' +
      '    val name: String,\n' +
      ')\n' +
      '\n' +
      'fun mk(): User {\n' +
      '    return User("a", "John Doe")\n' +
      '}\n';
    idx.add(parse(uri, code));

    // Provider opens the declaring doc to compute per-param locations.
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue(
      mockDocument(uri, code) as any,
    );

    const provider = new KotlinInlayHintsProvider(idx, NULL_LOG);
    const doc = mockDocument(uri, code);
    const lines = code.split('\n');
    const range = new Range(
      new Position(0, 0),
      new Position(lines.length - 1, lines[lines.length - 1].length),
    );

    const hints = await provider.provideInlayHints(doc, range, TOKEN);
    expect(hints).toBeDefined();
    expect(hints!.length).toBeGreaterThan(0);

    // First hint corresponds to first arg ("a") → param `id`
    const firstHint = hints![0];
    const labelPart = (firstHint.label as any[])[0];
    expect(labelPart.command).toBeDefined();
    expect(labelPart.command.command).toBe('kotlin-jump._navigateInlay');
    expect(labelPart.command.arguments).toBeDefined();
    expect(labelPart.command.arguments.length).toBe(2);
    // arg[0] is a vscode.Uri, arg[1] is TextDocumentShowOptions
    expect(labelPart.command.arguments[0]).toBeDefined();
    const showOpts = labelPart.command.arguments[1];
    expect(showOpts.preserveFocus).toBe(false);
    expect(showOpts.preview).toBe(true);
    expect(showOpts.selection).toBeDefined();
  });

  it('every parameter inlay in a multi-arg call uses the wrapper command', async () => {
    const idx = new SymbolIndex();
    const uri = 'file:///User.kt';
    const code =
      'data class User(\n' +
      '    val id: String,\n' +
      '    val name: String,\n' +
      '    val email: String,\n' +
      ')\n' +
      '\n' +
      'fun mk(): User {\n' +
      '    return User("a", "John Doe", "j@example.com")\n' +
      '}\n';
    idx.add(parse(uri, code));

    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue(
      mockDocument(uri, code) as any,
    );

    const provider = new KotlinInlayHintsProvider(idx, NULL_LOG);
    const doc = mockDocument(uri, code);
    const lines = code.split('\n');
    const range = new Range(
      new Position(0, 0),
      new Position(lines.length - 1, lines[lines.length - 1].length),
    );

    const hints = await provider.provideInlayHints(doc, range, TOKEN);
    const paramHints = hints!.filter(h =>
      Array.isArray(h.label) && h.label.length > 0 && (h.label as any[])[0].command,
    );
    expect(paramHints.length).toBeGreaterThanOrEqual(3);

    for (const h of paramHints) {
      const labelPart = (h.label as any[])[0];
      expect(
        labelPart.command.command,
        `inlay "${labelPart.value}" must route through the wrapper`,
      ).toBe('kotlin-jump._navigateInlay');
    }
  });

  it('inlay command targets are equivalent to label part locations (same destination)', async () => {
    const idx = new SymbolIndex();
    const uri = 'file:///User.kt';
    const code =
      'data class User(\n' +
      '    val id: String,\n' +
      '    val name: String,\n' +
      ')\n' +
      '\n' +
      'fun mk(): User {\n' +
      '    return User("a", "b")\n' +
      '}\n';
    idx.add(parse(uri, code));

    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue(
      mockDocument(uri, code) as any,
    );

    const provider = new KotlinInlayHintsProvider(idx, NULL_LOG);
    const doc = mockDocument(uri, code);
    const lines = code.split('\n');
    const range = new Range(
      new Position(0, 0),
      new Position(lines.length - 1, lines[lines.length - 1].length),
    );
    const hints = await provider.provideInlayHints(doc, range, TOKEN);
    expect(hints!.length).toBeGreaterThan(0);

    for (const h of hints!) {
      const labelPart = (h.label as any[])[0];
      if (!labelPart?.command) continue;
      const cmdUri = labelPart.command.arguments[0];
      const cmdSelection = labelPart.command.arguments[1].selection;
      const locUri = labelPart.location.uri;
      const locRange = labelPart.location.range;
      expect(cmdUri.toString()).toBe(locUri.toString());
      expect(cmdSelection.start.line).toBe(locRange.start.line);
    }
  });
});

// ── 3. End-to-end race scenario ──────────────────────────────────────────

describe('navigateFromInlay — end-to-end race scenario', () => {
  it('reproduces the bug shape and verifies the fix neutralises it', async () => {
    // Reproduces the exact race from the user's report:
    //  1. User cmd+clicks an inlay in ApiServiceImpl.kt
    //  2. The wrapper invokes vscode.open
    //  3. While open() is running, VS Code re-fires provideDefinition
    //     at the new cursor → that call lands at the param declaration
    //     → sets `_pendingDeclNav` (simulated below)
    //  4. After open() returns, the wrapper clears pending again
    //  5. The selection-change listener then sees pending=undefined → no
    //     spurious goToReferences

    let openCalls = 0;
    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (cmd: string) => {
      if (cmd === 'vscode.open') {
        openCalls++;
        // Simulate the post-navigation provideDefinition refire racing with us
        _setPendingDeclNavForTest({ uri: 'file:///User.kt', line: 2, word: 'name' });
      }
    });

    expect(getPendingDeclNav()).toBeUndefined();
    await navigateFromInlay(
      vscode.Uri.file('/User.kt'),
      { selection: new Range(new Position(2, 4), new Position(2, 8)) } as any,
    );

    expect(openCalls).toBe(1);
    expect(
      getPendingDeclNav(),
      'BUG GUARD: pending must be undefined when the selection-change listener subsequently fires',
    ).toBeUndefined();
  });

  it('regression: multiple inlay clicks in a row never leak pending state', async () => {
    // A user might cmd+click several inlays in quick succession. Each
    // navigation must leave the pending state empty.
    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async () => {
      _setPendingDeclNavForTest({ uri: 'file:///User.kt', line: 0, word: 'x' });
    });

    for (let i = 0; i < 5; i++) {
      await navigateFromInlay(vscode.Uri.file('/User.kt'), {} as any);
      expect(getPendingDeclNav(), `iteration ${i}: pending must be cleared`).toBeUndefined();
    }
  });
});

// ── 4. Suppression-window guard (post-navigation race) ───────────────────

describe('navigateFromInlay — temporal suppression window', () => {
  it('arms the suppression window at the start of the wrapper', async () => {
    expect(isInlayNavSuppressed()).toBe(false);

    let suppressedDuringOpen = false;
    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async () => {
      suppressedDuringOpen = isInlayNavSuppressed();
    });

    await navigateFromInlay(vscode.Uri.file('/User.kt'), {} as any);
    expect(suppressedDuringOpen, 'must be suppressed while vscode.open is running').toBe(true);
  });

  it('keeps the suppression window armed AFTER the wrapper returns', async () => {
    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async () => {});
    await navigateFromInlay(vscode.Uri.file('/User.kt'), {} as any);
    // Immediately after return: suppression window still active
    expect(isInlayNavSuppressed()).toBe(true);
    // Deadline must be in the future, ~800ms ahead
    const remainingMs = _getInlayNavSuppressUntilMsForTest() - Date.now();
    expect(remainingMs).toBeGreaterThan(500);
    expect(remainingMs).toBeLessThanOrEqual(800);
  });

  it('suppression window expires naturally after ~800 ms', async () => {
    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async () => {});
    await navigateFromInlay(vscode.Uri.file('/User.kt'), {} as any);
    expect(isInlayNavSuppressed()).toBe(true);

    // Simulate clock advance past the deadline by checking with a future "now"
    const deadline = _getInlayNavSuppressUntilMsForTest();
    expect(isInlayNavSuppressed(deadline + 1)).toBe(false);
    expect(isInlayNavSuppressed(deadline - 1)).toBe(true);
  });

  it('the listener guard ignores pending entirely while suppression is active', async () => {
    // Simulate the EXACT bug shape: post-navigation provideDefinition refire
    // sets pending DURING the suppression window. The listener (whose logic
    // we replicate inline below) must clear the pending and return without
    // firing goToReferences.
    _setPendingDeclNavForTest({ uri: 'file:///User.kt', line: 6, word: 'get' });
    _setInlayNavSuppressUntilMsForTest(Date.now() + 500); // active

    // Mimic the listener's first guard:
    let firedGoToReferences = false;
    if (isInlayNavSuppressed()) {
      clearPendingDeclNav();
      // do not fire
    } else {
      firedGoToReferences = true;
    }

    expect(firedGoToReferences, 'goToReferences MUST NOT fire during suppression').toBe(false);
    expect(getPendingDeclNav()).toBeUndefined();
  });

  it('outside the suppression window, the listener resumes normal smart-nav behaviour', async () => {
    _setPendingDeclNavForTest({ uri: 'file:///Decl.kt', line: 5, word: 'foo' });
    _setInlayNavSuppressUntilMsForTest(Date.now() - 1); // expired

    expect(isInlayNavSuppressed()).toBe(false);
    // Pending is still readable — the listener will consume it normally
    expect(getPendingDeclNav()).toBeDefined();
  });
});
