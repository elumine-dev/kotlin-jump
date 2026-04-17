import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { runCodeLensAction } from '../../src/providers/CodeLensAction';
import { KotlinDefinitionProvider, clearPendingDeclNav, getPendingDeclNav } from '../../src/providers/DefinitionProvider';
import { UsageResult } from '../../src/providers/FindUsagesEngine';
import { mockDocument, positionOf } from './helpers';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

function seedPendingDeclNav(): void {
  const code = `package com.example
class Foo`;
  const index = new SymbolIndex();
  addKt(index, 'file:///Foo.kt', code);
  clearPendingDeclNav();

  const provider = new KotlinDefinitionProvider(index);
  provider.provideDefinition(mockDocument('file:///Foo.kt', code), positionOf(code, 'Foo'));
}

function usageResult(uri: string, line: number, character: number, lineText: string): UsageResult {
  const parsed = vscode.Uri.parse(uri);
  return {
    uri: parsed,
    uriString: parsed.toString(),
    line,
    character,
    lineText,
  };
}

describe('runCodeLensAction', () => {
  beforeEach(() => {
    clearPendingDeclNav();

    (vscode.workspace as any).openTextDocument = vi.fn(async (uri: vscode.Uri) => ({ uri }));
    (vscode.window as any).showTextDocument = vi.fn(async () => ({ selection: undefined }));
    (vscode.commands as any).executeCommand = vi.fn(async () => undefined);
  });

  it('respects smartNavigation=false even when cached CodeLens results exist', async () => {
    seedPendingDeclNav();
    expect(getPendingDeclNav()).toBeDefined();

    (vscode.workspace as any).getConfiguration = () => ({
      get: (key: string, defaultValue: unknown) => key === 'smartNavigation' ? false : defaultValue,
    });

    const results = [
      usageResult('file:///Foo.kt', 1, 6, 'class Foo'),
      usageResult('file:///Bar.kt', 4, 8, 'Foo()'),
    ];
    const populateFromResults = vi.fn(async () => undefined);

    await runCodeLensAction(
      vscode.Uri.parse('file:///Foo.kt'),
      1,
      6,
      'Foo',
      'com.example.Foo',
      {
        getCachedResults: vi.fn(() => Promise.resolve(results)),
        usagesPanel: { populateFromResults },
      },
    );

    expect(getPendingDeclNav()).toBeUndefined();
    // With smartNav=false, the code lens still passes the exclude so that
    // search() can filter the declaration and navigate directly if 1 result.
    expect((vscode.commands as any).executeCommand).toHaveBeenCalledWith(
      'kotlin-jump.findUsages',
      { excludeUri: 'file:///Foo.kt', excludeLine: 1 },
    );
    expect(populateFromResults).not.toHaveBeenCalled();
  });

  it('uses cached results only when smart navigation is enabled', async () => {
    (vscode.workspace as any).getConfiguration = () => ({
      get: (key: string, defaultValue: unknown) => key === 'smartNavigation' ? true : defaultValue,
    });

    const results = [
      usageResult('file:///Foo.kt', 1, 6, 'class Foo'),
      usageResult('file:///Bar.kt', 4, 8, 'Foo()'),
    ];
    const populateFromResults = vi.fn(async () => undefined);

    await runCodeLensAction(
      vscode.Uri.parse('file:///Foo.kt'),
      1,
      6,
      'Foo',
      'com.example.Foo',
      {
        getCachedResults: vi.fn(() => Promise.resolve(results)),
        usagesPanel: { populateFromResults },
      },
    );

    expect((vscode.commands as any).executeCommand).toHaveBeenCalledWith('kotlinJump.findUsages.focus');
    expect(populateFromResults).toHaveBeenCalledWith('Foo', results, {
      excludeUri: 'file:///Foo.kt',
      excludeLine: 1,
    });
    expect((vscode.commands as any).executeCommand).not.toHaveBeenCalledWith('kotlin-jump.findUsages');
  });
});
