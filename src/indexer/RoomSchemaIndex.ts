import { splitTopLevelArguments } from '../providers/NamedArgumentsActionProvider';

/**
 * KJ-020 — Room Migration Drift : cross-checks the @Entity classes, the
 * @Database versions and the Migration(from, to) calls to catch fields with
 * no migration and holes in the chain BEFORE the crash in production.
 *
 * Baseline heuristic: fields declared BEFORE the first field covered by a
 * migration are treated as v1 (Room schemas grow by appending at the end of
 * the class). With no field migration at all, nothing is flagged.
 *
 * The analysis is clustered per @Database. Two unrelated databases can each
 * declare an entity with the same class name (real case: two `Ad` tables in
 * separate modules); merging them by name made one database inherit the
 * other's migration baseline and produced false "missing migration" flags.
 * Each entity declaration is matched to the database that claims its class
 * in `entities = [...]` (nearest by path when several claim the same name),
 * and migrations are scoped through `.addMigrations(...)` builder chains,
 * falling back to same-file / same-directory proximity.
 */

export interface EntityField {
  entity: string;
  field: string;
  columnName: string;
  isPrimaryKey: boolean;
  hasDefault: boolean;
}

export interface RoomAnalysis {
  missingFieldMigrations: { entity: string; field: string; fileIndex: number }[];
  migrationGaps: { from: number; to: number; fileIndex: number }[];
  coveredFields: string[];
}

export type RoomFileInput = string | { path?: string; text: string };

interface EntityDecl {
  entity: string;
  fields: EntityField[];
  fileIndex: number;
}

interface MigrationSpan {
  from: number;
  to: number;
  addedColumns: string[];
  name: string | undefined;
  fileIndex: number;
}

interface DatabaseDecl {
  className: string | undefined;
  version: number;
  autoMigrations: { from: number; to: number }[];
  entityNames: string[];
  fileIndex: number;
}

interface BuilderChain {
  dbClass: string | undefined;
  migrationNames: string[];
  destructive: boolean;
}

/** Blanks out // and block comments: a "Migration(2, 3)" quoted in a comment
 *  must never count as a real migration. Strings are preserved. */
function stripComments(text: string): string {
  const out: string[] = [];
  let mode: 'code' | 'line' | 'block' | 'string' = 'code';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const two = text.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; out.push('  '); i++; continue; }
      if (two === '/*') { mode = 'block'; out.push('  '); i++; continue; }
      if (ch === '"') mode = 'string';
      out.push(ch);
    } else if (mode === 'line') {
      if (ch === '\n') { mode = 'code'; out.push('\n'); } else out.push(' ');
    } else if (mode === 'block') {
      if (two === '*/') { mode = 'code'; out.push('  '); i++; continue; }
      out.push(ch === '\n' ? '\n' : ' ');
    } else {
      if (ch === '\\') { out.push(text.slice(i, i + 2)); i++; continue; }
      if (ch === '"' || ch === '\n') mode = 'code';
      out.push(ch);
    }
  }
  return out.join('');
}

/** Index of the ')' closing the '(' at openIndex, or -1. */
function closingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseEntities(text: string, fileIndex: number): EntityDecl[] {
  const decls: EntityDecl[] = [];
  const entityRe = /@Entity(?:\s*\([^)]*\))?\s*(?:data\s+)?class\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = entityRe.exec(text)) !== null) {
    const entity = m[1];
    const open = m.index + m[0].length - 1;
    const close = closingParen(text, open);
    if (close < 0) continue;

    const fields: EntityField[] = [];
    for (const param of splitTopLevelArguments(text.slice(open + 1, close))) {
      const fieldM = /va[lr]\s+(\w+)\s*:/.exec(param);
      if (!fieldM) continue;
      const field = fieldM[1];
      const columnM = /@ColumnInfo\s*\(([^)]*)\)/.exec(param);
      const nameM = columnM ? /name\s*=\s*"([^"]+)"/.exec(columnM[1]) : null;
      fields.push({
        entity,
        field,
        columnName: nameM?.[1] ?? field,
        isPrimaryKey: /@PrimaryKey\b/.test(param),
        hasDefault: columnM ? /defaultValue\s*=/.test(columnM[1]) : false,
      });
    }
    decls.push({ entity, fields, fileIndex });
  }
  return decls;
}

/** Name binding right before a `Migration(` match: `val M = object : Migration`,
 *  `object M : Migration` or `class M : Migration`. Used to resolve which
 *  database consumes the migration via `.addMigrations(M)`. */
function migrationName(before: string): string | undefined {
  const bound =
    /(?:val|var)\s+(\w+)\s*=\s*object\s*:\s*(?:[\w.]+\.)?\s*$/.exec(before) ??
    /(?:class|object)\s+(\w+)\s*(?:\([^)]*\))?\s*:\s*(?:[\w.]+\.)?\s*$/.exec(before);
  return bound?.[1];
}

function parseMigrations(text: string, fileIndex: number): MigrationSpan[] {
  const out: MigrationSpan[] = [];
  const re = /(?<!\w)Migration\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Real body via balanced braces (string-aware). A fixed window missed the
    // ADD COLUMN of large SQL blocks and bled into neighbouring migrations.
    const braceOpen = text.indexOf('{', m.index + m[0].length);
    let body = '';
    if (braceOpen >= 0) {
      let depth = 0;
      let inString = false;
      for (let i = braceOpen; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
          if (ch === '\\') { i++; continue; }
          if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            body = text.slice(braceOpen, i + 1);
            break;
          }
        }
      }
    }
    out.push({
      from: Number(m[1]),
      to: Number(m[2]),
      addedColumns: [...body.matchAll(/ADD\s+COLUMN\s+[`"]?(\w+)/gi)].map(a => a[1]),
      name: migrationName(text.slice(Math.max(0, m.index - 160), m.index)),
      fileIndex,
    });
  }
  return out;
}

function parseDatabases(text: string, fileIndex: number): DatabaseDecl[] {
  const out: DatabaseDecl[] = [];
  const re = /@Database\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closingParen(text, open);
    if (close < 0) continue;
    const header = text.slice(open, close + 1);
    const versionM = /version\s*=\s*(\d+)/.exec(header);
    if (!versionM) continue;
    const entitiesM = /entities\s*=\s*\[([^\]]*)\]/.exec(header);
    const clsM = /^(?:\s*@\w+(?:\s*\([^)]*\))?)*\s*(?:(?:public|internal|abstract|open|sealed)\s+)*class\s+(\w+)/.exec(
      text.slice(close + 1),
    );
    out.push({
      className: clsM?.[1],
      version: Number(versionM[1]),
      autoMigrations: [...header.matchAll(/AutoMigration\s*\(\s*from\s*=\s*(\d+)\s*,\s*to\s*=\s*(\d+)\s*\)/g)]
        .map(a => ({ from: Number(a[1]), to: Number(a[2]) })),
      entityNames: entitiesM ? [...entitiesM[1].matchAll(/(\w+)\s*::\s*class/g)].map(a => a[1]) : [],
      fileIndex,
    });
  }
  return out;
}

function parseBuilderChains(text: string): BuilderChain[] {
  const out: BuilderChain[] = [];
  const re = /\b(?:databaseBuilder|inMemoryDatabaseBuilder)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closingParen(text, open);
    if (close < 0) continue;
    const chain: BuilderChain = {
      dbClass: /(\w+)\s*::\s*class/.exec(text.slice(open + 1, close))?.[1],
      migrationNames: [],
      destructive: false,
    };
    let i = close + 1;
    for (;;) {
      const method = /^\s*\.\s*(\w+)/.exec(text.slice(i));
      if (!method) break;
      i += method[0].length;
      let args = '';
      if (/^\s*\(/.test(text.slice(i))) {
        const argOpen = text.indexOf('(', i);
        const argClose = closingParen(text, argOpen);
        if (argClose < 0) break;
        args = text.slice(argOpen + 1, argClose);
        i = argClose + 1;
      }
      if (/^addMigrations?$/.test(method[1])) {
        // `Migrations.M12` style references resolve to their last segment.
        chain.migrationNames.push(...[...args.matchAll(/[\w.]+/g)].map(a => a[0].split('.').pop()!));
      }
      // OnDowngrade only destroys on downgrade: upgrades still need the
      // migrations, so it must not silence the diagnostics.
      if (method[1] === 'fallbackToDestructiveMigration' || method[1] === 'fallbackToDestructiveMigrationFrom') {
        chain.destructive = true;
      }
    }
    out.push(chain);
  }
  return out;
}

function commonSegments(a: string, b: string): number {
  const as = a.split(/[\\/]/);
  const bs = b.split(/[\\/]/);
  let n = 0;
  while (n < as.length && n < bs.length && as[n] === bs[n]) n++;
  return n;
}

export function analyzeRoomSchema(inputs: RoomFileInput[]): RoomAnalysis {
  const files = inputs.map((input, index) => {
    const path = typeof input === 'string' ? undefined : input.path;
    return {
      index,
      path,
      dir: path?.replace(/[\\/][^\\/]*$/, ''),
      text: stripComments(typeof input === 'string' ? input : input.text),
    };
  });

  const entityDecls = files.flatMap(f => parseEntities(f.text, f.index));
  const migrations = files.flatMap(f => parseMigrations(f.text, f.index));
  const dbs = files.flatMap(f => parseDatabases(f.text, f.index));
  const chains = files.flatMap(f => parseBuilderChains(f.text));

  // fallbackToDestructiveMigration: the app accepts data loss, so every
  // migration diagnostic for that database would be noise. A destructive
  // builder whose database class cannot be resolved silences everything.
  const destructiveDbs = new Set<string>();
  let globalDestructive = false;
  for (const chain of chains) {
    if (!chain.destructive) continue;
    if (chain.dbClass) destructiveDbs.add(chain.dbClass);
    else globalDestructive = true;
  }
  if (destructiveDbs.size === 0 && !globalDestructive) {
    // Safety net for call shapes the chain parser cannot follow.
    globalDestructive = files.some(f => /fallbackToDestructiveMigration(?!OnDowngrade)/.test(f.text));
  }
  if (globalDestructive) {
    return { missingFieldMigrations: [], migrationGaps: [], coveredFields: [] };
  }

  // Migration name → owning database class, through the builder chains.
  const nameToDb = new Map<string, string | null>();
  for (const chain of chains) {
    if (!chain.dbClass) continue;
    for (const name of chain.migrationNames) {
      const known = nameToDb.get(name);
      nameToDb.set(name, known === undefined || known === chain.dbClass ? chain.dbClass : null);
    }
  }

  // Nearest claimant wins when several databases list the same entity name.
  const nearestDb = (fileIndex: number, candidates: DatabaseDecl[]): DatabaseDecl => {
    const sameFile = candidates.find(db => db.fileIndex === fileIndex);
    if (sameFile) return sameFile;
    const path = files[fileIndex].path;
    let best = candidates[0];
    let bestScore = -1;
    for (const db of candidates) {
      const dbPath = files[db.fileIndex].path;
      const score = path !== undefined && dbPath !== undefined
        ? commonSegments(path, dbPath)
        : -Math.abs(db.fileIndex - fileIndex);
      if (score > bestScore) { best = db; bestScore = score; }
    }
    return best;
  };

  const declsByDb = new Map<DatabaseDecl, EntityDecl[]>(dbs.map(db => [db, []]));
  const orphanDecls: EntityDecl[] = [];
  for (const decl of entityDecls) {
    const claimants = dbs.filter(db => db.entityNames.includes(decl.entity));
    if (claimants.length === 0) orphanDecls.push(decl);
    else declsByDb.get(claimants.length === 1 ? claimants[0] : nearestDb(decl.fileIndex, claimants))!.push(decl);
  }

  // A migration not attributable to any database counts for all of them:
  // wrongly withholding one would fabricate gaps and missing-field flags.
  const migrationsByDb = new Map<DatabaseDecl, MigrationSpan[]>(dbs.map(db => [db, []]));
  const sharedMigrations: MigrationSpan[] = [];
  for (const mig of migrations) {
    const linked = mig.name !== undefined ? nameToDb.get(mig.name) : undefined;
    let owner = linked ? dbs.find(db => db.className === linked) : undefined;
    if (!owner) {
      const sameFile = dbs.filter(db => db.fileIndex === mig.fileIndex);
      if (sameFile.length === 1) owner = sameFile[0];
      else if (sameFile.length === 0 && dbs.length === 1) owner = dbs[0];
      else if (sameFile.length === 0) {
        const dir = files[mig.fileIndex].dir;
        const sameDir = dir === undefined ? [] : dbs.filter(db => files[db.fileIndex].dir === dir);
        if (sameDir.length === 1) owner = sameDir[0];
      }
    }
    if (owner) migrationsByDb.get(owner)!.push(mig);
    else sharedMigrations.push(mig);
  }

  const missingFieldMigrations: RoomAnalysis['missingFieldMigrations'] = [];
  const coveredFields: string[] = [];
  const analyzeCluster = (decls: EntityDecl[], clusterMigrations: MigrationSpan[]) => {
    const addedColumns = new Set(
      clusterMigrations.flatMap(m => m.addedColumns).map(c => c.toLowerCase()),
    );
    for (const decl of decls) {
      const isCovered = (f: EntityField) =>
        addedColumns.has(f.columnName.toLowerCase()) || addedColumns.has(f.field.toLowerCase());
      for (const f of decl.fields) if (isCovered(f)) coveredFields.push(f.field);

      // Baseline per declaration: everything before the first covered field.
      const firstCovered = decl.fields.findIndex(isCovered);
      if (firstCovered < 0) continue; // no migration signal at all: stay silent
      for (let i = firstCovered + 1; i < decl.fields.length; i++) {
        const f = decl.fields[i];
        if (f.isPrimaryKey || f.hasDefault || isCovered(f)) continue;
        missingFieldMigrations.push({ entity: decl.entity, field: f.field, fileIndex: decl.fileIndex });
      }
    }
  };

  for (const db of dbs) {
    if (db.className !== undefined && destructiveDbs.has(db.className)) continue;
    analyzeCluster(declsByDb.get(db)!, [...migrationsByDb.get(db)!, ...sharedMigrations]);
  }
  analyzeCluster(orphanDecls, dbs.length === 0 ? migrations : sharedMigrations);

  // Holes in the 1 → version chain, per database.
  const migrationGaps: RoomAnalysis['migrationGaps'] = [];
  for (const db of dbs) {
    if (db.className !== undefined && destructiveDbs.has(db.className)) continue;
    const ranges = [
      ...[...migrationsByDb.get(db)!, ...sharedMigrations].map(m => ({ from: m.from, to: m.to })),
      ...db.autoMigrations,
    ];
    for (let step = 1; step < db.version; step++) {
      const covered = ranges.some(r => r.from <= step && r.to >= step + 1);
      if (!covered) migrationGaps.push({ from: step, to: step + 1, fileIndex: db.fileIndex });
    }
  }

  return { missingFieldMigrations, migrationGaps, coveredFields };
}
