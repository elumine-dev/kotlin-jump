/**
 * Which Android applications package a given file, read from the Gradle files
 * of the corpus.
 *
 * G58: a `remoteConfig.all` in kiosk silenced every unread key of portal,
 * two applications that share no module and no Firebase project. Scoping such
 * a guard needs to know which applications a module ends up in.
 *
 * The reading is deliberately narrow: `include(":a:b")` in the root settings
 * file, `project(":a:b")` in the build files, and the application plugin.
 * Anything it cannot follow (a remapped `projectDir`, `projects.a.b`
 * accessors, a dependency on a module it has no build file for) makes the
 * whole graph unknown, and callers keep their workspace-wide behaviour. A
 * wrong graph would hide a reader; no graph only costs findings.
 */

export interface ModuleGraph {
  /** Application module directories that package this file, or undefined when unknown. */
  appsOf(filePath: string): ReadonlySet<string> | undefined;
}

const BUILD_FILE_RE = /[\\/]build\.gradle(?:\.kts)?$/;
const SETTINGS_RE = /[\\/]settings\.gradle(?:\.kts)?$/;
const INCLUDED_BUILD_RE = /[\\/](?:buildSrc|build-logic)[\\/]/;
const PROJECT_DEP_RE = /\bproject\s*\(\s*(?:path\s*[=:]\s*)?["'](:[^"']+)["']/g;
const APPLICATION_RE = /\bcom\.android\.application\b|\bplugins\.android\.application\b|\bandroidApplication\b/;

const slash = (p: string) => p.replace(/\\/g, '/');
const dirOf = (p: string) => slash(p).replace(/\/[^/]*$/, '');
const withoutUnappliedPlugins = (t: string) => t.split('\n').filter(l => !/\bapply\s+false\b/.test(l)).join('\n');

export function readModuleGraph(sources: readonly { path: string; text: string }[]): ModuleGraph | undefined {
  const settings = sources
    .filter(s => SETTINGS_RE.test(s.path) && !INCLUDED_BUILD_RE.test(s.path))
    .sort((a, b) => a.path.length - b.path.length)[0];
  if (!settings || /\bprojectDir\b/.test(settings.text)) return undefined;
  const root = dirOf(settings.path);

  const builds = sources.filter(s => BUILD_FILE_RE.test(s.path) && !INCLUDED_BUILD_RE.test(s.path));
  const modules = new Set(builds.map(b => dirOf(b.path)));
  const deps = new Map<string, string[]>();
  const apps: string[] = [];
  for (const b of builds) {
    if (/\bprojects\.\w/.test(b.text)) return undefined;
    const dir = dirOf(b.path);
    const out: string[] = [];
    PROJECT_DEP_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PROJECT_DEP_RE.exec(b.text)) !== null) {
      const target = `${root}/${m[1].replace(/^:/, '').split(':').join('/')}`;
      if (!modules.has(target)) return undefined;
      out.push(target);
    }
    deps.set(dir, out);
    if (APPLICATION_RE.test(withoutUnappliedPlugins(b.text))) apps.push(dir);
  }

  const packagedBy = new Map<string, Set<string>>();
  for (const app of apps) {
    const seen = new Set<string>([app]);
    const todo = [app];
    while (todo.length > 0) {
      for (const d of deps.get(todo.pop()!) ?? []) if (!seen.has(d)) { seen.add(d); todo.push(d); }
    }
    for (const mod of seen) {
      if (!packagedBy.has(mod)) packagedBy.set(mod, new Set());
      packagedBy.get(mod)!.add(app);
    }
  }

  // Longest first, so a module nested in another's directory wins.
  const byDepth = [...modules].sort((a, b) => b.length - a.length);
  return {
    appsOf(filePath) {
      const p = slash(filePath);
      const mod = byDepth.find(d => p.startsWith(`${d}/`));
      const found = mod === undefined ? undefined : packagedBy.get(mod);
      return found !== undefined && found.size > 0 ? found : undefined;
    },
  };
}
