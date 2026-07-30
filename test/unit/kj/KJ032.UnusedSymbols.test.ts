import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DEMO_ROOT, importOrNull } from './harness';

/**
 * KJ-032 — contrat, sur le vrai projet de démo.
 *
 * La suite adversariale prouve les gardes sur des corpus synthétiques ;
 * celle-ci prouve qu'elles tiennent sur des fichiers qu'on peut ouvrir.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP = new Set(['build', '.gradle', 'node_modules', '.git']);
const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];

function scanDemo() {
  const sources: { path: string; text: string }[] = [];
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(full);
      } else if (SOURCE_RE.test(full) || /[\\/]META-INF[\\/]services[\\/]/.test(full)) {
        sources.push({ path: full, text: fs.readFileSync(full, 'utf8') });
      }
    }
  })(DEMO_ROOT);
  return mod.findUnusedSymbols({ sources, testSourceSets: TEST_SETS });
}

const findings = mod ? scanDemo() : [];
const flagged = (name: string) => findings.some((f: any) => f.name === name);
const of = (name: string) => findings.find((f: any) => f.name === name);

describe.skipIf(!mod)('KJ-032 sur le projet de démo', () => {
  it('signale les symboles morts plantés pour ça', () => {
    expect(flagged('GhostMapper')).toBe(true);
    expect(flagged('buildGhostReport')).toBe(true);
    expect(flagged('ghostTimeoutMs')).toBe(true);
    expect(flagged('GhostOrphan')).toBe(true);
  });

  it('ne touche pas à ce que le code référence', () => {
    expect(flagged('formatBadgeLabel')).toBe(false);
    expect(flagged('KeptSerializable')).toBe(false);
  });

  it('les annotations hors allowlist protègent, @Composable seul ne protège pas', () => {
    expect(flagged('GhostPayload')).toBe(false);   // @Serializable
    expect(flagged('GhostPreview')).toBe(false);   // @Preview : le renderer l'appelle
    expect(flagged('GhostComposable')).toBe(true); // @Composable est bénin
  });

  it('un operator n’est jamais signalé : son nom n’apparaît pas au site d’appel', () => {
    expect(flagged('plus')).toBe(false);
  });

  it('les points d’entrée Android restent vivants sans aucun site d’appel', () => {
    expect(flagged('ManifestOnlyWorker')).toBe(false); // <service> du manifest
    expect(flagged('GhostCustomView')).toBe(false);    // FQN dans un layout
    expect(flagged('GhostReflected')).toBe(false);     // littéral + META-INF/services
    expect(flagged('GhostKept')).toBe(false);          // règle -keep
  });

  it('la chaîne d’héritage est suivie jusqu’au type du framework', () => {
    expect(flagged('GhostScreen')).toBe(false);        // : DemoBaseFragment : Fragment
  });

  it('les formes de référence qu’un scan par symbole raterait', () => {
    expect(flagged('GhostAliased')).toBe(false);       // import aliasé
    expect(flagged('GhostQualified')).toBe(false);     // FQN inline sans import
  });

  it('un symbole que seuls les tests utilisent est une catégorie à part', () => {
    const helper = of('GhostTestOnlyHelper');
    expect(helper).toBeDefined();
    expect(helper.verdict).toBe('testOnly');
    expect(helper.testMentions).toBeGreaterThan(0);
  });

  it('un fichier réduit à sa déclaration morte est marqué pour suppression', () => {
    expect(of('GhostOrphan').fileBecomesEmpty).toBe(true);
    expect(of('GhostMapper').fileBecomesEmpty).toBe(false);
  });

  it('l’import laissé derrière est listé, sinon la compilation casse', () => {
    const mapper = of('GhostMapper');
    expect(mapper.staleImports).toHaveLength(1);
    expect(mapper.staleImports[0].path).toContain('UnusedSymbolsStaleImporter');
  });

  it('reste rapide sur le projet de démo', () => {
    const start = performance.now();
    scanDemo();
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
