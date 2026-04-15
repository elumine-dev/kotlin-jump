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

    const RE_PLURALS = /<plurals\s+name="([^"]+)"/g;
    while ((m = RE_PLURALS.exec(content))) {
      const line = content.slice(0, m.index).split('\n').length - 1;
      plurals.set(m[1], { value: '', uri, line });
    }

    const RE_ARRAY = /<string-array\s+name="([^"]+)"/g;
    while ((m = RE_ARRAY.exec(content))) {
      const line = content.slice(0, m.index).split('\n').length - 1;
      arrays.set(m[1], { value: '', uri, line });
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
