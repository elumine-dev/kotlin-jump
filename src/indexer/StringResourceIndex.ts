import { stripXmlComments } from '../util/xmlRefs';

interface UriLike { toString(): string; }

const NAME_ATTR_RE = /\bname\s*=\s*"([^"]+)"/;

/** Module root of a resource or source path: everything before `/src/`. */
export function moduleRootOfPath(p: string): string {
  // Index keys are URIs (`file:///P/app/...`), callers pass fsPaths (`/P/app/...`).
  const noScheme = p.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const i = noScheme.indexOf('/src/');
  return i === -1 ? noScheme : noScheme.slice(0, i);
}

interface StringEntry {
  value: string;
  uri: UriLike;
  line: number;
  // Plurals only: every `<item quantity="X">` collected from the block,
  // plus the quantity whose value populated `value` above. Android resolves
  // missing categories to `other` at runtime, so we mirror that priority —
  // but when even `other` is absent (the file is incomplete), we surface
  // the next available category instead of the empty string.
  quantities?: Map<string, string>;
  chosenQuantity?: string;
}

// Android resolution order when the runtime category isn't declared:
// `other` is the universal fallback. We extend that with `one` → `few`
// → `many` → `two` → `zero` so an incomplete file (no `other`) still
// produces a meaningful hover/fold instead of nothing.
const QUANTITY_PRIORITY = ['other', 'one', 'few', 'many', 'two', 'zero'] as const;

export class StringResourceIndex {
  private readonly files        = new Map<string, Map<string, StringEntry>>();
  private readonly pluralsFiles = new Map<string, Map<string, StringEntry>>();
  private readonly arraysFiles  = new Map<string, Map<string, StringEntry>>();

  reindexFile(uri: UriLike, rawContent: string): void {
    const strings  = new Map<string, StringEntry>();
    const plurals  = new Map<string, StringEntry>();
    const arrays   = new Map<string, StringEntry>();
    // A commented-out `<string name="old_title">` was indexed as real: hover
    // showed it, Go to Definition landed in the comment, and the "cannot
    // resolve" warning stayed silent on a key that does not compile.
    const content = stripXmlComments(rawContent);

    // `name` in any attribute position (`translatable="false" name="x"`),
    // self-closing `<string name="x"/>` and `<item type="string" name="x">`.
    const RE_STRING = /<string\b([^>]*?)(?:\/>|>([\s\S]*?)<\/string>)/g;
    let m: RegExpExecArray | null;
    while ((m = RE_STRING.exec(content))) {
      const name = NAME_ATTR_RE.exec(m[1])?.[1];
      if (!name) continue;
      const raw   = (m[2] ?? '').trim();
      const value = unescapeXml(stripCdata(raw));
      const line  = content.slice(0, m.index).split('\n').length - 1;
      strings.set(name, { value, uri, line });
    }
    const RE_ITEM_STRING = /<item\b([^>]*\btype\s*=\s*"string"[^>]*)>([\s\S]*?)<\/item>/g;
    while ((m = RE_ITEM_STRING.exec(content))) {
      const name = NAME_ATTR_RE.exec(m[1])?.[1];
      if (!name || strings.has(name)) continue;
      const line  = content.slice(0, m.index).split('\n').length - 1;
      strings.set(name, { value: unescapeXml(stripCdata(m[2].trim())), uri, line });
    }

    const RE_PLURALS = /<plurals\b([^>]*)>([\s\S]*?)<\/plurals>/g;
    const RE_PLURAL_ITEM = /<item\b([^>]*\bquantity\s*=\s*"([^"]+)"[^>]*)>([\s\S]*?)<\/item>/g;
    while ((m = RE_PLURALS.exec(content))) {
      const name  = NAME_ATTR_RE.exec(m[1])?.[1];
      if (!name) continue;
      const block = m[2];
      const line  = content.slice(0, m.index).split('\n').length - 1;
      const quantities = new Map<string, string>();
      RE_PLURAL_ITEM.lastIndex = 0;
      let qm: RegExpExecArray | null;
      while ((qm = RE_PLURAL_ITEM.exec(block))) {
        quantities.set(qm[2], unescapeXml(stripCdata(qm[3].trim())));
      }
      const chosen = QUANTITY_PRIORITY.find(q => quantities.has(q));
      const value  = chosen ? quantities.get(chosen)! : '';
      plurals.set(name, { value, uri, line, quantities, chosenQuantity: chosen });
    }

    const RE_ARRAY = /<string-array\b([^>]*)>([\s\S]*?)<\/string-array>/g;
    while ((m = RE_ARRAY.exec(content))) {
      const name  = NAME_ATTR_RE.exec(m[1])?.[1];
      if (!name) continue;
      const block = m[2];
      const line  = content.slice(0, m.index).split('\n').length - 1;
      const items: string[] = [];
      const RE_ITEM = /<item[^>]*>([\s\S]*?)<\/item>/g;
      let im: RegExpExecArray | null;
      while ((im = RE_ITEM.exec(block))) {
        items.push(unescapeXml(stripCdata(im[1].trim())));
      }
      arrays.set(name, { value: items.length > 0 ? `[${items.join(', ')}]` : '', uri, line });
    }

    const key = uri.toString();
    this.files.set(key, strings);
    this.pluralsFiles.set(key, plurals);
    this.arraysFiles.set(key, arrays);
  }

  removeFile(uri: UriLike): void {
    const key = uri.toString();
    this.files.delete(key);
    this.pluralsFiles.delete(key);
    this.arraysFiles.delete(key);
  }

  /** KJ-017 — toutes les définitions d'une string, tous fichiers confondus. */
  allDefinitions(key: string): StringEntry[] {
    const out: StringEntry[] = [];
    for (const map of this.files.values()) {
      const e = map.get(key);
      if (e) out.push(e);
    }
    return out;
  }

  /** KJ-005 — toutes les clés string connues, toutes locales confondues. */
  allKeys(): string[] {
    const keys = new Set<string>();
    for (const m of this.files.values()) {
      for (const k of m.keys()) keys.add(k);
    }
    return [...keys];
  }

  /** KJ-005 — URIs des strings.xml de base (dossier `values` non qualifié).
   *  Un fichier de base encore vide n'est pas listé (aucune entrée pour en
   *  récupérer l'URI — limitation documentée). */
  baseFiles(): UriLike[] {
    const out: UriLike[] = [];
    for (const [key, entries] of this.files) {
      if (!/[\\/]values[\\/][^\\/]*\.xml$/.test(key)) continue;
      const first = entries.values().next().value;
      if (first) out.push(first.uri);
    }
    return out;
  }

  /** `nearPath`: the file referencing the key; its own module's definition wins. */
  getValue(key: string, nearPath?: string): StringEntry | undefined {
    return this.lookupIn(this.files, key, nearPath);
  }

  getPluralsValue(key: string, nearPath?: string): StringEntry | undefined {
    return this.lookupIn(this.pluralsFiles, key, nearPath);
  }

  getArrayValue(key: string, nearPath?: string): StringEntry | undefined {
    return this.lookupIn(this.arraysFiles, key, nearPath);
  }

  // Returns all locale entries for a given string key (Feature 6 — translation completeness).
  // Key: locale qualifier like "values", "values-en", "values-fr".
  getLocaleEntries(key: string): Map<string, StringEntry> {
    const result = new Map<string, StringEntry>();
    for (const [fUri, map] of this.files) {
      const e = map.get(key);
      if (e) result.set(extractLocaleQualifier(fUri), e);
    }
    return result;
  }

  // Returns all locale qualifiers present in the index.
  getKnownLocales(): string[] {
    const locales = new Set<string>();
    for (const [fUri, strings] of this.files) {
      // values-night, values-v23, values-sw600dp, values-land are not
      // locales: they showed up in the hover grid with a ✗, as if a
      // translation were missing. A values-fr with no <string> at all
      // (dimens only) is not a translation either.
      const q = extractLocaleQualifier(fUri);
      if (!isLocaleQualifier(q)) continue;
      if (strings.size === 0 && q !== 'values') continue;
      locales.add(q);
    }
    return [...locales].sort();
  }

  private lookupIn(store: Map<string, Map<string, StringEntry>>, key: string, nearPath?: string): StringEntry | undefined {
    // Default locale (/values/) takes priority over qualifiers (/values-fr/
    // etc.), and the referencing file's own module over another module's:
    // with `error_generic` in app and core:ui, the first module indexed won.
    const nearModule = nearPath ? moduleRootOfPath(nearPath) : undefined;
    let best: StringEntry | undefined;
    let bestScore = -1;
    for (const [fUri, map] of store) {
      const e = map.get(key);
      if (!e) continue;
      const score = (nearModule !== undefined && moduleRootOfPath(fUri) === nearModule ? 2 : 0)
        + (/\/values\/[^/]+$/.test(fUri) ? 1 : 0);
      if (score > bestScore) { best = e; bestScore = score; }
    }
    return best;
  }
}

/** `values`, `values-fr`, `values-fr-rCA`, `values-b+sr+Latn`; nothing else. */
export function isLocaleQualifier(q: string): boolean {
  return /^values(?:-(?:[a-z]{2,3}(?:-r[A-Z]{2})?|b\+[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*))?$/.test(q);
}

function extractLocaleQualifier(uriStr: string): string {
  const m = /\/res\/(values(?:-[^/]+)?)\/[^/]+$/.exec(uriStr);
  return m ? m[1] : 'values';
}

function stripCdata(s: string): string {
  const m = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(s.trim());
  return m ? m[1] : s;
}

// XML entities, numeric ones included, then the escapes Android strips at
// build time (`Don\'t`, `\n`, `\@`): the hover showed them raw.
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/\\([\\'"@?])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t');
}
