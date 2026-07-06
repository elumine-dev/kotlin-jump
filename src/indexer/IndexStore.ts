import * as vscode from 'vscode';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { SymbolIndex } from './SymbolIndex';
import { decodeUtf8 } from '../util/encoding';
import { buildSnapshotFile, restoreSnapshotFile, type Snapshot, type SnapshotFile } from './SnapshotFormat';
export type { Snapshot, SnapshotFile };

export const SNAPSHOT_VERSION = 20; // bumped: enum-entry parsing fix (v19 snapshots may hold phantom entries like `H` for `Home`)
const SNAPSHOT_FILENAME = 'kotlin-jump-index.json'; // historical name; content is gzip from v19+

const gzip   = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface StaleReport {
  toScan:   vscode.Uri[]; // new or changed files (mtime or size differs)
  toRemove: string[];     // uris in snapshot no longer found on disk
  snapshot: Snapshot;
  stats:    Map<string, { mtime: number; size: number }>; // current on-disk stats (reuse for save)
}

// ── Save ──────────────────────────────────────────────────────────────────────

export async function save(
  index: SymbolIndex,
  stats: Map<string, { mtime: number; size: number }>,
  context: vscode.ExtensionContext,
): Promise<void> {
  const snapshotUri = storageUri(context);
  if (!snapshotUri) return;

  const snap: Snapshot = { version: SNAPSHOT_VERSION, files: {} };

  for (const [uriStr, entries] of index.fileEntries()) {
    if (entries.length === 0) continue;
    if (uriStr.startsWith('kotlin-jar:')) continue;  // JAR symbols are re-indexed on every startup
    const stat = stats.get(uriStr);
    if (stat === undefined) continue; // file no longer on disk

    const imports = index.getFileImports(uriStr);
    snap.files[uriStr] = buildSnapshotFile(
      entries, entries[0].packageName, entries[0].moduleName, stat.mtime, stat.size, imports,
    );
  }

  try {
    // storageUri directory may not exist on first run — create it
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(snapshotUri, '..'));
    const json = JSON.stringify(snap);
    // Gzip cuts the on-disk size by ~80 % on real workspaces (the JSON
    // is highly repetitive: package names, kinds, sparse boolean maps).
    // The compress cost is amortised across many startups.
    // String input (treated as UTF-8 by both Node zlib and the browser
    // zlib-stub) — no Buffer, which doesn't exist in the web host.
    const compressed = await gzip(json);
    await vscode.workspace.fs.writeFile(snapshotUri, compressed);
  } catch { /* non-fatal: next open will just do a full scan */ }
}

// ── Load ──────────────────────────────────────────────────────────────────────

export async function load(context: vscode.ExtensionContext): Promise<Snapshot | null> {
  const snapshotUri = storageUri(context);
  if (!snapshotUri) return null;

  try {
    const bytes = await vscode.workspace.fs.readFile(snapshotUri);
    // Detect gzip magic (0x1f 0x8b). v19+ writes gzip; pre-v19 wrote raw
    // JSON (those load and then version-check fails — invalidated).
    let jsonBytes: Uint8Array;
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      jsonBytes = await gunzip(bytes);
    } else {
      jsonBytes = bytes;
    }
    const snap = JSON.parse(decodeUtf8(jsonBytes)) as Snapshot;
    if (snap.version !== SNAPSHOT_VERSION) return null;
    return snap;
  } catch {
    return null; // missing, corrupt, or version mismatch
  }
}

// ── Staleness check ───────────────────────────────────────────────────────────

export async function checkStaleness(
  snapshot: Snapshot,
  allUris: vscode.Uri[],
): Promise<StaleReport> {
  const stats    = new Map<string, { mtime: number; size: number }>();
  const toScan: vscode.Uri[] = [];
  const toRemove: string[]   = [];

  // Stat all files in parallel. The work is I/O-bound (POSIX `stat()`
  // through VS Code's vscode.workspace.fs) — modern macOS/APFS handles
  // ~10K stat/s with hundreds of concurrent callers without contention,
  // so we open the throttle wide. The per-call overhead is JS-side only;
  // the OS already serialises at the syscall layer when needed. Bumped
  // 50 → 256: profiled cold start on a 5K-file workspace, ~3 s → ~600 ms.
  // Capped at allUris.length so tiny projects don't allocate idle workers.
  const concurrency = Math.min(256, allUris.length);
  let cursor = 0;
  const statWorker = async () => {
    while (cursor < allUris.length) {
      const uri = allUris[cursor++];
      try {
        const s = await vscode.workspace.fs.stat(uri);
        stats.set(uri.toString(), { mtime: s.mtime, size: s.size });
      } catch { /* deleted between findFiles and stat — skip */ }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, statWorker));

  // Files on disk: stale if mtime changed OR size changed (catches clock-skew edge cases)
  for (const uri of allUris) {
    const key     = uri.toString();
    const current = stats.get(key);
    const snap    = snapshot.files[key];
    if (!current) continue; // stat failed — skip
    const mtimeChanged = current.mtime !== snap?.t;
    const sizeChanged  = snap?.s !== undefined && current.size !== snap.s;
    if (mtimeChanged || sizeChanged) toScan.push(uri);
  }

  // Files in snapshot not on disk → remove from index
  const onDisk = new Set(allUris.map(u => u.toString()));
  for (const uriStr of Object.keys(snapshot.files)) {
    if (!onDisk.has(uriStr)) toRemove.push(uriStr);
  }

  return { toScan, toRemove, snapshot, stats };
}

// ── Restore (no I/O — just populate the index from snapshot data) ─────────────
// Per-file restore logic lives in ./SnapshotFormat, shared with the
// bundled-stdlib prebuilt index (BundledStdlibProvider) so both restore
// paths stay identical.

export function restore(snapshot: Snapshot, index: SymbolIndex): void {
  for (const [uriStr, sf] of Object.entries(snapshot.files)) {
    restoreSnapshotFile(uriStr, sf, index);
  }
  index.finalize();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function storageUri(context: vscode.ExtensionContext): vscode.Uri | null {
  if (!context.storageUri) return null;
  return vscode.Uri.joinPath(context.storageUri, SNAPSHOT_FILENAME);
}
