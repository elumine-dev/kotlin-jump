import { splitTopLevelArguments } from '../providers/NamedArgumentsActionProvider';

/**
 * KJ-020 — Room Migration Drift : cross-checks the @Entity classes, the
 * @Database version and the Migration(from, to) calls to catch fields with
 * no migration and holes in the chain BEFORE the crash in production.
 *
 * Baseline heuristic: fields declared BEFORE the first field covered by a
 * migration are treated as v1 (Room schemas grow by appending at the end of
 * the class). With no field migration at all, nothing is flagged.
 */

export interface EntityField {
  entity: string;
  field: string;
  columnName: string;
  isPrimaryKey: boolean;
  hasDefault: boolean;
}

export interface RoomAnalysis {
  missingFieldMigrations: { entity: string; field: string }[];
  migrationGaps: { from: number; to: number }[];
  coveredFields: string[];
}

function parseEntities(text: string): EntityField[] {
  const fields: EntityField[] = [];
  const entityRe = /@Entity(?:\s*\(([^)]*)\))?\s*(?:data\s+)?class\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = entityRe.exec(text)) !== null) {
    const entity = m[2];
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close < 0) continue;

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
  }
  return fields;
}

interface MigrationSpan {
  from: number;
  to: number;
  addedColumns: string[];
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

function parseMigrations(text: string): MigrationSpan[] {
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
    const added = [...body.matchAll(/ADD\s+COLUMN\s+[`"]?(\w+)/gi)].map(a => a[1]);
    out.push({ from: Number(m[1]), to: Number(m[2]), addedColumns: added });
  }
  return out;
}

function parseDatabase(text: string): { version: number; autoMigrations: { from: number; to: number }[] } | null {
  const dbM = /@Database\s*\(/.exec(text);
  if (!dbM) return null;
  const open = dbM.index + dbM[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  const header = text.slice(open, close + 1);
  const versionM = /version\s*=\s*(\d+)/.exec(header);
  const autos = [...header.matchAll(/AutoMigration\s*\(\s*from\s*=\s*(\d+)\s*,\s*to\s*=\s*(\d+)\s*\)/g)]
    .map(a => ({ from: Number(a[1]), to: Number(a[2]) }));
  return versionM ? { version: Number(versionM[1]), autoMigrations: autos } : null;
}

export function analyzeRoomSchema(files: string[]): RoomAnalysis {
  const all = stripComments(files.join('\n\n'));

  // fallbackToDestructiveMigration: the app accepts data loss, so every
  // migration diagnostic would be noise.
  if (/fallbackToDestructiveMigration/.test(all)) {
    return { missingFieldMigrations: [], migrationGaps: [], coveredFields: [] };
  }
  const fields = parseEntities(all);
  const migrations = parseMigrations(all);
  const db = parseDatabase(all);

  const addedColumns = new Set(
    migrations.flatMap(m => m.addedColumns).map(c => c.toLowerCase()),
  );

  const coveredFields = fields
    .filter(f => addedColumns.has(f.columnName.toLowerCase()) || addedColumns.has(f.field.toLowerCase()))
    .map(f => f.field);

  // Baseline per entity: everything before the first covered field.
  const missingFieldMigrations: { entity: string; field: string }[] = [];
  const byEntity = new Map<string, EntityField[]>();
  for (const f of fields) {
    if (!byEntity.has(f.entity)) byEntity.set(f.entity, []);
    byEntity.get(f.entity)!.push(f);
  }
  for (const [entity, list] of byEntity) {
    const firstCovered = list.findIndex(f => coveredFields.includes(f.field));
    if (firstCovered < 0) continue; // no migration signal at all: stay silent
    for (let i = firstCovered + 1; i < list.length; i++) {
      const f = list[i];
      if (f.isPrimaryKey || f.hasDefault || coveredFields.includes(f.field)) continue;
      missingFieldMigrations.push({ entity, field: f.field });
    }
  }

  // Holes in the 1 → version chain.
  const migrationGaps: { from: number; to: number }[] = [];
  if (db) {
    const ranges = [
      ...migrations.map(m => ({ from: m.from, to: m.to })),
      ...db.autoMigrations,
    ];
    for (let step = 1; step < db.version; step++) {
      const covered = ranges.some(r => r.from <= step && r.to >= step + 1);
      if (!covered) migrationGaps.push({ from: step, to: step + 1 });
    }
  }

  return { missingFieldMigrations, migrationGaps, coveredFields };
}
