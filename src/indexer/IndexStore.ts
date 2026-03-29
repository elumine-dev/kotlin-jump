import * as vscode from 'vscode';
import { SymbolIndex } from './SymbolIndex';
import { SymbolKind } from './KotlinParser';

const SNAPSHOT_VERSION = 5;
const SNAPSHOT_FILENAME = 'kotlin-jump-index.json';

// Compact per-file format — FQN is reconstructed as pkg+"."+name on restore
interface SnapshotFile {
  t: number;    // mtime (ms)
  s?: number;   // file size (bytes) — used alongside mtime to catch clock-skew false-negatives
  p: string;    // packageName
  m?: string;   // moduleName
  // Parallel arrays — much smaller JSON than array-of-objects
  n: string[];  // names
  k: string[];  // kinds
  l: number[];  // lines
  c: number[];  // characters
  i: number[];  // isComposable (0/1)
  d: number[];  // depth (brace nesting level)
  at?: Record<number, string>; // alias targets — sparse map: index → rhs string (typealias only)
  st?: Record<number, string[]>; // supertypes — sparse map: index → supertype names
}

interface Snapshot {
  version: number;
  files: Record<string, SnapshotFile>; // uri string → file data
}

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
    const stat = stats.get(uriStr);
    if (stat === undefined) continue; // file no longer on disk

    const sf: SnapshotFile = {
      t: stat.mtime,
      s: stat.size,
      p: entries[0].packageName,
      m: entries[0].moduleName,
      n: [], k: [], l: [], c: [], i: [], d: [],
    };

    entries.forEach((e, idx) => {
      sf.n.push(e.name);
      sf.k.push(e.kind);
      sf.l.push(e.line);
      sf.c.push(e.character);
      sf.i.push(e.isComposable ? 1 : 0);
      sf.d.push(e.depth);
      if (e.aliasTarget) { sf.at = sf.at ?? {}; sf.at[idx] = e.aliasTarget; }
      if (e.supertypes) { sf.st = sf.st ?? {}; sf.st[idx] = e.supertypes; }
    });

    snap.files[uriStr] = sf;
  }

  try {
    // storageUri directory may not exist on first run — create it
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(snapshotUri, '..'));
    const json = JSON.stringify(snap);
    await vscode.workspace.fs.writeFile(snapshotUri, Buffer.from(json, 'utf8'));
  } catch { /* non-fatal: next open will just do a full scan */ }
}

// ── Load ──────────────────────────────────────────────────────────────────────

export async function load(context: vscode.ExtensionContext): Promise<Snapshot | null> {
  const snapshotUri = storageUri(context);
  if (!snapshotUri) return null;

  try {
    const bytes = await vscode.workspace.fs.readFile(snapshotUri);
    const snap  = JSON.parse(Buffer.from(bytes).toString('utf8')) as Snapshot;
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

  // Stat all files in parallel (capped at 50 concurrent)
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
  await Promise.all(Array.from({ length: 50 }, statWorker));

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

// Class-like kinds that form the FQN chain (must match SymbolIndex.CLASS_LIKE)
const RESTORE_CLASS_LIKE = new Set([
  'class', 'dataClass', 'sealedClass', 'enum', 'object', 'interface', 'annotation',
]);

export function restore(snapshot: Snapshot, index: SymbolIndex): void {
  for (const [uriStr, sf] of Object.entries(snapshot.files)) {
    const uri = vscode.Uri.parse(uriStr);
    const classStack: { name: string; depth: number }[] = [];

    const symbols = sf.n.map((name, i) => {
      const depth = sf.d[i] ?? 0;
      const kind  = sf.k[i] as SymbolKind;

      // Mirror the classStack logic in SymbolIndex.add()
      while (classStack.length > 0 && classStack[classStack.length - 1].depth >= depth) {
        classStack.pop();
      }
      const qualifiers = classStack.map(s => s.name);
      const parts = sf.p ? [sf.p, ...qualifiers, name] : [...qualifiers, name];
      const fqn = parts.join('.');
      if (RESTORE_CLASS_LIKE.has(kind)) classStack.push({ name, depth });

      return {
        name,
        fqn,
        kind,
        uri,
        line:         sf.l[i],
        character:    sf.c[i],
        packageName:  sf.p,
        isComposable: sf.i[i] === 1,
        depth,
        moduleName:   sf.m,
        aliasTarget:  sf.at?.[i],
        supertypes:   sf.st?.[i],
      };
    });

    index.restoreFile(uriStr, symbols);
  }
  index.finalize();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function storageUri(context: vscode.ExtensionContext): vscode.Uri | null {
  if (!context.storageUri) return null;
  return vscode.Uri.joinPath(context.storageUri, SNAPSHOT_FILENAME);
}
