// No vscode import — mirrors KotlinParser.ts; safe to run in worker threads

import { ParsedFile, RawSymbol, SymbolKind } from './KotlinParser';

const RE_PACKAGE = /^\s*package\s+([\w.]+)/;
// Handles: class, interface, enum, record, @interface (annotation type)
// Any combination of Java modifiers before the keyword
const RE_CLASS = /^\s*(?:(?:public|protected|private|static|abstract|final|strictfp|sealed|non-sealed)\s+)*(@?(?:class|interface|enum|record))\s+(\w+)/;

export function parseJava(uriString: string, text: string): ParsedFile {
  const symbols: RawSymbol[] = [];
  let packageName = '';
  let inBlockComment = false;

  const len = text.length;
  let pos     = 0;
  let lineNum = 0;

  while (pos < len) {
    let nl = text.indexOf('\n', pos);
    if (nl === -1) nl = len;

    if (nl === pos) { pos = nl + 1; lineNum++; continue; }

    let fns = pos;
    while (fns < nl && (text[fns] === ' ' || text[fns] === '\t')) fns++;
    if (fns >= nl) { pos = nl + 1; lineNum++; continue; }

    const fc  = text[fns];
    const fc1 = fns + 1 < nl ? text[fns + 1] : '';

    if (fc === '/' && fc1 === '/') { pos = nl + 1; lineNum++; continue; }

    if (fc === '/' && fc1 === '*') {
      const closePos = text.indexOf('*/', fns + 2);
      if (closePos === -1 || closePos >= nl) inBlockComment = true;
      pos = nl + 1; lineNum++; continue;
    }

    if (inBlockComment) {
      const close = text.indexOf('*/', pos);
      if (close !== -1 && close < nl) inBlockComment = false;
      pos = nl + 1; lineNum++; continue;
    }

    // Fast skip — only lines starting with p, @, a-z, A-Z can be declarations
    if (!JAVA_DECL_START[fc]) { pos = nl + 1; lineNum++; continue; }

    const raw = text.slice(pos, nl);

    if (!packageName && fc === 'p') {
      const m = RE_PACKAGE.exec(raw);
      if (m) { packageName = m[1]; pos = nl + 1; lineNum++; continue; }
    }

    const cm = RE_CLASS.exec(raw);
    if (cm) {
      const name = cm[2];
      const supertypes = extractJavaSupertypes(raw);
      symbols.push({
        name,
        kind: toJavaKind(cm[1]),
        line: lineNum,
        character: raw.indexOf(name, cm.index),
        isComposable: false,
        depth: 0,
        supertypes: supertypes.length > 0 ? supertypes : undefined,
      });
    }

    pos = nl + 1;
    lineNum++;
  }

  return { uriString, packageName, imports: [], symbols };
}

const JAVA_DECL_START: Record<string, boolean> = Object.fromEntries(
  '@abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => [c, true])
);

const RE_JAVA_TYPE_NAME = /\b([A-Z]\w+)\b/g;

// Strip generic params: "ArrayList<String>" → "ArrayList", "Map<K, V>" → "Map"
function stripGenerics(s: string): string {
  let result = '', depth = 0;
  for (const c of s) {
    if (c === '<') { depth++; continue; }
    if (c === '>') { depth--; continue; }
    if (depth === 0) result += c;
  }
  return result;
}

function extractJavaSupertypes(line: string): string[] {
  const types: string[] = [];
  const extendsMatch = /\bextends\s+(.+?)(?:\bimplements\b|\{|$)/.exec(line);
  if (extendsMatch) {
    const clean = stripGenerics(extendsMatch[1]);
    RE_JAVA_TYPE_NAME.lastIndex = 0;
    let m;
    while ((m = RE_JAVA_TYPE_NAME.exec(clean))) types.push(m[1]);
  }
  const implMatch = /\bimplements\s+(.+?)(?:\{|$)/.exec(line);
  if (implMatch) {
    const clean = stripGenerics(implMatch[1]);
    RE_JAVA_TYPE_NAME.lastIndex = 0;
    let m;
    while ((m = RE_JAVA_TYPE_NAME.exec(clean))) types.push(m[1]);
  }
  return types;
}

function toJavaKind(keyword: string): SymbolKind {
  switch (keyword) {
    case 'enum':        return 'enum';
    case 'interface':   return 'interface';
    case '@interface':  return 'annotation';
    default:            return 'class'; // class, record
  }
}
