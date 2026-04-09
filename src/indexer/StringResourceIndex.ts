interface UriLike { toString(): string; }

interface StringEntry {
  value: string;
  uri: UriLike;
  line: number;
}

export class StringResourceIndex {
  private readonly files = new Map<string, Map<string, StringEntry>>();

  reindexFile(uri: UriLike, content: string): void {
    const map = new Map<string, StringEntry>();
    const RE = /<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(content))) {
      const raw   = m[2].trim();
      const value = unescapeXml(stripCdata(raw));
      const line  = content.slice(0, m.index).split('\n').length - 1;
      map.set(m[1], { value, uri, line });
    }
    this.files.set(uri.toString(), map);
  }

  removeFile(uri: UriLike): void {
    this.files.delete(uri.toString());
  }

  getValue(key: string): StringEntry | undefined {
    // Default locale (/values/) takes priority over qualifiers (/values-fr/ etc.)
    for (const [fUri, map] of this.files) {
      if (/\/values\/[^/]+$/.test(fUri)) {
        const e = map.get(key);
        if (e) return e;
      }
    }
    for (const [, map] of this.files) {
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
