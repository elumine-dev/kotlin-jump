import * as vscode from 'vscode';
import { SymbolIndex } from './SymbolIndex';
import { SymbolKind, RawSymbol } from './KotlinParser';

// Compact per-file format. FQN is reconstructed as pkg+"."+name on restore.
// Shared by IndexStore's workspace snapshot and the bundled-stdlib prebuilt
// index (scripts/build-bundled-stdlib-index.js) so both use one restore path.
export interface SnapshotFile {
  t: number;    // mtime (ms)
  s?: number;   // file size (bytes); used alongside mtime to catch clock-skew false-negatives
  p: string;    // packageName
  m?: string;   // moduleName
  // Parallel arrays: much smaller JSON than array-of-objects
  n: string[];  // names
  k: string[];  // kinds
  l: number[];  // lines
  c: number[];  // characters
  i: number[];  // isComposable (0/1)
  d: number[];  // depth (brace nesting level)
  at?: Record<number, string>;   // alias targets: sparse map, index → rhs string (typealias only)
  st?: Record<number, string[]>; // supertypes: sparse map, index → supertype names
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
  im?: string[];           // raw imports; used to reconstruct word index on restore
  cv?: Record<number, string>; // constValue; raw literal for const val folding
}

export interface Snapshot {
  version: number;
  files: Record<string, SnapshotFile>; // uri string → file data
}

// Class-like kinds that form the FQN chain (must match SymbolIndex.CLASS_LIKE)
const RESTORE_CLASS_LIKE = new Set([
  'class', 'dataClass', 'sealedClass', 'enum', 'object', 'interface', 'annotation',
]);

/**
 * Serializes one file's parsed symbols into the compact snapshot form.
 * Inverse of restoreSnapshotFile(). Shared by IndexStore.save() (workspace
 * files, real mtime/size for staleness checks) and
 * scripts/build-bundled-stdlib-index.ts (a prebuilt asset with no staleness
 * concept: callers there pass mtime 0 and size undefined).
 */
export function buildSnapshotFile(
  symbols:     readonly RawSymbol[],
  packageName: string,
  moduleName:  string | undefined,
  mtime:       number,
  size:        number | undefined,
  imports:     readonly string[] | undefined,
): SnapshotFile {
  const sf: SnapshotFile = {
    t: mtime,
    s: size,
    p: packageName,
    m: moduleName,
    n: [], k: [], l: [], c: [], i: [], d: [],
  };

  symbols.forEach((e, idx) => {
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

  if (imports && imports.length > 0) sf.im = [...imports];

  return sf;
}

/**
 * Restores one file's entries from its compact snapshot form into `index`.
 * Does NOT call `index.finalize()`. Callers restoring a batch of files
 * (IndexStore.restore(), BundledStdlibProvider.load()) call it once after
 * their whole batch; finalize() is cheap to call more than once (it no-ops
 * without pending modifications) so multiple batches in one session compose
 * safely.
 */
export function restoreSnapshotFile(uriStr: string, sf: SnapshotFile, index: SymbolIndex): void {
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
