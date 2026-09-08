import { stripXmlComments } from '../util/xmlRefs';
import { moduleRootOfPath } from './StringResourceIndex';
interface UriLike { toString(): string; }

export interface ColorEntry {
  value: string;
  uri: UriLike;
  line: number;
}

export class ColorResourceIndex {
  private readonly files = new Map<string, Map<string, ColorEntry>>();

  reindexFile(uri: UriLike, rawContent: string): void {
    const colors = new Map<string, ColorEntry>();
    const content = stripXmlComments(rawContent);
    const RE_COLOR = /<color\b([^>]*)>([\s\S]*?)<\/color>/g;
    let m: RegExpExecArray | null;
    while ((m = RE_COLOR.exec(content))) {
      const name = /\bname\s*=\s*"([^"]+)"/.exec(m[1])?.[1];
      if (!name) continue;
      const value = m[2].trim();
      const line  = content.slice(0, m.index).split('\n').length - 1;
      colors.set(name, { value, uri, line });
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

  getValue(key: string, nearPath?: string): ColorEntry | undefined {
    const nearModule = nearPath ? moduleRootOfPath(nearPath) : undefined;
    let best: ColorEntry | undefined;
    let bestScore = -1;
    for (const [fUri, map] of this.files) {
      const e = map.get(key);
      if (!e) continue;
      const fModule = moduleRootOfPath(fUri);
      const score = (nearModule !== undefined && fModule === nearModule ? 2 : 0) + (/\/values\/[^/]+$/.test(fUri) ? 1 : 0);
      if (score > bestScore) { best = e; bestScore = score; }
    }
    return best;
  }
}
