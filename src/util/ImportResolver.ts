import * as vscode from 'vscode';

interface DocCache {
  version: number;
  packageName: string;
  exact: string[];           // "com.example.Foo"
  wildcardPrefixes: string[]; // "com.example" (from "import com.example.*")
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
  const candidates: string[] = [];

  for (const imp of c.exact) {
    if (imp.endsWith(`.${simpleName}`)) candidates.push(imp);
  }

  for (const prefix of c.wildcardPrefixes) {
    candidates.push(`${prefix}.${simpleName}`);
  }

  // Same-package resolution (no import needed)
  if (c.packageName) candidates.push(`${c.packageName}.${simpleName}`);

  return candidates;
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
