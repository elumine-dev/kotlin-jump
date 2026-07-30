import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DEMO_ROOT, importOrNull } from './harness';

/**
 * KJ-031 — contrat, sur le vrai projet de démo.
 *
 * La suite adversariale prouve les gardes sur des corpus synthétiques ; celle-ci
 * prouve qu'elles tiennent sur des fichiers réels que quelqu'un peut ouvrir.
 */

const mod: any = await importOrNull('src/providers/UnusedResourceKeyProvider');
const scanner: any = await importOrNull('src/indexer/ValueResourceScanner');

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP = new Set(['build', '.gradle', 'node_modules', '.git']);

function scanDemo() {
  const sources: { path: string; text: string }[] = [];
  const moduleDirs: string[] = [];
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(full);
      } else {
        if (/[\\/]build\.gradle(\.kts)?$/.test(full)) {
          moduleDirs.push(full.replace(/[\\/]build\.gradle(\.kts)?$/, ''));
        }
        if (SOURCE_RE.test(full)) sources.push({ path: full, text: fs.readFileSync(full, 'utf8') });
      }
    }
  })(DEMO_ROOT);

  const declarations = sources
    .filter(s => scanner.parseValuesPath(s.path) !== undefined)
    .flatMap(s => scanner.collectValueKeyDeclarations(s.path, s.text, moduleDirs));

  const modulesWithCode = moduleDirs.filter(dir =>
    sources.some(s => s.path.startsWith(dir + path.sep) && /\.(kt|java)$/.test(s.path)));

  return {
    declarations,
    findings: mod.findUnusedResourceKeys({ declarations, sources, modulesWithCode }),
  };
}

const cached = mod && scanner ? scanDemo() : undefined;
const flagged = (kind: string, name: string) =>
  cached!.findings.some((f: any) => f.kind === kind && f.name === name);
const declared = (kind: string, name: string) =>
  cached!.declarations.some((d: any) => d.kind === kind && d.name === name);

describe.skipIf(!mod || !scanner)('KJ-031 sur le projet de démo', () => {
  it('énumère les neuf types depuis les fixtures', () => {
    const kinds = new Set(cached!.declarations.map((d: any) => d.kind));
    for (const kind of ['string', 'color', 'dimen', 'style', 'attr', 'integer', 'bool', 'plurals']) {
      expect(kinds.has(kind), `type absent des fixtures : ${kind}`).toBe(true);
    }
  });

  it('signale les clés mortes plantées pour ça', () => {
    expect(flagged('bool', 'kj_bool_dead')).toBe(true);
    expect(flagged('integer', 'kj_int_dead')).toBe(true);
    expect(flagged('plurals', 'kj_plural_dead')).toBe(true);
    expect(flagged('array', 'kj_array_dead')).toBe(true);
    expect(flagged('style', 'Widget.Kj.Dead')).toBe(true);
    expect(flagged('attr', 'kjAttrDead')).toBe(true);
  });

  it('ne touche pas aux clés que le code référence', () => {
    expect(flagged('integer', 'kj_retry_count')).toBe(false);
    expect(flagged('bool', 'kj_feature_on')).toBe(false);
    expect(flagged('style', 'Widget.Kj.Button.Primary')).toBe(false);
  });

  it('un style pointé garde son parent vivant sans mention textuelle', () => {
    // Widget.Kj n'apparaît nulle part ailleurs : seul son enfant le sauve.
    expect(declared('style', 'Widget.Kj')).toBe(true);
    expect(flagged('style', 'Widget.Kj')).toBe(false);
  });

  it('style="@style/…" et ?attr/… dans un layout comptent comme usage', () => {
    expect(flagged('style', 'Widget.Kj.Button')).toBe(false);
    expect(flagged('attr', 'kjAccent')).toBe(false);
  });

  it('un parent explicite sauve, dans les deux formes', () => {
    expect(flagged('style', 'Widget.Kj.Base')).toBe(false);
  });

  it('un membre de declare-styleable est vivant par appartenance', () => {
    expect(flagged('attr', 'kjBadgeColor')).toBe(false);
  });

  it('<attr name="android:textColor"/> n’est même pas une déclaration', () => {
    expect(cached!.declarations.some((d: any) => d.name.includes(':'))).toBe(false);
  });

  it('les clés de SDK tiers ne sont jamais signalées', () => {
    for (const name of [
      'com_braze_api_key', 'fb_login_protocol_scheme',
      'com_braze_handle_push_deep_links_automatically', 'com_braze_session_timeout',
    ]) {
      expect(declared('string', name) || declared('bool', name) || declared('integer', name)).toBe(true);
      expect(cached!.findings.some((f: any) => f.name === name), `signalée à tort : ${name}`).toBe(false);
    }
  });

  it('une clé surchargée en values-night fait une trouvaille à deux variantes', () => {
    const hit = cached!.findings.find((f: any) => f.name === 'kj_night_dead');
    expect(hit).toBeDefined();
    expect(hit.variants).toHaveLength(2);
    expect(hit.base.qualifier).toBe('values');
    expect(hit.variants.map((v: any) => v.qualifier).sort()).toEqual(['values', 'values-night']);
  });

  it('tools: ne sauve pas ce que la fixture KJ-021 déclare mort', () => {
    // legacy_subtitle n'est cité que par un tools:text
    expect(flagged('string', 'legacy_subtitle')).toBe(true);
  });

  it('reste rapide sur le projet de démo', () => {
    const start = performance.now();
    scanDemo();
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
