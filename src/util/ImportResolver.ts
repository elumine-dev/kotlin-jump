import * as vscode from 'vscode';

interface DocCache {
  version: number;
  packageName: string;
  exact: string[];           // "com.example.Foo"
  wildcardPrefixes: string[]; // "com.example" (from "import com.example.*")
}

export type ResolutionPriority = 'exact' | 'samePackage' | 'wildcard' | 'none';

export interface ResolutionResult<T> {
  priority: ResolutionPriority;
  matches: T[];
}

// Keyed by document URI string; evicted when document version changes
const cache = new Map<string, DocCache>();

const RE_PACKAGE = /^\s*package\s+([\w.]+)/m;
const RE_IMPORT  = /^\s*import\s+([\w.*]+)/gm;

/**
 * Returns candidate FQNs for `simpleName` based on the document's imports.
 * Called on the Cmd+Click hot path — must be synchronous and fast.
 */
export function resolve(simpleName: string, document: vscode.TextDocument): string[] {
  const c = getCache(document);
  const candidates = [
    ...exactCandidates(simpleName, c),
    ...samePackageCandidates(simpleName, c),
    ...wildcardCandidates(simpleName, c),
  ];
  return [...new Set(candidates)];
}

/**
 * Resolves the highest-priority candidate group for a symbol:
 * exact import > same package > wildcard imports.
 * If the chosen group contains multiple matches, the caller can treat it as ambiguous.
 */
export function resolveBest<T>(
  simpleName: string,
  document: vscode.TextDocument,
  lookup: (fqn: string) => T | undefined,
): ResolutionResult<T> {
  const c = getCache(document);

  const exact = resolveGroup(exactCandidates(simpleName, c), lookup);
  if (exact.length > 0) return { priority: 'exact', matches: exact };

  const samePackage = resolveGroup(samePackageCandidates(simpleName, c), lookup);
  if (samePackage.length > 0) return { priority: 'samePackage', matches: samePackage };

  const wildcard = resolveGroup(wildcardCandidates(simpleName, c), lookup);
  if (wildcard.length > 0) return { priority: 'wildcard', matches: wildcard };

  return { priority: 'none', matches: [] };
}

export function evict(uri: vscode.Uri): void {
  cache.delete(uri.toString());
}

function getCache(document: vscode.TextDocument): DocCache {
  const key = document.uri.toString();
  const hit = cache.get(key);
  if (hit && hit.version === document.version) return hit;

  const text = document.getText();
  const pkgMatch = RE_PACKAGE.exec(text);

  const exact: string[] = [];
  const wildcardPrefixes: string[] = [];
  RE_IMPORT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_IMPORT.exec(text)) !== null) {
    const imp = m[1];
    if (imp.endsWith('.*')) {
      wildcardPrefixes.push(imp.slice(0, -2));
    } else {
      exact.push(imp);
    }
  }

  const entry: DocCache = {
    version: document.version,
    packageName: pkgMatch ? pkgMatch[1] : '',
    exact,
    wildcardPrefixes,
  };
  cache.set(key, entry);
  return entry;
}

function exactCandidates(simpleName: string, cache: DocCache): string[] {
  return cache.exact.filter(imp => imp.endsWith(`.${simpleName}`));
}

function samePackageCandidates(simpleName: string, cache: DocCache): string[] {
  return cache.packageName ? [`${cache.packageName}.${simpleName}`] : [];
}

function wildcardCandidates(simpleName: string, cache: DocCache): string[] {
  return cache.wildcardPrefixes.map(prefix => `${prefix}.${simpleName}`);
}

function resolveGroup<T>(
  candidates: string[],
  lookup: (fqn: string) => T | undefined,
): T[] {
  const matches = new Set<T>();
  for (const candidate of candidates) {
    const hit = lookup(candidate);
    if (hit !== undefined) matches.add(hit);
  }
  return [...matches];
}
