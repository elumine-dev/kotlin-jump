/**
 * Import lines naming a class member or an enum entry as `Container.name`.
 *
 * Java reaches both through a static import (`import static p.Cles.MORTE;`),
 * and removing the member left that line behind: javac stops on it. The
 * container is part of the match, not a nicety: an enum entry resolved as a
 * homonym goes while its name is still written for another enum, whose import
 * must stay. The companion of a Kotlin container is dropped, since Java
 * imports its constants through the class; a Kotlin import written through
 * `Companion` is the sweep's.
 */
export interface MemberImport {
  path: string;
  line: number;
  start: number;
  end: number;
  /** `Container.name`, as asked. */
  key: string;
  name: string;
}

export function memberKey(container: string, name: string): string {
  return `${container.split('.').filter(x => x !== 'Companion').pop() ?? ''}.${name}`;
}

const IMPORT_RE = /^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+)[ \t]*;?[ \t]*$/gm;

export function findMemberImports(
  sources: readonly { path: string; text: string }[],
  keys: ReadonlySet<string>,
): MemberImport[] {
  const out: MemberImport[] = [];
  if (keys.size === 0) return out;
  for (const src of sources) {
    if (!/\.(kt|java)$/.test(src.path) || !src.text.includes('import')) continue;
    for (const m of src.text.matchAll(IMPORT_RE)) {
      const segments = m[1].split('.');
      const key = segments.slice(-2).join('.');
      if (segments.length < 2 || !keys.has(key)) continue;
      const start = m.index!;
      const nl = src.text.indexOf('\n', start);
      let line = 0;
      for (let i = src.text.indexOf('\n'); i !== -1 && i < start; i = src.text.indexOf('\n', i + 1)) line++;
      out.push({ path: src.path, line, start, end: nl === -1 ? src.text.length : nl + 1, key, name: segments[segments.length - 1] });
    }
  }
  return out;
}
