/**
 * KJ-031 pure core: which resource keys nothing in the workspace references.
 *
 * No vscode import, so the detector runs in tests and in
 * `scripts/scan-unused-resource-keys.ts` without an extension host. The
 * VS Code shell lives in `UnusedResourceKeyProvider.ts`, which re-exports
 * everything here.
 */
import {
  ValueKeyDeclaration,
  ValueResKind,
  collectValueKeyDeclarations,
} from '../indexer/ValueResourceScanner';
import {
  blankValueDeclarationNames,
  collectStringLiterals,
  collectStyleItemAttrNames,
  collectStyleParentRefs,
  collectStyleableTokens,
  collectThemeAttrRefs,
  collectValueResourceRefs,
  normalizeResourceName,
  styleParentClosure,
  styleableCovers,
} from '../util/xmlRefs';
import { isBuildArtifactPath, isVendorOwnedName } from '../util/resourceAllowlists';
import { ResourceSource } from './UnusedResourceProvider';

/**
 * KJ-031: entries in `res/values*​/*.xml` that nothing references.
 *
 * The contract, same as the rest of the family:
 *
 *   A finding means NO TEXTUAL REFERENCE TO THIS KEY EXISTS IN WHAT WE CAN
 *   READ. It does not mean the build has no other consumer.
 *
 * Any occurrence we cannot classify counts as a usage, so the guards below can
 * only ever suppress a warning, never create one. Every one of them exists
 * because a one-by-one audit of a 3444-file project produced a false positive
 * without it; the counts in the comments are that audit's.
 *
 * Complexity is O(corpus text), independent of how many keys are declared.
 * That is the point: a workspace has thousands of keys, and an
 * O(keys × files) loop would put a multi-second scan on a 3000-file project.
 */

const ALL_KINDS: readonly ValueResKind[] = [
  'string', 'color', 'dimen', 'style', 'attr', 'integer', 'bool', 'array', 'plurals',
];

const IGNORE_MARKER = 'kotlin-jump:ignore unused-resource';

export interface UnusedKeyScanInput {
  declarations: readonly ValueKeyDeclaration[];
  sources: readonly ResourceSource[];
  modulesWithCode: readonly string[];
  libraryModules?: readonly string[];
  /** An incomplete corpus cannot prove absence, so it produces nothing. */
  truncated?: boolean;
  ignorePrefixes?: readonly string[];
}

export interface UnusedResourceKey {
  kind: ValueResKind;
  name: string;
  /** Base first, then every qualifier override. Deletion removes them all. */
  variants: ValueKeyDeclaration[];
  base: ValueKeyDeclaration;
  isLibraryModule: boolean;
}

/** Everything any reference syntax can reach, harvested in one pass. */
interface AliveSet {
  byKind: Map<string, Set<string>>;
  literals: Set<string>;
  styleParents: Set<string>;
  themeAttrs: Set<string>;
  styleableTokens: Set<string>;
  styleItemAttrs: Set<string>;
}

function isValuesPath(path: string): boolean {
  return /[\\/]res[\\/]values(?:-[^\\/]+)?[\\/][^\\/]+\.xml$/.test(path);
}

function harvest(sources: readonly ResourceSource[]): AliveSet {
  const alive: AliveSet = {
    byKind: new Map(ALL_KINDS.map(k => [k as string, new Set<string>()])),
    literals: new Set(),
    styleParents: new Set(),
    themeAttrs: new Set(),
    styleableTokens: new Set(),
    styleItemAttrs: new Set(),
  };

  for (const src of sources) {
    // G2: R8 writes every resource name of the build into seeds/usage/mapping.
    // Reading one as evidence marks the entire project alive (80 keys).
    if (isBuildArtifactPath(src.path)) continue;

    const isCode = /\.(kt|kts|java)$/.test(src.path);
    const isXml = /\.xml$/.test(src.path);
    const isBuildScript = /\.(gradle|kts|toml|pro|properties)$/.test(src.path);

    if (isCode || isXml) {
      for (const ref of collectValueResourceRefs(src.text, src.path, ALL_KINDS)) {
        alive.byKind.get(ref.kind)!.add(normalizeResourceName(ref.name));
      }
    }

    if (isCode) {
      for (const t of collectStyleableTokens(src.text)) alive.styleableTokens.add(t);
    }

    // G1b: bare literals come from CODE and build scripts ONLY. Harvesting them
    // from a values file would match every `name="…"` and resurrect everything.
    if (isCode || isBuildScript) {
      for (const lit of collectStringLiterals(src.text)) alive.literals.add(lit);
    }

    if (isXml) {
      for (const p of collectStyleParentRefs(src.text)) alive.styleParents.add(p);
      for (const a of collectThemeAttrRefs(src.text)) alive.themeAttrs.add(a);
      for (const a of collectStyleItemAttrNames(src.text)) alive.styleItemAttrs.add(a);
      if (!isValuesPath(src.path)) {
        for (const lit of collectStringLiterals(src.text)) alive.literals.add(lit);
      } else {
        // A values file may still name a key in its VALUES (`<item>@color/x</item>`);
        // only its declaration names must be blanked out.
        for (const lit of collectStringLiterals(blankValueDeclarationNames(src.text))) {
          alive.literals.add(lit);
        }
      }
    }
  }

  return alive;
}

function isReferenced(
  decl: ValueKeyDeclaration,
  alive: AliveSet,
  implicitStyleParents: ReadonlySet<string>,
): boolean {
  const raw = decl.name;
  const norm = normalizeResourceName(raw);

  if (alive.byKind.get(decl.kind)?.has(norm)) return true;
  if (alive.literals.has(raw) || alive.literals.has(norm)) return true;

  if (decl.kind === 'style') {
    if (alive.styleParents.has(raw) || alive.styleParents.has(norm)) return true;
    // G5: declaring `A.B.C` keeps `A.B` and `A` alive, with no textual
    // occurrence of the parent name anywhere in the workspace.
    if (implicitStyleParents.has(raw)) return true;
  }

  if (decl.kind === 'attr') {
    if (alive.themeAttrs.has(raw)) return true;
    if (alive.styleItemAttrs.has(raw)) return true;
    // G6: the attr name is only a SUFFIX of `R.styleable.Styleable_attr`, and
    // both halves can contain '_', so the split is ambiguous. Match by suffix.
    if (styleableCovers(alive.styleableTokens, raw)) return true;
  }

  return false;
}

export function findUnusedResourceKeys(input: UnusedKeyScanInput): UnusedResourceKey[] {
  // Contract rule 2: a corpus we could not fully read proves nothing.
  if (input.truncated) return [];

  const modulesWithCode = new Set(input.modulesWithCode);
  const libraryModules = new Set(input.libraryModules ?? []);
  const alive = harvest(input.sources);

  // Files that opted out entirely.
  const exempt = new Set(
    input.sources.filter(s => s.text.includes(IGNORE_MARKER)).map(s => s.path),
  );

  // Styleable members are alive by membership: an `<attr format=…>` nested in a
  // declare-styleable is consumed through R.styleable, whether or not we can
  // prove the styleable itself is used. Recall traded for the zero-FP property.
  const styleableMembers = new Set<string>();
  for (const src of input.sources) {
    if (!/\.xml$/.test(src.path) || isBuildArtifactPath(src.path)) continue;
    const RE = /<declare-styleable[^>]*>([\s\S]*?)<\/declare-styleable>/g;
    let block: RegExpExecArray | null;
    while ((block = RE.exec(src.text)) !== null) {
      const ATTR = /<attr[^>]*\bname\s*=\s*"([^"]+)"/g;
      let attr: RegExpExecArray | null;
      while ((attr = ATTR.exec(block[1])) !== null) styleableMembers.add(attr[1]);
    }
  }

  const implicitStyleParents = styleParentClosure(
    input.declarations.filter(d => d.kind === 'style').map(d => d.name),
  );

  // Group by module: the same key in two modules is an overlay, not a duplicate.
  const groups = new Map<string, ValueKeyDeclaration[]>();
  const modulesByKey = new Map<string, Set<string>>();
  for (const decl of input.declarations) {
    const globalKey = `${decl.kind}/${decl.name}`;
    if (!modulesByKey.has(globalKey)) modulesByKey.set(globalKey, new Set());
    modulesByKey.get(globalKey)!.add(decl.moduleDir);

    const key = `${decl.moduleDir}|${globalKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(decl);
  }

  const out: UnusedResourceKey[] = [];
  for (const variants of groups.values()) {
    const first = variants[0];

    if (variants.some(v => exempt.has(v.path))) continue;

    // G3: a key a third-party SDK reads by name has no reference to find.
    if (isVendorOwnedName(first.name, input.ignorePrefixes)) continue;

    // Inherited from KJ-029: an overlay across modules is not ours to judge.
    if ((modulesByKey.get(`${first.kind}/${first.name}`)?.size ?? 0) > 1) continue;

    // Inherited from KJ-029: a module with no code cannot consume its own keys.
    if (!modulesWithCode.has(first.moduleDir)) continue;

    if (first.kind === 'attr' && styleableMembers.has(first.name)) continue;

    if (isReferenced(first, alive, implicitStyleParents)) continue;

    const sorted = [...variants].sort((a, b) => {
      if (a.isBase !== b.isBase) return a.isBase ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    out.push({
      kind: first.kind,
      name: first.name,
      variants: sorted,
      base: sorted[0],
      isLibraryModule: libraryModules.has(first.moduleDir),
    });
  }

  return out.sort((a, b) =>
    a.base.path.localeCompare(b.base.path) || a.base.start - b.base.start);
}

const KIND_LABEL: Record<ValueResKind, string> = {
  string: 'String', color: 'Color', dimen: 'Dimension', style: 'Style',
  attr: 'Attribute', integer: 'Integer', bool: 'Boolean',
  array: 'Array', plurals: 'Plurals',
};

export function messageFor(finding: UnusedResourceKey): string {
  const variants = finding.variants.length > 1 ? ` (${finding.variants.length} variants)` : '';
  const scope = finding.isLibraryModule
    ? ' anywhere in this workspace (library module, an external consumer may use it)'
    : '';
  return `${KIND_LABEL[finding.kind]} '${finding.name}' is never referenced${scope}${variants}`;
}

export function deleteTitleFor(finding: UnusedResourceKey): string {
  const n = finding.variants.length;
  const suffix = n > 1 ? ` (${n} files)` : '';
  return `Delete unused ${finding.kind} ${finding.name}${suffix}`;
}

/**
 * Widens a range to whole lines when nothing else shares them, so removing an
 * entry does not leave an orphan blank line behind.
 */
export function expandToWholeLines(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let lineStart = text.lastIndexOf('\n', Math.max(start - 1, 0));
  lineStart = lineStart === -1 ? 0 : lineStart + 1;
  let lineEnd = text.indexOf('\n', end);
  lineEnd = lineEnd === -1 ? text.length : lineEnd + 1;

  const before = text.slice(lineStart, start);
  const after = text.slice(end, lineEnd);
  if (before.trim() !== '' || after.trim() !== '') return { start, end };
  return { start: lineStart, end: lineEnd };
}

