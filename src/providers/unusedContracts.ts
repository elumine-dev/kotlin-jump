import { parse, RawSymbol } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import {
  buildLineStarts, collectAnnotationTargets, findMatchingParen, sanitizeForUsageScan,
} from '../util/kotlinScan';
import { declarationSpan } from '../util/declarationSpan';
import { stripKotlinComments } from '../util/xmlRefs';
import { isBuildArtifactPath, isGeneratedSource } from '../util/resourceAllowlists';
import { isTestSourceSet } from '../util/testPaths';
import {
  accessorNames, BENIGN_TOPLEVEL_ANNOTATIONS, harvestMentions, removalExtent, benignWorkspaceAnnotationsOf, SymbolSource,
} from './unusedSymbols';
import { nestedFqn, resoudreType, TypeDecl } from './unusedMembers';
import { AndroidApi } from '../util/androidApi';
import { signatureOnlySpan } from './deadIslands';

/**
 * G44: an interface method nothing calls, cut together with every override.
 *
 * Neither half is visible to the member detector. An interface method has no
 * body, so no extent, so it is never a candidate (F16). Its overrides are
 * held by M2, M3 and M11: an override may be called through its contract, and
 * removing it alone leaves a class that no longer compiles. On LaPresse the
 * cleanup commit 9b514d8dc2 removed dozens of such pairs by hand, among them
 * `SystemInfoService.getCurrentMemoryUsage()` and its `@Override`.
 *
 * When the contract and every implementation are in the corpus, and the name
 * appears nowhere but in their own declarations, nothing can call it: no
 * caller spells it, and no ancestor outside the corpus can declare it. The
 * finding then carries one cut per declaration, all or nothing.
 *
 * Deliberately narrow, every doubt keeps the pair:
 * - interfaces only, `fun` members only (properties and abstract classes
 *   are the next step);
 * - a `fun interface`, or an interface with a single abstract method, may be
 *   the target of a lambda that implements it without spelling the name;
 * - an anonymous implementation (`object : I`, `new I() {`) is not a class
 *   the scan can cut in;
 * - any annotation a framework reads (`@GET`, `@Query`, `@Provides`,
 *   `@JavascriptInterface`...) on a declaration, or on a class involved;
 * - a `getX`/`isX`/`setX` is also reachable as `x` (Kotlin property syntax
 *   over Java, data binding), so that bare name must be absent too;
 * - an implementation whose ancestry leaves the corpus may inherit the name
 *   from a type nobody here can read.
 */

export interface ContractCut {
  path: string;
  start: number;
  end: number;
  line: number;
}

export interface UnusedContract {
  interfaceName: string;
  interfaceFqn: string;
  name: string;
  path: string;
  line: number;
  /** The interface declaration first, then every override, in file order. */
  cuts: ContractCut[];
}

export interface ContractScanInput {
  sources: readonly SymbolSource[];
  testSourceSets: readonly string[];
  truncated?: boolean;
  /** G61 : un ancetre de la plateforme connu n interdit plus le contrat. */
  androidApi?: AndroidApi;
}

const IGNORE_MARKER = 'kotlin-jump:ignore unused-member';
const CLASS_LIKE = new Set(['class', 'interface', 'object', 'enum', 'dataClass', 'sealedClass', 'annotation']);
const BENIGN = new Set([...BENIGN_TOPLEVEL_ANNOTATIONS, 'Override', 'JvmStatic', 'JvmOverloads', 'Singleton', 'Reusable']);

interface FileInfo {
  src: SymbolSource;
  parsed: ReturnType<typeof parse>;
  clean: string;
  lineStarts: number[];
  annotations: ReturnType<typeof collectAnnotationTargets>;
  isTest: boolean;
  /** Generated, opted out with the marker: nothing in it may be cut. */
  frozen: boolean;
}

interface TypeInfo {
  decl: TypeDecl;
  file: FileInfo;
  sym: RawSymbol;
  /** Direct members: `fun`, `val`, `var`. Primary-constructor params are not here. */
  members: RawSymbol[];
}

const MEMBER_KINDS = new Set(['fun', 'val', 'var']);
/** Kinds a subclass can extend: an object, an enum or a data class cannot hold a contract. */
const EXTENSIBLE_CLASS_KINDS = new Set(['class', 'sealedClass']);

const annotationNames = (f: FileInfo, sym: RawSymbol): string[] => {
  const lo = f.lineStarts[sym.line];
  const hi = lo + sym.character;
  return f.annotations.filter(a => a.target >= lo && a.target <= hi).map(a => a.name);
};

/**
 * The ancestors this type reaches, and whether every link could be followed.
 * Unlike `chaineResolue`, a foreign link does not stop the walk: the caller
 * must know both that the contract is reached AND that nothing else is.
 */
function ancestry(
  t: TypeInfo,
  typesByName: ReadonlyMap<string, TypeDecl[]>,
  api: AndroidApi | undefined,
): { reached: Set<TypeDecl>; complete: boolean; ambiguous: string[]; platformNames: Set<string> } {
  const reached = new Set<TypeDecl>();
  const ambiguous: string[] = [];
  const platformNames = new Set<string>();
  let complete = true;
  let frontier = t.decl.supertypes.map(b => ({ bare: b, depuis: t.decl as TypeDecl }));
  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const next: typeof frontier = [];
    for (const { bare, depuis } of frontier) {
      if (bare === 'Any' || bare === 'Object') continue;
      const decl = resoudreType(bare, depuis, typesByName);
      if (decl === undefined) { complete = false; ambiguous.push(bare); continue; }
      if (decl === null) {
        // G61 : a platform type the index knows is not a blind spot, only the
        // names it declares are.
        const fqn = api?.resolve(bare, depuis.imports);
        const noms = fqn === undefined ? undefined : api!.declared(fqn);
        if (noms === undefined) complete = false;
        else for (const n of noms) platformNames.add(n);
        continue;
      }
      if (reached.has(decl)) continue;
      reached.add(decl);
      for (const parent of decl.supertypes) next.push({ bare: parent, depuis: decl });
    }
    frontier = next;
  }
  if (frontier.length > 0) complete = false;
  return { reached, complete, ambiguous, platformNames };
}

/** True when the declaration has a body: `{` or `=` after its parameters. */
function bodyOf(f: FileInfo, sym: RawSymbol): 'body' | 'none' | 'unknown' {
  const nameOffset = f.lineStarts[sym.line] + sym.character;
  let i = nameOffset + sym.name.length;
  while (i < f.clean.length && /\s/.test(f.clean[i])) i++;
  if (f.clean[i] !== '(') return 'unknown';
  const close = findMatchingParen(f.clean, i);
  if (close === -1) return 'unknown';
  let lineEnd = f.clean.indexOf('\n', close);
  if (lineEnd === -1) lineEnd = f.clean.length;
  const rest = f.clean.slice(close + 1, lineEnd);
  if (/[{=]/.test(rest)) return 'body';
  if (rest.includes(';')) return 'none';
  // Nothing on the line: Kotlin's bodiless form, unless the body opens on the next one.
  let next = lineEnd + 1;
  while (next < f.clean.length && /\s/.test(f.clean[next])) next++;
  if (f.clean[next] === '{' || f.clean[next] === '=' || f.clean[next] === '.' || /^throws\b/.test(f.clean.slice(next, next + 7))) return 'unknown';
  return f.src.path.endsWith('.java') ? 'unknown' : 'none';
}

/** The removal extent of one declaration, or undefined when it cannot be cut safely. */
function cutOf(f: FileInfo, sym: RawSymbol, lastLine: number, sansCommentaires: () => string): ContractCut | undefined {
  const nameOffset = f.lineStarts[sym.line] + sym.character;
  let span: ReturnType<typeof declarationSpan> | ReturnType<typeof signatureOnlySpan>;
  if (sym.kind === 'fun') {
    const body = bodyOf(f, sym);
    if (body === 'unknown') return undefined;
    span = body === 'body'
      ? declarationSpan(f.clean, f.lineStarts, { kind: 'fun', name: sym.name, line: sym.line, nameOffset, lastLine })
      : signatureOnlySpan(f.clean, f.lineStarts, nameOffset, sym.name);
  } else {
    span = declarationSpan(f.clean, f.lineStarts, { kind: 'prop', name: sym.name, line: sym.line, nameOffset, lastLine });
  }
  if (!span) return undefined;
  // Same clamp as the islands: an extent crossing a following declaration of
  // the same or a shallower depth is refused, never trimmed.
  const intruder = f.parsed.symbols.some(other =>
    other !== sym && other.depth <= sym.depth && !other.isPrimaryCtorParam
    && (other.line > sym.line || (other.line === sym.line && other.character > sym.character))
    && f.lineStarts[other.line] + other.character < span.scanEnd
    && f.lineStarts[other.line] + other.character > nameOffset);
  if (intruder) return undefined;
  try {
    const e = removalExtent(f.src.text, f.clean, f.lineStarts, lastLine, sym, span, sansCommentaires);
    if (e.removeStart < 0 || e.removeEnd <= e.removeStart) return undefined;
    return { path: f.src.path, start: e.removeStart, end: e.removeEnd, line: sym.line };
  } catch {
    return undefined;
  }
}

/** The bare property a `getX`/`isX`/`setX` is also reachable as. */
function bareProperty(name: string): string | undefined {
  const m = /^(?:get|set)([A-Z])(\w*)$/.exec(name);
  if (m) return m[1].toLowerCase() + m[2];
  return /^is[A-Z]/.test(name) ? name : undefined;
}

export function findUnusedContracts(input: ContractScanInput): UnusedContract[] {
  if (input.truncated) return [];
  const scopes = benignWorkspaceAnnotationsOf(input.sources);
  const benign = (n: string) => BENIGN.has(n) || scopes.has(n);

  const files: FileInfo[] = [];
  const typesByName = new Map<string, TypeDecl[]>();
  const types: TypeInfo[] = [];
  const typeOf = new Map<TypeDecl, TypeInfo>();

  for (const src of input.sources) {
    const isJava = src.path.endsWith('.java');
    if (!isJava && !src.path.endsWith('.kt')) continue;
    if (isBuildArtifactPath(src.path)) continue;
    const parsed = isJava ? parseJava(src.path, src.text) : parse(src.path, src.text);
    const clean = sanitizeForUsageScan(src.text);
    const f: FileInfo = {
      src, parsed, clean,
      lineStarts: buildLineStarts(clean),
      annotations: collectAnnotationTargets(clean),
      isTest: isTestSourceSet(src.path, input.testSourceSets),
      frozen: isGeneratedSource(src.text) || src.text.includes(IGNORE_MARKER),
    };
    files.push(f);

    const stack: TypeInfo[] = [];
    for (const s of parsed.symbols) {
      while (stack.length > 0 && stack[stack.length - 1].sym.depth >= s.depth) stack.pop();
      if (CLASS_LIKE.has(s.kind)) {
        const decl: TypeDecl = {
          name: s.name,
          fqn: nestedFqn(parsed.packageName, stack.map(o => o.sym.name), s.name),
          paquet: parsed.packageName,
          imports: parsed.imports,
          isInterface: s.kind === 'interface',
          supertypes: (s.supertypes ?? []).map(t => t.replace(/<.*/, '').trim()).filter(Boolean),
          members: new Set(),
          bindingMembers: new Set(),
        };
        const t: TypeInfo = { decl, file: f, sym: s, members: [] };
        types.push(t);
        typeOf.set(decl, t);
        typesByName.set(s.name, [...(typesByName.get(s.name) ?? []), decl]);
        stack.push(t);
      } else if (MEMBER_KINDS.has(s.kind) && !s.isPrimaryCtorParam
        && stack.length > 0 && stack[stack.length - 1].sym.depth === s.depth - 1) {
        stack[stack.length - 1].members.push(s);
      }
    }
  }

  const ancestries = new Map<TypeInfo, ReturnType<typeof ancestry>>();
  for (const t of types) if (t.decl.supertypes.length > 0) ancestries.set(t, ancestry(t, typesByName, input.androidApi));

  // Every type implemented anonymously somewhere, in ONE pass over the corpus:
  // `object : A, B {` (Kotlin) and `new A() {` (Java). No class to cut in.
  const anonymous = new Set<string>();
  for (const f of files) {
    for (const m of f.clean.matchAll(/\bobject\s*:([^{]*)\{/g)) {
      for (const t of m[1].split(',')) { const bare = /([A-Za-z_]\w*)\s*(?:<.*)?(?:\(.*)?$/.exec(t.trim()); if (bare) anonymous.add(bare[1]); }
    }
    for (const m of f.clean.matchAll(/\bnew\s+(?:[\w]+\.)*([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*\{/g)) anonymous.add(m[1]);
  }
  /** The contracts left once structure is checked, judged after ONE harvest. */
  const pending: { contract: TypeInfo; holders: TypeInfo[]; names: Set<string>; platformNames: Set<string> }[] = [];
  const headOf = (t: { file: FileInfo }, s: RawSymbol) => t.file.clean.slice(t.file.lineStarts[s.line], t.file.lineStarts[s.line] + s.character);
  /** A member that overrides something is not the root of its contract: the root is higher. */
  const overrides = (t: TypeInfo, s: RawSymbol) => /\boverride\b/.test(headOf(t, s)) || annotationNames(t.file, s).includes('Override');

  for (const contract of types) {
    const f = contract.file;
    const isInterface = contract.decl.isInterface;
    if (!isInterface && !EXTENSIBLE_CLASS_KINDS.has(contract.sym.kind)) continue;
    if (f.isTest || f.frozen) continue;
    if (annotationNames(f, contract.sym).some(n => !benign(n))) continue;
    const head = f.clean.slice(f.lineStarts[contract.sym.line], f.lineStarts[contract.sym.line] + contract.sym.character);
    if (/\bfun\s+interface\b/.test(head) || /@interface\b/.test(head)) continue;
    const own = ancestries.get(contract);
    if (own !== undefined && !own.complete) continue;

    const own_ = contract.members.filter(s => !overrides(contract, s) && !/\bstatic\b/.test(headOf(contract, s)));
    // An interface with a single abstract member may be the target of a
    // lambda that implements it without spelling the name. A property counts:
    // it compiles to an abstract getter, so it rules a lambda out as well.
    const abstractMembers = isInterface ? own_.filter(s => s.kind !== 'fun' || bodyOf(f, s) === 'none') : [];
    if (isInterface && abstractMembers.length < 2) continue;

    // Anonymous implementations. The SAM form `Name { }` needs no pattern, a
    // single abstract method already kept the pair.
    const name = contract.decl.name;
    if (anonymous.has(name)) continue;

    // Implementations, anywhere in the corpus, tests included: a fake in a
    // test overrides the method too, and must lose its override with it.
    const impls: TypeInfo[] = [];
    let blocked = false;
    for (const [t, a] of ancestries) {
      const reaches = a.reached.has(contract.decl);
      if (!reaches) {
        if (a.ambiguous.includes(name)) { blocked = true; break; }
        continue;
      }
      if (!a.complete || t.sym.kind === 'enum' || t.file.frozen) { blocked = true; break; }
      if (annotationNames(t.file, t.sym).some(n => !benign(n))) { blocked = true; break; }
      impls.push(t);
    }
    if (blocked || impls.length === 0) continue;

    // An interface offers its abstract members. A class offers what a
    // subclass overrides: the rest is ordinary members, judged elsewhere.
    const offered = isInterface ? abstractMembers
      : own_.filter(s => impls.some(i => i.members.some(m => m.name === s.name && m.kind === s.kind)));
    if (offered.length === 0) continue;
    const platformNames = new Set<string>([...(own?.platformNames ?? [])]);
    for (const i of impls) for (const n of ancestries.get(i)!.platformNames) platformNames.add(n);
    pending.push({ contract, holders: [contract, ...impls], names: new Set(offered.map(s => s.name)), platformNames });
  }

  // One harvest for every name at once: one per contract cost 112 s on a
  // 6000-file project.
  const wanted = new Set<string>();
  for (const { names } of pending) {
    for (const n of names) {
      wanted.add(n);
      const bare = bareProperty(n);
      if (bare) wanted.add(bare);
      for (const a of accessorNames(n)) wanted.add(a);
    }
  }
  const harvest = wanted.size > 0 ? harvestMentions(input.sources, wanted, input.testSourceSets) : undefined;

  const out: UnusedContract[] = [];
  const count = (n: string) => (harvest!.main.get(n) ?? 0) + (harvest!.test.get(n) ?? 0);
  for (const { contract, holders, names, platformNames } of pending) {
    const f = contract.file;
    const name = contract.decl.name;
    for (const n of names) {
      const decls = holders.flatMap(h => h.members.filter(s => s.name === n).map(s => ({ h, s })));
      // G61 : the platform declares this name for one of the classes involved,
      // so the framework may call it.
      if (platformNames.has(n) || accessorNames(n).some(a => platformNames.has(a))) continue;
      if (count(n) !== decls.length) continue;
      const isProperty = decls.some(({ s }) => s.kind !== 'fun');
      if (isProperty && decls.some(({ s }) => s.kind === 'fun')) continue;
      // Reached under another spelling: a Java accessor, a data-binding name.
      if (isProperty && accessorNames(n).some(a => a !== n && count(a) > 0)) continue;
      const bare = bareProperty(n);
      if (!isProperty && bare && bare !== n && count(bare) > 0) continue;
      if (decls.some(({ h, s }) => annotationNames(h.file, s).some(a => !benign(a)))) continue;
      if (decls.some(({ h, s }) => /\b(?:external|native)\b/.test(h.file.clean.slice(h.file.lineStarts[s.line], h.file.lineStarts[s.line] + s.character)))) continue;

      const cuts: ContractCut[] = [];
      for (const { h, s } of decls) {
        const lastLine = h.file.lineStarts.length - 1;
        let copie: string | undefined;
        const c = cutOf(h.file, s, lastLine, () => (copie ??= stripKotlinComments(h.file.src.text)));
        if (!c) { cuts.length = 0; break; }
        cuts.push(c);
      }
      if (cuts.length !== decls.length) continue;

      const first = decls.find(d => d.h === contract)!;
      out.push({
        interfaceName: name,
        interfaceFqn: contract.decl.fqn,
        name: n,
        path: f.src.path,
        line: first.s.line,
        cuts,
      });
    }
  }
  return out.sort((a, b) => a.interfaceFqn.localeCompare(b.interfaceFqn) || a.name.localeCompare(b.name));
}
