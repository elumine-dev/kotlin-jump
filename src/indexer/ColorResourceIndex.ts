interface UriLike { toString(): string; }

export interface ColorEntry {
  value: string;
  uri: UriLike;
  line: number;
}

export class ColorResourceIndex {
  private readonly files = new Map<string, Map<string, ColorEntry>>();

  reindexFile(uri: UriLike, content: string): void {
    const colors = new Map<string, ColorEntry>();
    const RE_COLOR = /<color\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/color>/g;
    let m: RegExpExecArray | null;
    while ((m = RE_COLOR.exec(content))) {
      const value = m[2].trim();
      const line  = content.slice(0, m.index).split('\n').length - 1;
      colors.set(m[1], { value, uri, line });
    }
    this.files.set(uri.toString(), colors);
  }

  removeFile(uri: UriLike): void {
    this.files.delete(uri.toString());
  }

  /** KJ-017 — toutes les définitions d'une couleur, tous fichiers confondus. */
  allDefinitions(key: string): ColorEntry[] {
    const out: ColorEntry[] = [];
    for (const map of this.files.values()) {
      const e = map.get(key);
      if (e) out.push(e);
    }
    return out;
  }

  getValue(key: string): ColorEntry | undefined {
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
