import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from './harness';

/**
 * KJ-003 — Live templates. CONTRAT : snippets/kotlin.json (format snippets
 * VS Code) + entrée contributes.snippets dans package.json.
 */
const SNIPPETS = path.join(REPO_ROOT, 'snippets', 'kotlin.json');
const present = existsSync(SNIPPETS);

describe.skipIf(!present)('KJ-003 — snippets Android Studio', () => {
  const load = () => JSON.parse(readFileSync(SNIPPETS, 'utf8'));

  it('JSON valide', () => {
    expect(() => load()).not.toThrow();
  });

  it('les préfixes AS attendus existent tous', () => {
    const snippets = load();
    const prefixes = Object.values(snippets).flatMap((s: any) =>
      Array.isArray(s.prefix) ? s.prefix : [s.prefix]
    );
    for (const p of ['logd', 'loge', 'logt', 'todo', 'comp', 'prev', 'vm', 'lazyv', 'ifn', 'inn']) {
      expect(prefixes, `préfixe manquant: ${p}`).toContain(p);
    }
  });

  it('logd référence TAG et place le curseur dans le message', () => {
    const snippets = load();
    const logd: any = Object.values(snippets).find((s: any) =>
      (Array.isArray(s.prefix) ? s.prefix : [s.prefix]).includes('logd')
    );
    const body = (Array.isArray(logd.body) ? logd.body.join('\n') : logd.body) as string;
    expect(body).toContain('Log.d(TAG');
    expect(body).toMatch(/\$\{?[01]/);
  });

  it('prev produit @Preview + @Composable', () => {
    const snippets = load();
    const prev: any = Object.values(snippets).find((s: any) =>
      (Array.isArray(s.prefix) ? s.prefix : [s.prefix]).includes('prev')
    );
    const body = (Array.isArray(prev.body) ? prev.body.join('\n') : prev.body) as string;
    expect(body).toContain('@Preview');
    expect(body).toContain('@Composable');
  });

  it('package.json déclare contributes.snippets pour kotlin', () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const entries = pkg.contributes?.snippets ?? [];
    expect(entries.some((e: any) => e.language === 'kotlin')).toBe(true);
  });
});
