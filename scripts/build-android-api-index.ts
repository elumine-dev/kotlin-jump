/**
 * Pre-parses the Android SDK's `android.jar` into the method names each public
 * type declares (`bundled/android-api-<level>.json`), for G61.
 *
 *   npx tsx scripts/build-android-api-index.ts [~/Library/Android/sdk/platforms/android-36/android.jar]
 *
 * WHY. A member of a class whose ancestry leaves the corpus was never judged:
 * the framework type might declare the same name and call it. On LaPresse
 * that kept ~20 dead methods of custom views (`setOverlayColor` on an
 * `ImageButton` subclass) and every service implementing `ComponentCallbacks2`.
 * Knowing what `android.widget.LinearLayout` really declares answers the
 * question for the platform. AndroidX is deliberately absent: its versions
 * drift per project, and an unknown ancestor keeps the old, cautious answer.
 *
 * Format: `{ level, names: string[], types: { fqn: [super|null, interfaces[], nameIndexes[]] } }`.
 * Names are interned: 6222 types and 23302 distinct names fit in 1.2 MB, 281 KB
 * compressed in the VSIX. Only public and protected methods count: a private
 * one cannot be overridden. Committed next to the stdlib index, rebuilt by
 * hand when the platform level is bumped.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import StreamZip from 'node-stream-zip';

const ACC_PUBLIC = 0x0001;
const ACC_PROTECTED = 0x0004;

interface ClassInfo { access: number; self: string; sup: string | null; ifs: string[]; methods: string[] }

/** The few class-file fields this index needs: no attributes, no code. */
function readClass(b: Buffer): ClassInfo {
  let o = 8;
  const n = b.readUInt16BE(o); o += 2;
  const cp: (string | { i: number } | undefined)[] = new Array(n);
  for (let i = 1; i < n; i++) {
    const tag = b[o++];
    switch (tag) {
      case 1: { const len = b.readUInt16BE(o); cp[i] = b.toString('utf8', o + 2, o + 2 + len); o += 2 + len; break; }
      case 7: case 8: case 16: case 19: case 20: cp[i] = { i: b.readUInt16BE(o) }; o += 2; break;
      case 3: case 4: case 9: case 10: case 11: case 12: case 17: case 18: o += 4; break;
      case 5: case 6: o += 8; i++; break;
      case 15: o += 3; break;
      default: throw new Error(`constant pool tag ${tag}`);
    }
  }
  const cls = (idx: number) => idx === 0 ? null : cp[(cp[idx] as { i: number }).i] as string;
  const dotted = (s: string) => s.replace(/[/$]/g, '.');
  const access = b.readUInt16BE(o); o += 2;
  const self = cls(b.readUInt16BE(o))!; o += 2;
  const sup = cls(b.readUInt16BE(o)); o += 2;
  const ni = b.readUInt16BE(o); o += 2;
  const ifs: string[] = [];
  for (let k = 0; k < ni; k++) { ifs.push(dotted(cls(b.readUInt16BE(o))!)); o += 2; }
  const members = (collect: boolean): string[] => {
    const count = b.readUInt16BE(o); o += 2;
    const names: string[] = [];
    for (let k = 0; k < count; k++) {
      const acc = b.readUInt16BE(o);
      const name = cp[b.readUInt16BE(o + 2)] as string;
      o += 6;
      const attrs = b.readUInt16BE(o); o += 2;
      for (let a = 0; a < attrs; a++) o += 6 + b.readUInt32BE(o + 2);
      if (collect && (acc & (ACC_PUBLIC | ACC_PROTECTED)) && name !== '<init>' && name !== '<clinit>') names.push(name);
    }
    return names;
  };
  members(false);
  return { access, self: dotted(self), sup: sup ? dotted(sup) : null, ifs, methods: members(true) };
}

async function main(): Promise<void> {
  const jar = process.argv[2] ?? path.join(os.homedir(), 'Library/Android/sdk/platforms/android-36/android.jar');
  const level = /android-(\d+(?:\.\d+)?)/.exec(jar)?.[1] ?? 'unknown';
  const zip = new StreamZip.async({ file: jar });
  const entries = Object.values(await zip.entries()).filter(e => e.name.endsWith('.class'));
  const names = new Map<string, number>();
  const table: string[] = [];
  const types: Record<string, [string | null, string[], number[]]> = {};
  for (const e of entries) {
    const c = readClass(await zip.entryData(e.name));
    if (!(c.access & ACC_PUBLIC)) continue;
    const idx = [...new Set(c.methods)].map(m => {
      if (!names.has(m)) { names.set(m, table.length); table.push(m); }
      return names.get(m)!;
    });
    types[c.self] = [c.sup, c.ifs, idx];
  }
  await zip.close();
  const out = path.join(process.cwd(), 'bundled', `android-api-${level}.json`);
  fs.writeFileSync(out, JSON.stringify({ level, names: table, types }));
  console.log(`${Object.keys(types).length} types, ${table.length} names -> ${out}`);
}

main().catch(e => { console.error(e); process.exit(1); });
