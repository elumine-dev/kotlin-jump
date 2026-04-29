import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { DrawableResourceIndex, DrawableVariant } from '../indexer/DrawableResourceIndex';
import { vectorXmlToSvg } from '../util/vectorToSvg';

const R_DRAWABLE_RE = /\bR\.(drawable|mipmap)\.([A-Za-z_]\w*)\b/g;

// Hard cap on file size we're willing to copy into the cache folder.
// Larger rasters get skipped (rare — launcher backgrounds etc.) — the
// hover still gives the user a path, we just don't paint a gutter icon
// for them.
const MAX_CACHE_BYTES = 512 * 1024;

/**
 * Draws a miniature of every `R.drawable.xxx` / `R.mipmap.xxx` reference
 * in the gutter. Matches the Android Studio UX devs already know.
 *
 * VS Code's `gutterIconPath` requires an on-disk file; data URIs are
 * not accepted. We therefore mirror each drawable into a per-extension
 * cache folder (`globalStorage/drawable-thumbs/`) on first use. For
 * vector drawables (Android XML) we run a best-effort XML→SVG
 * conversion so the icon scales instead of rendering as "[XML]".
 */
export class DrawableGutterThumbnailProvider implements vscode.Disposable {
  private readonly cacheDir: string;
  // One decoration type per cached thumbnail path — VS Code requires the
  // gutter icon to be baked into the decoration type itself. Reusing the
  // same type across lines is cheap; creating a type per line is not.
  private readonly typeByCachePath = new Map<string, vscode.TextEditorDecorationType>();
  // Reverse map: source file URI → cache path. Used by `invalidatePath`
  // to find the exact cache entry for a given drawable without falling
  // back to substring matching on a truncated hash (which could false-
  // match unrelated files under pathological paths).
  private readonly cachePathBySource = new Map<string, string>();
  // Cache paths we've already verified this session — a stat'ed "this is
  // fresh" result stays valid until the file watcher invalidates it.
  // Skips the double `statSync` on every subsequent flush, which dominates
  // per-flush cost on files with hundreds of R.drawable references.
  private readonly verifiedCachePaths = new Set<string>();
  // Drawable XMLs currently open with unsaved edits, indexed by URI string
  // for O(1) lookup on the hot path. Maintained via change/save/close
  // listeners — `vscode.workspace.textDocuments` would be O(N) per render.
  private readonly dirtyXmlUris = new Set<string>();
  private readonly subs: vscode.Disposable[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly index: DrawableResourceIndex,
    storageUri: vscode.Uri,
  ) {
    this.cacheDir = path.join(storageUri.fsPath, 'drawable-thumbs');
    fs.mkdirSync(this.cacheDir, { recursive: true });

    this.subs.push(
      // React to late arrivals in the index — initial `findFiles` resolves
      // AFTER the provider is constructed, and the constructor's eager
      // flush runs against an empty index. Without this subscription the
      // user would see no thumbnails until they manually edited the file
      // (which triggers `onDidChangeTextDocument`). See the architecture
      // note in DrawableResourceIndex.ts for the systemic rationale.
      this.index.onDidChange(() => this.scheduleFlush()),
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleFlush()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.scheduleFlush()),
      vscode.workspace.onDidChangeTextDocument(e => {
        // Only schedule if the changed document is open in a visible
        // editor — changes to background files don't require a repaint.
        if (vscode.window.visibleTextEditors.some(ed => ed.document === e.document)) {
          this.scheduleFlush();
        }
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.drawableThumbnails')) this.refreshAllEditors();
      }),
      // Track dirty drawable XMLs so the hot path can do an O(1) Set check
      // instead of scanning `vscode.workspace.textDocuments` per reference.
      vscode.workspace.onDidChangeTextDocument(e => {
        if (!isDrawableXmlPath(e.document.uri.path)) return;
        const key = e.document.uri.toString();
        if (e.document.isDirty) this.dirtyXmlUris.add(key);
        else this.dirtyXmlUris.delete(key);
      }),
      vscode.workspace.onDidSaveTextDocument(d => {
        this.dirtyXmlUris.delete(d.uri.toString());
      }),
      vscode.workspace.onDidCloseTextDocument(d => {
        this.dirtyXmlUris.delete(d.uri.toString());
      }),
    );

    this.refreshAllEditors();
  }

  refreshAllEditors(): void {
    // An explicit refresh is our safety net: clear the "verified this
    // session" set so the next flush re-stats every cache entry. This
    // recovers from the rare case where the file watcher missed a change
    // on disk — the user's config-change, index event, or manual reload
    // all go through here. Typing-triggered flushes bypass this and keep
    // the fast path.
    this.verifiedCachePaths.clear();
    this.scheduleFlush();
  }

  /** Invalidate a cache entry when the underlying drawable file changed. */
  invalidatePath(uri: vscode.Uri): void {
    const sourceKey = uri.path;
    // Even when we never cached this file (e.g. user saved a drawable that
    // no Kotlin file references), wipe the dirty marker so a later flush
    // doesn't keep rendering from the now-saved buffer's old version.
    this.dirtyXmlUris.delete(uri.toString());
    const cachePath = this.cachePathBySource.get(sourceKey);
    if (!cachePath) { this.refreshAllEditors(); return; }
    try { fs.unlinkSync(cachePath); } catch { /* already gone */ }
    this.typeByCachePath.get(cachePath)?.dispose();
    this.typeByCachePath.delete(cachePath);
    this.cachePathBySource.delete(sourceKey);
    this.verifiedCachePaths.delete(cachePath);
    this.refreshAllEditors();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      // Read live at fire time — the editor that was current when the
      // flush was *scheduled* may have lost focus or closed in the 32 ms
      // debounce window. Painting to the old editor would look like a
      // lingering icon on a file the user is no longer watching.
      for (const editor of vscode.window.visibleTextEditors) {
        void this.flush(editor);
      }
    }, 32);
  }

  private async flush(editor: vscode.TextEditor): Promise<void> {
    const doc = editor.document;
    const enabled = vscode.workspace.getConfiguration('kotlinJump')
      .get<boolean>('drawableThumbnails', true);
    const langOk = doc.languageId === 'kotlin' || doc.languageId === 'java';

    // Whether enabled or not: we always reset the decorations we painted
    // before, otherwise stale icons linger after the setting flips off
    // or after the editor switches to a non-Kotlin file.
    const decorsByType = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>();
    for (const t of this.typeByCachePath.values()) decorsByType.set(t, []);

    if (enabled && langOk) {
      for (let line = 0; line < doc.lineCount; line++) {
        const text = doc.lineAt(line).text;
        // `matchAll` is safe across `await` boundaries — it returns an
        // iterator over independent match objects rather than mutating
        // a shared `lastIndex` on the regex. Critical here because
        // `ensureCached` yields to the event loop and another flush
        // (different editor) can run concurrently.
        for (const m of text.matchAll(R_DRAWABLE_RE)) {
          const key   = m[2];
          const entry = this.index.get(key);
          if (!entry) continue;
          const variant = pickThumbnailVariant(entry.variants);
          if (!variant) continue;

          const cachePath = await this.ensureCached(variant);
          if (!cachePath) continue;
          const type = this.getOrCreateDecorationType(cachePath);

          const startCol = m.index ?? 0;
          const range = new vscode.Range(line, startCol, line, startCol + m[0].length);
          const list  = decorsByType.get(type) ?? [];
          list.push({ range });
          decorsByType.set(type, list);
        }
      }
    }

    // If invalidatePath ran in the middle of this async flush, a decoration
    // type we queued may already have been disposed. Cross-check against
    // the live map before calling setDecorations — a disposed type throws.
    const liveTypes = new Set(this.typeByCachePath.values());
    for (const [type, decors] of decorsByType) {
      if (liveTypes.has(type)) editor.setDecorations(type, decors);
    }
  }

  private getOrCreateDecorationType(cachePath: string): vscode.TextEditorDecorationType {
    const existing = this.typeByCachePath.get(cachePath);
    if (existing) return existing;
    const created = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.file(cachePath),
      gutterIconSize: 'contain',
    });
    this.typeByCachePath.set(cachePath, created);
    return created;
  }

  private async ensureCached(variant: DrawableVariant): Promise<string | undefined> {
    const cacheExt   = variant.ext === 'xml' ? 'svg' : variant.ext;
    const sourceKey  = variant.uri.path;
    const sourcePath = (variant.uri as vscode.Uri).fsPath;

    // Hot path #1: previously-resolved cache that's still verified. Trust
    // the file watcher + save listener to clear this entry when the source
    // changes. Zero fs ops, identical cost to the historical implementation.
    if (!this.dirtyXmlUris.has((variant.uri as vscode.Uri).toString())) {
      const cached = this.cachePathBySource.get(sourceKey);
      if (cached && this.verifiedCachePaths.has(cached)) return cached;
    }

    // Live preview: the source has unsaved edits in an open editor. Render
    // from the in-memory text and version the cache filename with `doc.version`,
    // so VS Code sees a NEW URI for each edit. (VS Code's gutter icon image
    // cache is keyed by URI; reusing the same URI with different bytes leaves
    // the previous icon on screen — root cause of "even after save sometimes
    // it doesn't update".)
    if (variant.ext === 'xml' && this.dirtyXmlUris.has((variant.uri as vscode.Uri).toString())) {
      const dirtyDoc = vscode.workspace.textDocuments.find(
        d => d.isDirty && d.uri.toString() === (variant.uri as vscode.Uri).toString(),
      );
      if (dirtyDoc) {
        const cacheName = `${sanitizeForCache(sourceKey)}-doc${dirtyDoc.version}.${cacheExt}`;
        const cachePath = path.join(this.cacheDir, cacheName);

        if (this.verifiedCachePaths.has(cachePath)) {
          this.cachePathBySource.set(sourceKey, cachePath);
          return cachePath;
        }
        if (fs.existsSync(cachePath)) {
          this.cachePathBySource.set(sourceKey, cachePath);
          this.verifiedCachePaths.add(cachePath);
          return cachePath;
        }
        this.retirePrevious(sourceKey, cachePath);

        const svg = vectorXmlToSvg(dirtyDoc.getText());
        if (!svg) return undefined;
        writeAtomic(cachePath, Buffer.from(svg));
        this.cachePathBySource.set(sourceKey, cachePath);
        this.verifiedCachePaths.add(cachePath);
        return cachePath;
      }
      // Marked dirty but no document found — fall through to disk path.
    }

    // Saved-file path: encode the source mtime in the cache filename so each
    // version of the source maps to a distinct on-disk path (and therefore a
    // distinct gutter icon URI for VS Code).
    let srcMtime = 0;
    try {
      srcMtime = Math.floor(fs.statSync(sourcePath).mtimeMs);
    } catch {
      // Source unavailable (virtual FS / tests). mtime=0 collapses all
      // versions to the same filename — acceptable when there's no real disk.
    }
    const cacheName = `${sanitizeForCache(sourceKey)}-${srcMtime}.${cacheExt}`;
    const cachePath = path.join(this.cacheDir, cacheName);

    if (this.verifiedCachePaths.has(cachePath)) {
      this.cachePathBySource.set(sourceKey, cachePath);
      return cachePath;
    }

    // Existence is sufficient freshness here: mtime is encoded in the
    // filename, so the file's existence implies the contents match.
    if (fs.existsSync(cachePath)) {
      this.cachePathBySource.set(sourceKey, cachePath);
      this.verifiedCachePaths.add(cachePath);
      return cachePath;
    }

    this.retirePrevious(sourceKey, cachePath);

    try {
      const bytes = await vscode.workspace.fs.readFile(variant.uri as vscode.Uri);

      if (variant.ext === 'xml') {
        const xml = new TextDecoder().decode(bytes);
        const svg = vectorXmlToSvg(xml);
        if (!svg) return undefined;
        writeAtomic(cachePath, Buffer.from(svg));
        this.cachePathBySource.set(sourceKey, cachePath);
        this.verifiedCachePaths.add(cachePath);
        return cachePath;
      }

      if (bytes.byteLength > MAX_CACHE_BYTES) return undefined;
      writeAtomic(cachePath, Buffer.from(bytes));
      this.cachePathBySource.set(sourceKey, cachePath);
      this.verifiedCachePaths.add(cachePath);
      return cachePath;
    } catch {
      return undefined;
    }
  }

  /**
   * When the cache version changes (mtime bump after save, or doc.version
   * bump during a live edit), retire the prior cache file + decoration type
   * so the directory doesn't grow unbounded across saves.
   */
  private retirePrevious(sourceKey: string, newCachePath: string): void {
    const previous = this.cachePathBySource.get(sourceKey);
    if (!previous || previous === newCachePath) return;
    try { fs.unlinkSync(previous); } catch { /* already gone */ }
    this.typeByCachePath.get(previous)?.dispose();
    this.typeByCachePath.delete(previous);
    this.verifiedCachePaths.delete(previous);
  }

  dispose(): void {
    clearTimeout(this.flushTimer);
    for (const t of this.typeByCachePath.values()) t.dispose();
    this.typeByCachePath.clear();
    this.cachePathBySource.clear();
    this.verifiedCachePaths.clear();
    this.dirtyXmlUris.clear();
    for (const s of this.subs) s.dispose();
  }
}

/** Returns true for paths that look like an Android drawable/mipmap XML. */
function isDrawableXmlPath(p: string): boolean {
  return /\/res\/(drawable|mipmap)[^/]*\/[^/]+\.xml$/i.test(p);
}

/** Prefer vectors, then SVGs, then default-density rasters — quality over coverage. */
function pickThumbnailVariant(variants: readonly DrawableVariant[]): DrawableVariant | undefined {
  return (
    variants.find(v => v.ext === 'xml') ??
    variants.find(v => v.ext === 'svg') ??
    variants.find(v => v.qualifier === 'drawable' || v.qualifier === 'mipmap') ??
    variants[0]
  );
}

function sanitizeForCache(urlPath: string): string {
  // Short, stable, collision-free filename derived from the source path.
  // Extension is appended by the caller because xml inputs are cached as svg.
  return crypto.createHash('sha1').update(urlPath).digest('hex').slice(0, 16);
}

/**
 * Atomic on-disk write. Two VS Code windows (dev host + installed
 * extension, or two workspaces) can share the same globalStorage cache
 * folder; a racing `fs.writeFileSync` on the same path would let a
 * reader see a partial file. Writing to a unique temp name and
 * renaming on top is POSIX-atomic on the same filesystem — no reader
 * can observe a partial icon.
 */
function writeAtomic(finalPath: string, bytes: Buffer): void {
  const tmp = `${finalPath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmp, bytes);
  try {
    fs.renameSync(tmp, finalPath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
    throw e;
  }
}
