/**
 * Git submodules are other repositories. A cleanup that writes into one leaves
 * the parent pointing at a commit that no longer matches the files, and the
 * user has nowhere to commit the result. One open source app vendored two UI
 * libraries this way, and a pass found 2602 cuts inside them.
 *
 * No editor and no Node here: callers read `.gitmodules` their own way.
 */

/** The `path = …` entries of a `.gitmodules` file, relative to its directory, with `/`. */
export function parseGitmodulesPaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)) {
    const p = m[1].replace(/^"(.*)"$/, '$1').replace(/\\/g, '/').replace(/\/+$/, '');
    if (p !== '' && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Absolute submodule directories under `root`, from its `.gitmodules` text. */
export function submoduleDirsOf(root: string, gitmodules: string): string[] {
  const base = root.replace(/[\\/]+$/, '');
  return parseGitmodulesPaths(gitmodules).map(p => `${base}/${p}`);
}

/** True when `path` lies inside one of `dirs` (absolute, without trailing separator). */
export function isUnderAny(path: string, dirs: readonly string[]): boolean {
  if (dirs.length === 0) return false;
  const p = path.replace(/\\/g, '/');
  return dirs.some(d => {
    const dir = d.replace(/\\/g, '/');
    return p.startsWith(`${dir}/`);
  });
}
