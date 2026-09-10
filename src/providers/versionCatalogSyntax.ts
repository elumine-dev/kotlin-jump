/**
 * VS Code ships no TOML grammar, so `gradle/libs.versions.toml` opens as plain
 * text: one colour for the whole file, and nothing to collapse because the
 * default folding falls back to indentation and TOML has none.
 *
 * This scanner reads the catalog once and produces both, which is more than a
 * generic TOML grammar could: it knows a `version.ref` points at a key of the
 * `[versions]` table, so a reference is coloured as a reference rather than as
 * one more string.
 *
 * No vscode import: the providers wrap it, the tests call it directly.
 */

/** Legend order. The index of each name is what the provider pushes. */
export const CATALOG_TOKEN_TYPES = [
  'namespace',  // [versions], [libraries], [plugins]
  'property',   // the alias on the left of =
  'parameter',  // module, group, name, id, version.ref
  'string',     // a coordinate, a plugin id
  'number',     // a version literal
  'enumMember', // the target of a version.ref
  'comment',
] as const;

export type CatalogTokenType = typeof CATALOG_TOKEN_TYPES[number];

export interface CatalogToken {
  line:   number; // 0 based
  start:  number; // 0 based column
  length: number;
  type:   CatalogTokenType;
}

/** Both bounds are 0 based line numbers, both inclusive. */
export interface CatalogRegion {
  start: number;
  end:   number;
}

export interface CatalogScan {
  tokens:  CatalogToken[];
  regions: CatalogRegion[];
}

const RE_SECTION = /^(\s*)(\[\[?[^\]]*\]\]?)/;
const RE_HEADER_LINE = /^\s*\[/;
// A version literal starts with a digit: `1.8.0`, `33.5.0-android`, `2.21`.
// A coordinate (`group:artifact`) and a plugin id never do.
const RE_VERSION = /^[0-9][A-Za-z0-9.\-+_]*$/;
const RE_KEY_START = /[A-Za-z_]/;
const RE_KEY_BODY  = /[A-Za-z0-9_.\-]/;

/**
 * Column where the trailing comment starts, or the line length when there is
 * none. A `#` inside a string is not a comment: several entries carry an URL
 * with a fragment.
 */
function commentAt(line: string): number {
  let quote: string | undefined;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== undefined) {
      if (c === '\\' && quote === '"') { i++; continue; }
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#') return i;
  }
  return line.length;
}

/** Index of the closing quote, or the line length when the string never closes. */
function stringEnd(code: string, open: number): number {
  const quote = code[open];
  for (let i = open + 1; i < code.length; i++) {
    if (code[i] === '\\' && quote === '"') { i++; continue; }
    if (code[i] === quote) return i;
  }
  return code.length;
}

function valueType(key: string, content: string): CatalogTokenType {
  if (key === 'version.ref' || key === 'ref') return 'enumMember';
  return RE_VERSION.test(content) ? 'number' : 'string';
}

export function scanVersionCatalog(text: string): CatalogScan {
  const lines   = text.split('\n');
  const tokens: CatalogToken[]  = [];
  const regions: CatalogRegion[] = [];
  const headers: number[] = [];

  let ouvertA = -1; // line where the current multi line value opened
  let depth   = 0;  // bracket depth carried across lines

  for (let l = 0; l < lines.length; l++) {
    const brut  = lines[l].replace(/\r$/, '');
    const fin   = commentAt(brut);
    const code  = brut.slice(0, fin);
    const entete = RE_HEADER_LINE.test(code);

    if (entete) {
      // A table header is always at top level, so it closes any value left
      // open by a malformed line above: without this reset every alias below
      // an unclosed bracket would be read as an inline table key.
      depth = 0;
      ouvertA = -1;
      const m = RE_SECTION.exec(code);
      if (m) { tokens.push({ line: l, start: m[1].length, length: m[2].length, type: 'namespace' }); headers.push(l); }
    } else {
      let key = '';
      let i = 0;
      while (i < code.length) {
        const c = code[i];
        if (c === '"' || c === "'") {
          const clos = stringEnd(code, i);
          const contenu = code.slice(i + 1, clos);
          tokens.push({ line: l, start: i, length: Math.min(clos, code.length - 1) + 1 - i, type: valueType(key, contenu) });
          i = clos + 1;
          continue;
        }
        if (c === '{' || c === '[') { if (depth === 0) ouvertA = l; depth++; i++; continue; }
        if (c === '}' || c === ']') {
          depth--;
          if (depth <= 0) {
            if (ouvertA !== -1 && l > ouvertA) regions.push({ start: ouvertA, end: l });
            depth = 0; ouvertA = -1;
          }
          i++;
          continue;
        }
        if (RE_KEY_START.test(c)) {
          let j = i;
          while (j < code.length && RE_KEY_BODY.test(code[j])) j++;
          let k = j;
          while (k < code.length && code[k] === ' ') k++;
          if (code[k] === '=') {
            // The alias sits at the left margin; module, group, name, id and
            // version.ref live inside the inline table.
            tokens.push({ line: l, start: i, length: j - i, type: depth === 0 ? 'property' : 'parameter' });
            key = code.slice(i, j);
          }
          i = j;
          continue;
        }
        i++;
      }
    }

    if (fin < brut.length) tokens.push({ line: l, start: fin, length: brut.length - fin, type: 'comment' });
  }

  // One foldable region per table, ending on its last non blank line so the
  // collapsed form does not swallow the separator before the next header.
  for (let h = 0; h < headers.length; h++) {
    const debut = headers[h];
    const borne = h + 1 < headers.length ? headers[h + 1] : lines.length;
    let fin = debut;
    for (let l = debut + 1; l < borne; l++) if (lines[l].trim() !== '') fin = l;
    if (fin > debut) regions.push({ start: debut, end: fin });
  }

  regions.sort((a, b) => a.start - b.start || a.end - b.end);
  return { tokens, regions };
}
