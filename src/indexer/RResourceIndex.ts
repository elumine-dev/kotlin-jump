export interface RUsageEntry {
  uri:       string;
  line:      number;
  character: number;
}

const R_RE = /\bR\.(string|plurals|array)\.([A-Za-z_]\w*)\b/g;

export class RResourceIndex {
  private readonly string  = new Map<string, RUsageEntry[]>();
  private readonly plurals = new Map<string, RUsageEntry[]>();
  private readonly array   = new Map<string, RUsageEntry[]>();

  // Tracks which (type, key) pairs each file contributes — needed for clean removal
  private readonly byFile  = new Map<string, Array<{ type: 'string' | 'plurals' | 'array'; key: string }>>();

  reindexFile(uri: string, content: string): void {
    this.removeFile(uri); // idempotent — clears previous state for this file

    const contributed: Array<{ type: 'string' | 'plurals' | 'array'; key: string }> = [];
    const lines = content.split('\n');
    for (let ln = 0; ln < lines.length; ln++) {
      R_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = R_RE.exec(lines[ln]))) {
        const type = m[1] as 'string' | 'plurals' | 'array';
        const key  = m[2];
        if (!this[type].has(key)) this[type].set(key, []);
        this[type].get(key)!.push({ uri, line: ln, character: m.index });
        contributed.push({ type, key });
      }
    }
    if (contributed.length > 0) this.byFile.set(uri, contributed);
  }

  removeFile(uri: string): void {
    const contrib = this.byFile.get(uri);
    if (!contrib) return;
    for (const { type, key } of contrib) {
      const arr  = this[type].get(key);
      const next = arr?.filter(e => e.uri !== uri) ?? [];
      if (next.length) this[type].set(key, next);
      else             this[type].delete(key);
    }
    this.byFile.delete(uri);
  }

  getUsages(type: 'string' | 'plurals' | 'array', key: string): RUsageEntry[] {
    return this[type].get(key) ?? [];
  }
}
