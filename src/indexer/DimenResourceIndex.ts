interface UriLike { toString(): string; }

export interface DimenEntry {
  value: string;
  uri: UriLike;
  line: number;
}

/**
 * Scans `values{qualifier}/dimens.xml` files for
 * `<dimen name="x">value</dimen>` entries. Mirrors `ColorResourceIndex`
 * shape so the companion provider (`DimenResourceDefinitionProvider`)
 * can navigate from `R.dimen.spacing_md` to the matching XML entry.
 */
export class DimenResourceIndex {
  private readonly files = new Map<string, Map<string, DimenEntry>>();

  reindexFile(uri: UriLike, content: string): void {
    const dims = new Map<string, DimenEntry>();
    const RE = /<dimen\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/dimen>/g;
    let m: RegExpExecArray | null;
    while ((m = RE.exec(content))) {
      const value = m[2].trim();
      const line  = content.slice(0, m.index).split('\n').length - 1;
      dims.set(m[1], { value, uri, line });
    }
    this.files.set(uri.toString(), dims);
  }

  removeFile(uri: UriLike): void {
    this.files.delete(uri.toString());
  }

  getValue(key: string): DimenEntry | undefined {
    // Default-locale folder first (`values/`) then any qualified folders.
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
