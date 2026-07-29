// No vscode import: this module is pure so the detector can be unit tested.

/**
 * File-based Android resources: layout, menu, anim, animator, raw, drawable,
 * mipmap. One resource NAME maps to N files (density and configuration
 * variants), which is why the key/variants shape matters — deleting a dead
 * drawable means deleting every one of its variants.
 *
 * Deliberately separate from DrawableResourceIndex rather than widening it:
 * that index feeds the gutter thumbnails, hovers and preview panel, and
 * pouring layouts into it would surface them in all three.
 */

export type FileResKind =
  | 'layout' | 'menu' | 'anim' | 'animator' | 'raw' | 'drawable' | 'mipmap'
  | 'xml' | 'navigation' | 'font' | 'transition' | 'color';

export interface FileResVariant {
  /** Absolute path. */
  path: string;
  /** Folder the file lives in, qualifiers included: `layout-land`, `drawable-hdpi`. */
  qualifier: string;
  /** Module directory the resource belongs to, or '' when unknown. */
  moduleDir: string;
}

export interface FileResEntry {
  kind: FileResKind;
  name: string;
  variants: FileResVariant[];
}

const EXTS = 'xml|png|webp|svg|jpg|jpeg|gif|bmp|json|txt|mp3|mp4|ogg|wav|ttf|otf|lottie';
const PATH_RE = new RegExp(
  `[\\\\/]res[\\\\/](layout|menu|anim|animator|raw|drawable|mipmap|xml|navigation|font|transition|color)([^\\\\/]*)[\\\\/]([^\\\\/]+?)(\\.9)?\\.(${EXTS})$`,
  'i',
);

/** Parses a resource file path. Returns undefined for anything else. */
export function parseResourcePath(path: string): { kind: FileResKind; name: string; qualifier: string } | undefined {
  const m = PATH_RE.exec(path);
  if (!m) return undefined;
  return {
    kind: m[1].toLowerCase() as FileResKind,
    name: m[3],
    qualifier: `${m[1]}${m[2]}`,
  };
}

/** Nearest ancestor directory holding a Gradle build script, or ''. */
export function moduleDirOf(path: string, moduleDirs: readonly string[]): string {
  let best = '';
  for (const dir of moduleDirs) {
    if (path.startsWith(`${dir}/`) && dir.length > best.length) best = dir;
  }
  return best;
}

export class FileResourceIndex {
  private readonly byKey = new Map<string, FileResEntry>();
  private readonly byPath = new Map<string, string>();

  static key(kind: FileResKind, name: string): string {
    return `${kind}/${name}`;
  }

  addFile(path: string, moduleDirs: readonly string[] = []): void {
    const parsed = parseResourcePath(path);
    if (!parsed) return;
    const key = FileResourceIndex.key(parsed.kind, parsed.name);
    const variant: FileResVariant = {
      path,
      qualifier: parsed.qualifier,
      moduleDir: moduleDirOf(path, moduleDirs),
    };
    const existing = this.byKey.get(key);
    if (existing) {
      if (!existing.variants.some(v => v.path === path)) existing.variants.push(variant);
    } else {
      this.byKey.set(key, { kind: parsed.kind, name: parsed.name, variants: [variant] });
    }
    this.byPath.set(path, key);
  }

  removeFile(path: string): void {
    const key = this.byPath.get(path);
    if (!key) return;
    this.byPath.delete(path);
    const entry = this.byKey.get(key);
    if (!entry) return;
    entry.variants = entry.variants.filter(v => v.path !== path);
    if (entry.variants.length === 0) this.byKey.delete(key);
  }

  get(kind: FileResKind, name: string): FileResEntry | undefined {
    return this.byKey.get(FileResourceIndex.key(kind, name));
  }

  entries(): FileResEntry[] {
    return [...this.byKey.values()];
  }

  entryForPath(path: string): FileResEntry | undefined {
    const key = this.byPath.get(path);
    return key ? this.byKey.get(key) : undefined;
  }

  clear(): void {
    this.byKey.clear();
    this.byPath.clear();
  }

  get size(): number {
    return this.byKey.size;
  }
}
