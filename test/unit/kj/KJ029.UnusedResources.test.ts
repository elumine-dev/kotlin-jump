import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_ROOT, importOrNull } from './harness';

const mod: any = await importOrNull('src/providers/UnusedResourceProvider');
const indexMod: any = await importOrNull('src/indexer/FileResourceIndex');

/** Walks the demo project the way ResourceCorpus does, without vscode. */
function scanDemo(includeDrawables = false) {
  const SKIP = new Set(['node_modules', 'build', '.git', 'out', 'dist', '.gradle']);
  const sources: { path: string; text: string }[] = [];
  const resFiles: string[] = [];
  const moduleDirs: string[] = [];
  (function walk(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue; }
      if (/^build\.gradle(\.kts)?$/.test(e.name)) moduleDirs.push(dir);
      if (/\.(kt|kts|java|xml|gradle|toml|properties)$/.test(e.name)) {
        try { sources.push({ path: p, text: readFileSync(p, 'utf8') }); } catch { /* binary */ }
      }
      if (/[\\/]res[\\/][^\\/]+[\\/][^\\/]+$/.test(p) && statSync(p).isFile()) resFiles.push(p);
    }
  })(DEMO_ROOT);

  const index = new indexMod.FileResourceIndex();
  for (const f of resFiles) index.addFile(f, moduleDirs);
  const modulesWithCode = moduleDirs.filter(d =>
    sources.some(s => s.path.startsWith(`${d}/`) && /\.(kt|java)$/.test(s.path)));
  return mod.findUnusedResources({ entries: index.entries(), sources, modulesWithCode, includeDrawables });
}

describe.skipIf(!mod || !indexMod)('KJ-029 — fixture réelle', () => {
  it('flague exactement les quatre morts non-drawable plantés', () => {
    const names = scanDemo()
      .filter((f: any) => f.kind !== 'drawable' && f.kind !== 'mipmap')
      .map((f: any) => f.name)
      .sort();
    expect(names).toEqual(['fade_kj_dead', 'menu_kj_dead', 'view_kj_dead', 'view_kj_tools_only']);
  });

  it('view_kj_tools_only est mort : un tools:layout ne sauve rien', () => {
    const found = scanDemo().find((f: any) => f.name === 'view_kj_tools_only');
    expect(found).toBeDefined();
    expect(found.kind).toBe('layout');
  });

  it('les vivants sont épargnés, chacun par une forme de référence différente', () => {
    const names = scanDemo(true).map((f: any) => f.name);
    for (const alive of [
      'view_kj_banner',   // R.layout dans le Kotlin
      'view_kj_included', // <include layout=…>
      'view_kj_bound',    // ViewKjBoundBinding
      'view_kj_kept',     // tools:keep
      'menu_kj_main',     // app:menu=…
      'fade_kj_in',       // R.anim
      'config_kj_dynamic',// littéral nu
      'ic_launcher',      // allowlist manifest
      'graph_kj_legacy',  // kind navigation jamais couvert
    ]) {
      expect(names, `« ${alive} » ne doit pas être flagué`).not.toContain(alive);
    }
  });

  it('les variantes de densité forment un seul signalement à deux fichiers', () => {
    const ghost = scanDemo(true).find((f: any) => f.name === 'ic_kj_ghost');
    expect(ghost).toBeDefined();
    expect(ghost.paths).toHaveLength(2);
    expect(ghost.paths.some((p: string) => p.includes('drawable-hdpi'))).toBe(true);
  });

  it('les drawables ne sont pas supprimables par défaut, les autres oui', () => {
    const byName = Object.fromEntries(scanDemo().map((f: any) => [f.name, f.deletable]));
    expect(byName['view_kj_dead']).toBe(true);
    expect(byName['ic_kj_ghost']).toBe(false);
    expect(Object.fromEntries(scanDemo(true).map((f: any) => [f.name, f.deletable]))['ic_kj_ghost']).toBe(true);
  });
});
