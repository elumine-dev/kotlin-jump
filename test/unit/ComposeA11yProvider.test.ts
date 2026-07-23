/**
 * ComposeA11yProvider — inline accessibility nudges
 *
 * Vecteurs :
 *   CA-1  contentDescription = null → hint "decorative?"
 *   CA-2  contentDescription renseigné → pas de hint
 *   CA-3  .clickable {} sans role → hint "role?"
 *   CA-4  .clickable(role = ...) / onClickLabel / .semantics → pas de hint
 *   CA-5  Occurrences en commentaire ou string → ignorées
 *   CA-6  Raw string ouverte AVANT la range visible → oracle non désynchronisé
 *   CA-7  Langue java → aucun hint (Compose est Kotlin)
 *   CA-9  Multi-hint : null description ET clickable nu sur des lignes voisines
 *   CA-10 contentDescription = null en appel multi-ligne → détecté quand même
 */

import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { ComposeA11yProvider } from '../../src/providers/ComposeA11yProvider';

function makeDoc(lines: string[], languageId = 'kotlin'): vscode.TextDocument {
  return {
    languageId,
    lineCount: lines.length,
    lineAt: (n: number) => ({ text: lines[n] }),
  } as unknown as vscode.TextDocument;
}

function hintsFor(lines: string[], languageId = 'kotlin'): vscode.InlayHint[] {
  const provider = new ComposeA11yProvider();
  const range = new vscode.Range(0, 0, lines.length - 1, 0) as any;
  return provider.provideInlayHints(makeDoc(lines, languageId), range);
}

function labels(hints: vscode.InlayHint[]): string[] {
  return hints.map(h => String(h.label));
}

describe('CA-1 — contentDescription = null', () => {
  it('Image inline → hint decorative', () => {
    const h = hintsFor(['Image(painter = p, contentDescription = null)']);
    expect(labels(h)).toEqual(['⚠ a11y: decorative?']);
  });

  it('position du hint après le null', () => {
    const line = 'Image(painter = p, contentDescription = null)';
    const h = hintsFor([line]);
    expect(h[0].position.character).toBe(line.indexOf('null') + 4);
  });
});

describe('CA-2 — description renseignée', () => {
  it.each([
    'Image(p, contentDescription = stringResource(R.string.logo))',
    'Image(p, contentDescription = "App logo")',
    'Icon(i, contentDescription = desc)',
  ])('%s → pas de hint', (line) => {
    expect(hintsFor([line])).toHaveLength(0);
  });
});

describe('CA-3 — clickable sans role', () => {
  it('Modifier.clickable {} → hint role', () => {
    const h = hintsFor(['Box(modifier = Modifier.clickable { onTap() })']);
    expect(labels(h)).toEqual(['⚠ a11y: role?']);
  });

  it('clickable( en forme parenthèse sans role → hint', () => {
    const h = hintsFor(['Modifier.clickable(enabled = isEnabled) { onTap() }']);
    expect(labels(h)).toEqual(['⚠ a11y: role?']);
  });
});

describe('CA-4 — clickable correctement annoté', () => {
  it.each([
    'Modifier.clickable(role = Role.Button) { onTap() }',
    'Modifier.clickable(onClickLabel = "open item") { onTap() }',
    'Modifier.semantics { }.clickable { onTap() }',
  ])('%s → pas de hint', (line) => {
    expect(hintsFor([line])).toHaveLength(0);
  });
});

describe('CA-5 — commentaires et strings ignorés', () => {
  it.each([
    '// Image(p, contentDescription = null)',
    ' * contentDescription = null in KDoc',
    'val doc = "use contentDescription = null for decorative"',
    '// Modifier.clickable { }',
  ])('%s → pas de hint', (line) => {
    expect(hintsFor([line])).toHaveLength(0);
  });
});

describe('CA-6 — raw string ouverte avant la range', () => {
  it('le contenu de la raw string ne génère pas de hint', () => {
    const lines = [
      'val snippet = """',
      '  Image(p, contentDescription = null)',
      '  Modifier.clickable { }',
      '"""',
      'Image(p, contentDescription = null)',
    ];
    const provider = new ComposeA11yProvider();
    // Range visible = lignes 1..4 seulement (la """ d'ouverture est hors range)
    const range = new vscode.Range(1, 0, 4, 0) as any;
    const h = provider.provideInlayHints(makeDoc(lines), range);
    expect(labels(h)).toEqual(['⚠ a11y: decorative?']);
    expect(h[0].position.line).toBe(4);
  });
});

describe('CA-7 — java exclu', () => {
  it('même code en java → aucun hint', () => {
    expect(hintsFor(['Image(p, contentDescription = null)'], 'java')).toHaveLength(0);
  });
});

describe('CA-9 — hints multiples', () => {
  it('deux problèmes sur deux lignes → deux hints', () => {
    const h = hintsFor([
      'Image(p, contentDescription = null)',
      'Box(Modifier.clickable { onTap() })',
    ]);
    expect(labels(h)).toEqual(['⚠ a11y: decorative?', '⚠ a11y: role?']);
  });
});

describe('CA-10 — appel multi-ligne', () => {
  it('contentDescription = null sur sa propre ligne → détecté', () => {
    const h = hintsFor([
      'Image(',
      '    painter = painterResource(R.drawable.logo),',
      '    contentDescription = null,',
      ')',
    ]);
    expect(labels(h)).toEqual(['⚠ a11y: decorative?']);
    expect(h[0].position.line).toBe(2);
  });
});
