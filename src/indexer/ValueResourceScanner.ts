import { stripXmlComments } from '../util/xmlRefs';

/**
 * KJ-031: enumerates the resource keys declared in `res/values*​/*.xml`.
 *
 * A bank of per-kind regexes cannot do this job. It could not tell an
 * `<item name="x">` inside a `<style>` (which NAMES an attr) from a real
 * declaration, could not find the matching close tag that the deletion range
 * needs, and would break on `<string name="a">a > b</string>`. So this is a
 * real, if shallow, tokenizer: one pass, one element stack.
 *
 * Depth is what disambiguates. At depth 1 an `<attr>` or `<item>` declares
 * something; at depth 2 the same element usually references something. See
 * `kindOf`.
 */

export type ValueResKind =
  | 'string' | 'color' | 'dimen' | 'style' | 'attr'
  | 'integer' | 'bool' | 'array' | 'plurals';

export interface ValueKeyDeclaration {
  kind: ValueResKind;
  name: string;
  path: string;
  /** Folder name with qualifiers: `values`, `values-night`, `values-w1024dp`. */
  qualifier: string;
  isBase: boolean;
  /** Nearest module dir, or '' when the caller passed none. */
  moduleDir: string;
  /** The WHOLE entry: `<` of the open tag through the end of its close tag. */
  start: number;
  end: number;
  /** 0-based position of the `name="…"` value, for the diagnostic range. */
  line: number;
  character: number;
  nameLength: number;
}

const VALUES_PATH_RE = /[\\/]res[\\/](values(?:-[^\\/]+)?)[\\/][^\\/]+\.xml$/;

export function parseValuesPath(path: string): { qualifier: string; isBase: boolean } | undefined {
  const m = VALUES_PATH_RE.exec(path);
  if (!m) return undefined;
  return { qualifier: m[1], isBase: m[1] === 'values' };
}

const ELEMENT_KIND: Record<string, ValueResKind> = {
  string: 'string',
  color: 'color',
  dimen: 'dimen',
  integer: 'integer',
  bool: 'bool',
  style: 'style',
  plurals: 'plurals',
  'string-array': 'array',
  'integer-array': 'array',
  array: 'array',
};

const DECLARABLE_ITEM_TYPES = new Set<string>([
  'string', 'color', 'dimen', 'integer', 'bool', 'style', 'array', 'plurals', 'attr',
]);

interface Tag {
  name: string;
  attrs: Map<string, string>;
  /** Offset of `<`. */
  start: number;
  /** Offset just past `>`. */
  afterOpen: number;
  selfClosing: boolean;
  /** Offset of the `name="…"` VALUE, or -1. */
  nameValueAt: number;
}

/**
 * Decides what an element declares, given how deep it sits.
 *
 * Depth 1 = direct child of `<resources>`. Depth 2 = inside a `<style>` or a
 * `<declare-styleable>`, where:
 *   - `<attr name="x"/>` without `format` REFERENCES an attr declared elsewhere
 *   - `<item name="x">` names the attr the style is setting
 * Neither declares a key, which is exactly the `android:textColor` trap.
 */
function kindOf(tag: Tag, depth: number, parent: string | undefined): ValueResKind | undefined {
  const name = tag.attrs.get('name');
  if (!name) return undefined;

  // aapt has no namespace for local resources; `android:textColor` is a
  // reference to the platform attribute, never a declaration of ours.
  if (name.includes(':')) return undefined;

  if (tag.name === 'attr') {
    // A styleable member only declares when it carries its own format.
    if (depth === 2 && parent === 'declare-styleable') {
      return tag.attrs.has('format') ? 'attr' : undefined;
    }
    return depth === 1 ? 'attr' : undefined;
  }

  if (tag.name === 'item') {
    if (depth !== 1) return undefined;          // an item inside a style names an attr
    const type = tag.attrs.get('type');
    if (!type || type === 'id') return undefined; // @+id is a declaration and a reference at once
    return DECLARABLE_ITEM_TYPES.has(type) ? (type as ValueResKind) : undefined;
  }

  if (depth !== 1) return undefined;
  return ELEMENT_KIND[tag.name];
}

/** Reads a tag starting at `<`, or returns undefined when it is not one. */
function readTag(xml: string, at: number): Tag | { skipTo: number } | undefined {
  if (xml[at] !== '<') return undefined;

  const next = xml[at + 1];
  if (next === '?' || next === '!') {
    // Prolog, DOCTYPE, or CDATA: skip wholesale, never interpret.
    if (xml.startsWith('<![CDATA[', at)) {
      const end = xml.indexOf(']]>', at);
      return { skipTo: end === -1 ? xml.length : end + 3 };
    }
    const end = xml.indexOf('>', at);
    return { skipTo: end === -1 ? xml.length : end + 1 };
  }
  if (next === '/') {
    const end = xml.indexOf('>', at);
    return { skipTo: end === -1 ? xml.length : end + 1 };
  }

  const nameMatch = /^<([A-Za-z_][\w.-]*)/.exec(xml.slice(at, at + 128));
  if (!nameMatch) return undefined;

  let i = at + nameMatch[0].length;
  const attrs = new Map<string, string>();
  let nameValueAt = -1;
  let selfClosing = false;

  while (i < xml.length) {
    const ch = xml[i];
    if (ch === '>') { i++; break; }
    if (ch === '/' && xml[i + 1] === '>') { selfClosing = true; i += 2; break; }
    if (/\s/.test(ch)) { i++; continue; }

    const attr = /^([A-Za-z_][\w:.-]*)\s*=\s*(["'])/.exec(xml.slice(i));
    if (!attr) { i++; continue; }
    const valueStart = i + attr[0].length;
    const close = xml.indexOf(attr[2], valueStart);
    if (close === -1) { i = xml.length; break; }
    // A `>` inside the quoted value is data, which is why this loop exists.
    attrs.set(attr[1], xml.slice(valueStart, close));
    if (attr[1] === 'name' && nameValueAt === -1) nameValueAt = valueStart;
    i = close + 1;
  }

  return { name: nameMatch[1], attrs, start: at, afterOpen: i, selfClosing, nameValueAt };
}

/** Offset just past `</name>`, or `from` when the document ends first. */
function findCloseTag(xml: string, name: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) break;
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt);
      i = end === -1 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith(`</${name}`, lt)) {
      depth--;
      const gt = xml.indexOf('>', lt);
      if (depth === 0) return gt === -1 ? xml.length : gt + 1;
      i = gt === -1 ? xml.length : gt + 1;
      continue;
    }
    if (xml.startsWith(`<${name}`, lt) && /[\s/>]/.test(xml[lt + name.length + 1] ?? '>')) {
      const tag = readTag(xml, lt);
      if (tag && 'name' in tag) {
        if (!tag.selfClosing) depth++;
        i = tag.afterOpen;
        continue;
      }
    }
    i = lt + 1;
  }
  return xml.length;
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function positionAt(starts: readonly number[], offset: number): { line: number; character: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low, character: offset - starts[low] };
}

function moduleDirOf(path: string, moduleDirs: readonly string[]): string {
  let best = '';
  for (const dir of moduleDirs) {
    if ((path.startsWith(`${dir}/`) || path.startsWith(`${dir}\\`)) && dir.length > best.length) best = dir;
  }
  return best;
}

export function collectValueKeyDeclarations(
  path: string,
  xml: string,
  moduleDirs: readonly string[] = [],
): ValueKeyDeclaration[] {
  const meta = parseValuesPath(path);
  if (!meta) return [];

  // Offsets stay aligned: stripXmlComments blanks in place.
  const clean = stripXmlComments(xml);
  const starts = lineStartsOf(clean);
  const moduleDir = moduleDirOf(path, moduleDirs);
  const out: ValueKeyDeclaration[] = [];

  const stack: string[] = [];
  let i = 0;
  while (i < clean.length) {
    const lt = clean.indexOf('<', i);
    if (lt === -1) break;

    if (clean.startsWith('</', lt)) {
      const gt = clean.indexOf('>', lt);
      stack.pop();
      i = gt === -1 ? clean.length : gt + 1;
      continue;
    }

    const tag = readTag(clean, lt);
    if (!tag) { i = lt + 1; continue; }
    if ('skipTo' in tag) { i = tag.skipTo; continue; }

    // depth 0 is <resources> itself, so a direct child sits at depth 1.
    const depth = stack.length;
    const kind = kindOf(tag, depth, stack[stack.length - 1]);

    if (kind) {
      const end = tag.selfClosing ? tag.afterOpen : findCloseTag(clean, tag.name, tag.afterOpen);
      const name = tag.attrs.get('name')!;
      const pos = positionAt(starts, tag.nameValueAt);
      out.push({
        kind, name, path,
        qualifier: meta.qualifier,
        isBase: meta.isBase,
        moduleDir,
        start: tag.start,
        end,
        line: pos.line,
        character: pos.character,
        nameLength: name.length,
      });
      // The whole entry is consumed, so a nested <item> can never be mistaken
      // for a declaration and the stack cannot drift.
      i = end;
      continue;
    }

    if (!tag.selfClosing) stack.push(tag.name);
    i = tag.afterOpen;
  }

  return out;
}
