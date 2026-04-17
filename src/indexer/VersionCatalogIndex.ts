export interface CatalogEntry {
  group: string;
  name: string;
  version: string;
  alias: string;
}

export class VersionCatalogIndex {
  private entries = new Map<string, CatalogEntry>();

  reindexFile(content: string): void {
    this.entries.clear();
    const versions = new Map<string, string>();
    let section = '';

    for (const raw of content.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;

      const sectionM = /^\[([^\]]+)\]$/.exec(line);
      if (sectionM) { section = sectionM[1]; continue; }

      if (section === 'versions') {
        const m = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/.exec(line);
        if (m) versions.set(m[1], m[2]);
        continue;
      }

      if (section === 'libraries') {
        const aliasM = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
        if (!aliasM) continue;
        const alias = aliasM[1];
        const value = aliasM[2].trim();

        if (value.startsWith('{')) {
          const group = /\bgroup\s*=\s*"([^"]+)"/.exec(value)?.[1];
          const name  = /\bname\s*=\s*"([^"]+)"/.exec(value)?.[1];
          const vRef  = /\bversion\.ref\s*=\s*"([^"]+)"/.exec(value)?.[1];
          // Match `version = "..."` but not `version.ref = "..."`
          const vLit  = /(?<!\.)\bversion\s*=\s*"([^"]+)"/.exec(value)?.[1];
          if (group && name) {
            const version = vRef ? (versions.get(vRef) ?? vRef) : (vLit ?? '?');
            this.entries.set(alias, { group, name, version, alias });
          }
        } else {
          // "group:name:version" shorthand
          const m2 = /^"([^:]+):([^:]+):([^"]+)"/.exec(value);
          if (m2) this.entries.set(alias, { group: m2[1], name: m2[2], version: m2[3], alias });
        }
      }
    }
  }

  // accessor = part after "libs." e.g. "compose.ui" from "libs.compose.ui"
  // TOML hyphens become dots in accessors: alias "compose-ui" → accessor "compose.ui"
  getByAccessor(accessor: string): CatalogEntry | undefined {
    if (this.entries.has(accessor)) return this.entries.get(accessor);
    return this.entries.get(accessor.replace(/\./g, '-'));
  }
}
