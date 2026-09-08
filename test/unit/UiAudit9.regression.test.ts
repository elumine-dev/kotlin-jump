// Regression tests for the seventh audit (2026-09-08): companion detection,
// corpus URIs on the web.
import { describe, it, expect, vi } from 'vitest';
import { isJetBrainsKotlinInstalled, resolveCompanionMode } from '../../src/util/companionMode';
import { corpusUri, rememberCorpusUri } from '../../src/util/corpusUri';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

describe('Companion mode auto-detection (was: it looked for JetBrains.kotlin-lsp, an id that never existed)', () => {
  it('recognises the Marketplace id and the GitHub VSIX id', () => {
    const installed = (ids: string[]) => (id: string) => ids.includes(id) ? {} : undefined;
    expect(isJetBrainsKotlinInstalled(installed(['JetBrains.kotlin-server']))).toBe(true);
    expect(isJetBrainsKotlinInstalled(installed(['JetBrains.kotlin']))).toBe(true);
    expect(isJetBrainsKotlinInstalled(installed(['fwcd.kotlin']))).toBe(false);
    expect(resolveCompanionMode('auto', isJetBrainsKotlinInstalled(installed(['JetBrains.kotlin-server'])))).toBe(true);
  });
});

describe('Corpus URIs (was: Uri.file(fsPath) sent every dead-code diagnostic to a phantom file:// path on github.dev)', () => {
  it('returns the remembered URI for a corpus path and falls back to file:// for an unknown one', () => {
    const vfs = { scheme: 'vscode-vfs', authority: 'github', path: '/owner/repo/app/Foo.kt', fsPath: '/owner/repo/app/Foo.kt', toString: () => 'vscode-vfs://github/owner/repo/app/Foo.kt' } as any;
    expect(rememberCorpusUri(vfs)).toBe('/owner/repo/app/Foo.kt');
    expect(corpusUri('/owner/repo/app/Foo.kt')).toBe(vfs);
    expect(corpusUri('/elsewhere/Bar.kt').toString()).toBe('file:///elsewhere/Bar.kt');
  });
});
