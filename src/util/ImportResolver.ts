import * as vscode from 'vscode';

interface DocCache {
  version: number;
  packageName: string;
  exact: string[];            // "com.example.Foo"
  wildcardPrefixes: string[]; // "com.example" (from "import com.example.*")
  aliases: Map<string, string>; // alias → original FQN (from "import com.example.Foo as Bar")
}

export type ResolutionPriority = 'exact' | 'samePackage' | 'wildcard' | 'none';

export interface ResolutionResult<T> {
  priority: ResolutionPriority;
  matches: T[];
}

// Keyed by document URI string; evicted when document version changes
const cache = new Map<string, DocCache>();

const RE_PACKAGE = /^\s*package\s+([\w.]+)/m;
const RE_IMPORT  = /^\s*import\s+([\w.*]+)(?:\s+as\s+(\w+))?/gm;

// Kotlin's default imports — verified against the compiler source (master):
//   compiler/frontend.common/src/org/jetbrains/kotlin/resolve/DefaultImportsProvider.kt
//   compiler/frontend.java/src/org/jetbrains/kotlin/resolve/jvm/platform/JvmDefaultImportsProvider.kt
//
// These behave as implicit `import <pkg>.*` in every .kt file. Without them,
// Cmd+Click on `listOf` / `println` / `String` / `Int` / `Sequence` etc. fails
// silently when the user hasn't typed a redundant `import kotlin.collections.*`.
//
// Order matches the compiler's priority chain: regular defaults first, then
// `kotlin.jvm.*` (JVM regular default), then `java.lang.*` LAST because the
// compiler classifies it as `defaultLowPriorityImports` — when `kotlin.String`
// and `java.lang.String` both exist, the kotlin one must win.
//
// Note: `kotlin.math.*` is NOT a default import (despite a misleading mention
// in the language specification page) — using `sin`, `cos`, etc. requires an
// explicit `import kotlin.math.sin` in real Kotlin code.
const KOTLIN_DEFAULT_IMPORTS: readonly string[] = [
  'kotlin',
  'kotlin.annotation',
  'kotlin.collections',
  'kotlin.ranges',
  'kotlin.sequences',
  'kotlin.text',
  'kotlin.io',
  'kotlin.comparisons',
  'kotlin.jvm',
  'java.lang',
];

// Java's sole implicit import — `java.lang.*` (JLS §7.3).
const JAVA_DEFAULT_IMPORTS: readonly string[] = ['java.lang'];

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
  const aliases = new Map<string, string>();
  RE_IMPORT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_IMPORT.exec(text)) !== null) {
    const imp = m[1];
    const alias = m[2];
    if (imp.endsWith('.*')) {
      wildcardPrefixes.push(imp.slice(0, -2));
    } else if (alias) {
      // Aliased import: `import com.example.Foo as Bar`
      // Keep in exact for original-name lookup (used by isEnclosingClassVisible and
      // similar FQN-based checks), and store in aliases for alias-name lookup.
      aliases.set(alias, imp);
      exact.push(imp);
    } else {
      exact.push(imp);
    }
  }

  // Append language-specific implicit wildcard imports so resolution of
  // stdlib symbols (e.g. `listOf`, `println`, `String`) doesn't require
  // an explicit `import kotlin.collections.*` in every file.
  const defaults =
    document.languageId === 'kotlin' ? KOTLIN_DEFAULT_IMPORTS
    : document.languageId === 'java' ? JAVA_DEFAULT_IMPORTS
    : [];
  for (const pkg of defaults) {
    if (!wildcardPrefixes.includes(pkg)) wildcardPrefixes.push(pkg);
  }

  const entry: DocCache = {
    version: document.version,
    packageName: pkgMatch ? pkgMatch[1] : '',
    exact,
    wildcardPrefixes,
    aliases,
  };
  cache.set(key, entry);
  return entry;
}

function exactCandidates(simpleName: string, cache: DocCache): string[] {
  const fromAlias = cache.aliases.get(simpleName);
  const fromExact = cache.exact.filter(imp => imp.endsWith(`.${simpleName}`));
  return fromAlias ? [fromAlias, ...fromExact] : fromExact;
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
