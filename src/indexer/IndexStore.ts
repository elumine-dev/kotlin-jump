import * as vscode from 'vscode';
import { SymbolIndex } from './SymbolIndex';
import { SymbolKind } from './KotlinParser';

const SNAPSHOT_VERSION = 2;
const SNAPSHOT_FILENAME = 'kotlin-nav-index.json';

// Compact per-file format — FQN is reconstructed as pkg+"."+name on restore
interface SnapshotFile {
  t: number;    // mtime (ms)
  p: string;    // packageName
  m?: string;   // moduleName
  // Parallel arrays — much smaller JSON than array-of-objects
  n: string[];  // names
  k: string[];  // kinds
  l: number[];  // lines
  c: number[];  // characters
  i: number[];  // isComposable (0/1)
  d: number[];  // depth (brace nesting level)
}

interface Snapshot {
  version: number;
  files: Record<string, SnapshotFile>; // uri string → file data
}

export interface StaleReport {
  toScan:   vscode.Uri[]; // new or mtime-changed files
  toRemove: string[];     // uris in snapshot no longer found on disk
  snapshot: Snapshot;
}

// ── Save ──────────────────────────────────────────────────────────────────────

export async function save(
  index: SymbolIndex,
  mtimes: Map<string, number>,
  context: vscode.ExtensionContext,
): Promise<void> {
  const snapshotUri = storageUri(context);
  if (!snapshotUri) return;

  const snap: Snapshot = { version: SNAPSHOT_VERSION, files: {} };

  for (const [uriStr, entries] of index.fileEntries()) {
    if (entries.length === 0) continue;
    const mtime = mtimes.get(uriStr);
    if (mtime === undefined) continue; // file no longer on disk

    const sf: SnapshotFile = {
      t: mtime,
      p: entries[0].packageName,
      m: entries[0].moduleName,
      n: [], k: [], l: [], c: [], i: [], d: [],
    };

    for (const e of entries) {
      sf.n.push(e.name);
      sf.k.push(e.kind);
      sf.l.push(e.line);
      sf.c.push(e.character);
      sf.i.push(e.isComposable ? 1 : 0);
      sf.d.push(e.depth);
    }

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
  // Build current mtime map with 50-concurrent stat() calls
  const currentMtimes = new Map<string, number>();
  const toScan: vscode.Uri[]  = [];
  const toRemove: string[]    = [];

  // Stat all files in parallel (capped at 50 concurrent)
  let cursor = 0;
  const statWorker = async () => {
    while (cursor < allUris.length) {
      const uri = allUris[cursor++];
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        currentMtimes.set(uri.toString(), stat.mtime);
      } catch { /* deleted between findFiles and stat — skip */ }
    }
  };
  await Promise.all(Array.from({ length: 50 }, statWorker));

  // Files on disk: new or mtime-changed → need re-scan
  for (const uri of allUris) {
    const key          = uri.toString();
    const currentMtime = currentMtimes.get(key);
    const snapMtime    = snapshot.files[key]?.t;
    if (currentMtime !== undefined && currentMtime !== snapMtime) {
      toScan.push(uri);
    }
  }

  // Files in snapshot not on disk → remove from index
  const onDisk = new Set(allUris.map(u => u.toString()));
  for (const uriStr of Object.keys(snapshot.files)) {
    if (!onDisk.has(uriStr)) toRemove.push(uriStr);
  }

  return { toScan, toRemove, snapshot };
}

// ── Restore (no I/O — just populate the index from snapshot data) ─────────────

export function restore(snapshot: Snapshot, index: SymbolIndex): void {
  for (const [uriStr, sf] of Object.entries(snapshot.files)) {
    const uri = vscode.Uri.parse(uriStr);
    const symbols = sf.n.map((name, i) => ({
      name,
      fqn:          sf.p ? `${sf.p}.${name}` : name,
      kind:         sf.k[i] as SymbolKind,
      uri,
      line:         sf.l[i],
      character:    sf.c[i],
      packageName:  sf.p,
      isComposable: sf.i[i] === 1,
      depth:        sf.d[i] ?? 0,
      moduleName:   sf.m,
    }));

    index.restoreFile(uriStr, symbols);
  }
  index.finalize();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function storageUri(context: vscode.ExtensionContext): vscode.Uri | null {
  if (!context.storageUri) return null;
  return vscode.Uri.joinPath(context.storageUri, SNAPSHOT_FILENAME);
}
