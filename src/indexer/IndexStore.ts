import * as vscode from 'vscode';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { SymbolIndex } from './SymbolIndex';
import { SymbolKind } from './KotlinParser';
import { decodeUtf8 } from '../util/encoding';

const SNAPSHOT_VERSION = 19; // bumped: gzip-compressed payload (was raw JSON in v18)
const SNAPSHOT_FILENAME = 'kotlin-jump-index.json'; // historical name; content is gzip from v19+

const gzip   = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

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
  at?: Record<number, string>;   // alias targets — sparse map: index → rhs string (typealias only)
  st?: Record<number, string[]>; // supertypes — sparse map: index → supertype names
  // Sparse boolean flags (only entries where true are stored)
  su?: Record<number, 1>;  // isSuspend
  ab?: Record<number, 1>;  // isAbstract
  co?: Record<number, 1>;  // isConst
  ex?: Record<number, 1>;  // isExtension
  il?: Record<number, 1>;  // isInline
  ix?: Record<number, 1>;  // isInfix
  li?: Record<number, 1>;  // isLateinit
  hv?: Record<number, 1>;  // isHiltViewModel
  io?: Record<number, 1>;  // isOperator
  or?: Record<number, 1>;  // isOverride
  pr?: Record<number, 1>;  // isPreview
  pv?: Record<number, 1>;  // isPrivate
  de?: Record<number, 1>;  // isDeprecated
  te?: Record<number, 1>;  // isTest
  tc?: Record<number, 1>;  // isTestClass
  ig?: Record<number, 1>;  // isIgnored
  lc?: Record<number, 1>;  // isLifecycle
  im?: string[];           // raw imports — used to reconstruct word index on restore
  cv?: Record<number, string>; // constValue — raw literal for const val folding
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
    if (uriStr.startsWith('kotlin-jar:')) continue;  // JAR symbols are re-indexed on every startup
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
      if (e.aliasTarget)      { sf.at = sf.at ?? {}; sf.at[idx] = e.aliasTarget; }
      if (e.supertypes)       { sf.st = sf.st ?? {}; sf.st[idx] = e.supertypes; }
      if (e.isSuspend)        { sf.su = sf.su ?? {}; sf.su[idx] = 1; }
      if (e.isAbstract)       { sf.ab = sf.ab ?? {}; sf.ab[idx] = 1; }
      if (e.isConst)          { sf.co = sf.co ?? {}; sf.co[idx] = 1; }
      if (e.isExtension)      { sf.ex = sf.ex ?? {}; sf.ex[idx] = 1; }
      if (e.isInline)         { sf.il = sf.il ?? {}; sf.il[idx] = 1; }
      if (e.isInfix)          { sf.ix = sf.ix ?? {}; sf.ix[idx] = 1; }
      if (e.isLateinit)       { sf.li = sf.li ?? {}; sf.li[idx] = 1; }
      if (e.isHiltViewModel)  { sf.hv = sf.hv ?? {}; sf.hv[idx] = 1; }
      if (e.isOperator)       { sf.io = sf.io ?? {}; sf.io[idx] = 1; }
      if (e.isOverride)       { sf.or = sf.or ?? {}; sf.or[idx] = 1; }
      if (e.isPreview)        { sf.pr = sf.pr ?? {}; sf.pr[idx] = 1; }
      if (e.isPrivate)        { sf.pv = sf.pv ?? {}; sf.pv[idx] = 1; }
      if (e.isDeprecated)     { sf.de = sf.de ?? {}; sf.de[idx] = 1; }
      if (e.isTest)           { sf.te = sf.te ?? {}; sf.te[idx] = 1; }
      if (e.isTestClass)      { sf.tc = sf.tc ?? {}; sf.tc[idx] = 1; }
      if (e.isIgnored)        { sf.ig = sf.ig ?? {}; sf.ig[idx] = 1; }
      if (e.isLifecycle)      { sf.lc = sf.lc ?? {}; sf.lc[idx] = 1; }
      if (e.constValue)       { sf.cv = sf.cv ?? {}; sf.cv[idx] = e.constValue; }
    });

    const imports = index.getFileImports(uriStr);
    if (imports && imports.length > 0) sf.im = imports;

    snap.files[uriStr] = sf;
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
        line:            sf.l[i],
        character:       sf.c[i],
        packageName:     sf.p,
        isComposable:    sf.i[i] === 1,
        depth,
        moduleName:      sf.m,
        aliasTarget:     sf.at?.[i],
        supertypes:      sf.st?.[i],
        isSuspend:       sf.su?.[i] === 1 || undefined,
        isAbstract:      sf.ab?.[i] === 1 || undefined,
        isConst:         sf.co?.[i] === 1 || undefined,
        isExtension:     sf.ex?.[i] === 1 || undefined,
        isInline:        sf.il?.[i] === 1 || undefined,
        isInfix:         sf.ix?.[i] === 1 || undefined,
        isLateinit:      sf.li?.[i] === 1 || undefined,
        isHiltViewModel: sf.hv?.[i] === 1 || undefined,
        isOperator:      sf.io?.[i] === 1 || undefined,
        isOverride:      sf.or?.[i] === 1 || undefined,
        isPreview:       sf.pr?.[i] === 1 || undefined,
        isPrivate:       sf.pv?.[i] === 1 || undefined,
        isDeprecated:    sf.de?.[i] === 1 || undefined,
        isTest:          sf.te?.[i] === 1 || undefined,
        isTestClass:     sf.tc?.[i] === 1 || undefined,
        isIgnored:       sf.ig?.[i] === 1 || undefined,
        isLifecycle:     sf.lc?.[i] === 1 || undefined,
        constValue:      sf.cv?.[i],
      };
    });

    index.restoreFile(uriStr, symbols, sf.im ?? []);
  }
  index.finalize();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function storageUri(context: vscode.ExtensionContext): vscode.Uri | null {
  if (!context.storageUri) return null;
  return vscode.Uri.joinPath(context.storageUri, SNAPSHOT_FILENAME);
}
