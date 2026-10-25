/**
 * Rebuilds `src/data/agp-gradle-matrix.json` from the Android Gradle plugin
 * release notes.
 *
 *   npx vite-node scripts/refresh-agp-gradle-matrix.ts [--from=7.0] [--dry-run]
 *
 * There is no single table online: each `agp-M-m-0-release-notes` page carries
 * a Compatibility table whose Gradle row reads `Gradle <minimum> <default> To
 * learn more, see updating Gradle.` once the tags are stripped. The stable AGP
 * lines come from the Google Maven group index. A page without the row stops
 * the script and leaves the file untouched: a guessed minimum would make the
 * AGP rail lie, and the rail stays silent on a line it does not know.
 */
import * as fs from 'fs';
import * as path from 'path';

const GROUP_INDEX = 'https://dl.google.com/dl/android/maven2/com/android/tools/build/group-index.xml';
// `hl=en` and the Accept-Language header: without them the site picks a
// language from the client's region, and the row reads nothing like "Gradle".
const NOTES = (major: string, minor: string) => `https://developer.android.com/build/releases/agp-${major}-${minor}-0-release-notes?hl=en`;
const OUT = path.join(__dirname, '..', 'src', 'data', 'agp-gradle-matrix.json');

async function text(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': 'kotlin-jump-vscode-extension', 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** `major.minor` of every stable AGP release at or above `from`, ascending. */
export function agpLines(groupIndexXml: string, from: string): string[] {
  const versions = /<gradle versions="([^"]+)"/.exec(groupIndexXml)?.[1]?.split(',') ?? [];
  const [fromMajor, fromMinor] = from.split('.').map(Number);
  const lines = new Set<string>();
  for (const v of versions) {
    const m = /^(\d+)\.(\d+)\.\d+$/.exec(v);
    if (!m) continue;
    const major = Number(m[1]), minor = Number(m[2]);
    if (major < fromMajor || (major === fromMajor && minor < fromMinor)) continue;
    lines.add(`${major}.${minor}`);
  }
  return [...lines].sort((a, b) => {
    const [am, an] = a.split('.').map(Number), [bm, bn] = b.split('.').map(Number);
    return am - bm || an - bn;
  });
}

/** The Gradle minimum of a release notes page, or undefined when the row is missing. */
export function minimumGradleOf(html: string): string | undefined {
  const flat = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  // The 8.7 page wraps the cell texts in literal double quotes ("Gradle", "To learn more...").
  const m = /["“]?Gradle["”]?\s+(\d+(?:\.\d+)*)\s+(\d+(?:\.\d+)*)\s+["“]?To learn more, see updating Gradle/i.exec(flat);
  return m?.[1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const from = args.find(a => a.startsWith('--from='))?.slice('--from='.length) ?? '7.0';
  const dryRun = args.includes('--dry-run');

  const lines = agpLines(await text(GROUP_INDEX), from);
  console.log(`${lines.length} AGP line(s) from ${from}: ${lines.join(', ')}`);
  const minGradle: Record<string, string> = {};
  for (const line of lines) {
    const [major, minor] = line.split('.');
    const url = NOTES(major, minor);
    const min = minimumGradleOf(await text(url));
    if (!min) { console.error(`no Gradle row on ${url}; the matrix is left untouched`); process.exit(1); }
    minGradle[line] = min;
    console.log(`  AGP ${line} -> Gradle ${min}`);
  }
  const json = {
    asOf: new Date().toISOString().slice(0, 10),
    source: 'https://developer.android.com/build/releases/agp-<major>-<minor>-0-release-notes, Compatibility table, Gradle minimum',
    minGradle,
  };
  if (dryRun) { console.log(JSON.stringify(json, null, 2)); return; }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`written ${path.relative(process.cwd(), OUT)}`);
}

// Under vitest the pure helpers above are imported and the network must stay quiet.
if (!process.env.VITEST) {
  main().catch(e => { console.error(e); process.exit(1); });
}
