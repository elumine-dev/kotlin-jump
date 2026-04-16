interface UriLike { toString(): string; }

interface StringEntry {
  value: string;
  uri: UriLike;
  line: number;
}

export class StringResourceIndex {
  private readonly files        = new Map<string, Map<string, StringEntry>>();
  private readonly pluralsFiles = new Map<string, Map<string, StringEntry>>();
  private readonly arraysFiles  = new Map<string, Map<string, StringEntry>>();

  reindexFile(uri: UriLike, content: string): void {
    const strings  = new Map<string, StringEntry>();
    const plurals  = new Map<string, StringEntry>();
    const arrays   = new Map<string, StringEntry>();

    const RE_STRING = /<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g;
    let m: RegExpExecArray | null;
    while ((m = RE_STRING.exec(content))) {
      const raw   = m[2].trim();
      const value = unescapeXml(stripCdata(raw));
      const line  = content.slice(0, m.index).split('\n').length - 1;
      strings.set(m[1], { value, uri, line });
    }

    const RE_PLURALS = /<plurals\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/plurals>/g;
    while ((m = RE_PLURALS.exec(content))) {
      const name  = m[1];
      const block = m[2];
      const line  = content.slice(0, m.index).split('\n').length - 1;
      const itemM = /<item\s+quantity="other"[^>]*>([\s\S]*?)<\/item>/.exec(block);
      const value = itemM ? unescapeXml(stripCdata(itemM[1].trim())) : '';
      plurals.set(name, { value, uri, line });
    }

    const RE_ARRAY = /<string-array\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string-array>/g;
    while ((m = RE_ARRAY.exec(content))) {
      const name  = m[1];
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

  getValue(key: string): StringEntry | undefined {
    return this.lookupIn(this.files, key);
  }

  getPluralsValue(key: string): StringEntry | undefined {
    return this.lookupIn(this.pluralsFiles, key);
  }

  getArrayValue(key: string): StringEntry | undefined {
    return this.lookupIn(this.arraysFiles, key);
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
    for (const fUri of this.files.keys()) {
      locales.add(extractLocaleQualifier(fUri));
    }
    return [...locales].sort();
  }

  private lookupIn(store: Map<string, Map<string, StringEntry>>, key: string): StringEntry | undefined {
    // Default locale (/values/) takes priority over qualifiers (/values-fr/ etc.)
    for (const [fUri, map] of store) {
      if (/\/values\/[^/]+$/.test(fUri)) {
        const e = map.get(key);
        if (e) return e;
      }
    }
    for (const [, map] of store) {
      const e = map.get(key);
      if (e) return e;
    }
    return undefined;
  }
}

function extractLocaleQualifier(uriStr: string): string {
  const m = /\/res\/(values(?:-[^/]+)?)\/[^/]+$/.exec(uriStr);
  return m ? m[1] : 'values';
}

function stripCdata(s: string): string {
  const m = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(s.trim());
  return m ? m[1] : s;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
