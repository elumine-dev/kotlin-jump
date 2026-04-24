import * as vscode from 'vscode';

interface UriLike { toString(): string; path: string; }

export interface DrawableVariant {
  uri:         UriLike;
  qualifier:   string; // e.g. "drawable", "drawable-hdpi", "drawable-night-v24"
  ext:         string; // canonical extension: xml | png | webp | svg | jpg | jpeg | gif | bmp
  isNinePatch: boolean; // true for ".9.png" — same bytes as PNG but Android-patch metadata
}

export interface DrawableEntry {
  key:      string;
  variants: DrawableVariant[]; // sorted: default density first
}

// Android accepts: png (+ .9.png), jpg, gif, webp, bmp, and xml (all drawable
// XML types — vector, shape, selector, layer-list, ripple, …). svg is not
// native to Android but devs sometimes ship them anyway for custom loaders.
const EXTS = 'xml|png|webp|svg|jpg|jpeg|gif|bmp';
// Capture group 3 includes the key AND an optional `.9` suffix so 9-patch
// images (`btn.9.png`) register under key `btn` instead of `btn.9`.
const PATH_RE = new RegExp(
  `/res/(drawable|mipmap)([^/]*)/([^/]+?)(\\.9)?\\.(${EXTS})$`,
  'i',
);

/**
 * Registry of Android drawable/mipmap resources, keyed by name. One key can
 * have multiple variants across qualifier folders (density buckets,
 * `-night`, `-v24`, `-land`, …) — all are tracked so hover can list them
 * and thumbnail can pick the best rendering source.
 *
 * Unlike `ColorResourceIndex` and friends, the "content" of a drawable IS
 * the whole file, so we index paths rather than parsed XML entries.
 */
export class DrawableResourceIndex {
  private readonly byKey  = new Map<string, DrawableVariant[]>();
  private readonly byPath = new Map<string, string>();

  /**
   * Fires whenever the index mutates — addFile, removeFile, or a
   * re-add via the same path. Providers that render from this index
   * (hover, gutter, folding, diagnostics…) should subscribe so they
   * repaint whenever late arrivals from the initial async `findFiles`
   * (or the file watcher) land. Making the signal live on the index
   * — not on extension.ts orchestration — eliminates the whole class
   * of "provider constructed before index populated, never refreshes"
   * bugs. See doc/architecture/resource-indexers.md for the pattern.
   */
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  addFile(uri: UriLike): void {
    const m = PATH_RE.exec(uri.path);
    if (!m) return;
    const qualifier   = m[1] + m[2];
    const key         = m[3];
    const isNinePatch = Boolean(m[4]);
    const ext         = m[5].toLowerCase();

    // Idempotent re-add (e.g. onDidChange): drop the old record first.
    if (this.byPath.has(uri.toString())) this.removeFile(uri);

    this.byPath.set(uri.toString(), key);
    const variants = this.byKey.get(key) ?? [];
    variants.push({ uri, qualifier, ext, isNinePatch });
    this.byKey.set(key, variants);
    this._onDidChange.fire();
  }

  removeFile(uri: UriLike): void {
    const key = this.byPath.get(uri.toString());
    if (!key) return;
    this.byPath.delete(uri.toString());
    const variants = this.byKey.get(key);
    if (!variants) return;
    const remaining = variants.filter(v => v.uri.toString() !== uri.toString());
    if (remaining.length === 0) this.byKey.delete(key);
    else this.byKey.set(key, remaining);
    this._onDidChange.fire();
  }

  get(key: string): DrawableEntry | undefined {
    const variants = this.byKey.get(key);
    if (!variants || variants.length === 0) return undefined;
    const sorted = [...variants].sort((a, b) => {
      const aDefault = (a.qualifier === 'drawable' || a.qualifier === 'mipmap') ? 0 : 1;
      const bDefault = (b.qualifier === 'drawable' || b.qualifier === 'mipmap') ? 0 : 1;
      return aDefault - bDefault || a.qualifier.localeCompare(b.qualifier);
    });
    return { key, variants: sorted };
  }

  has(key: string): boolean { return this.byKey.has(key); }

  size(): number { return this.byKey.size; }

  dispose(): void { this._onDidChange.dispose(); }
}
