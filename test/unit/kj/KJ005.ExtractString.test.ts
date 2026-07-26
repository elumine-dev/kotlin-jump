import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-005 — Extract string resource. CONTRAT :
 *   export function suggestResourceName(literal: string, existing: Set<string>): string
 *   export function escapeForStringsXml(literal: string): string
 *   export function buildReplacement(literal: string, resName: string,
 *     context: 'composable' | 'code'): string
 */
const mod: any = await importOrNull('src/providers/ExtractStringResourceProvider');

describe.skipIf(!mod)('KJ-005 — nommage', () => {
  it('snake_case simple', () => {
    expect(mod.suggestResourceName('Battle ready!', new Set())).toBe('battle_ready');
  });

  it('collision → suffixe', () => {
    expect(mod.suggestResourceName('Battle', new Set(['battle']))).toBe('battle_2');
  });

  it('accents et ponctuation nettoyés', () => {
    expect(mod.suggestResourceName('Pokémon capturé !', new Set())).toBe('pokemon_capture');
  });

  it('longueur bornée (pas de nom de 200 caractères)', () => {
    const long = 'This is a very long disclaimer text that should be truncated somewhere sane';
    expect(mod.suggestResourceName(long, new Set()).length).toBeLessThanOrEqual(40);
  });
});

describe.skipIf(!mod)('KJ-005 — échappement XML', () => {
  it('& < et apostrophe', () => {
    expect(mod.escapeForStringsXml("Ash & Misty's team <3")).toBe(
      "Ash &amp; Misty\\'s team &lt;3"
    );
  });

  it('placeholders %s conservés tels quels', () => {
    expect(mod.escapeForStringsXml('Turn %1$d of 10')).toBe('Turn %1$d of 10');
  });
});

describe.skipIf(!mod)('KJ-005 — remplacement selon le contexte', () => {
  it('composable → stringResource(R.string.x)', () => {
    expect(mod.buildReplacement('"Battle ready!"', 'battle_ready', 'composable')).toBe(
      'stringResource(R.string.battle_ready)'
    );
  });

  it('code classique → R.string.x', () => {
    expect(mod.buildReplacement('"Welcome, trainer!"', 'trainer_welcome', 'code')).toBe(
      'R.string.trainer_welcome'
    );
  });
});
