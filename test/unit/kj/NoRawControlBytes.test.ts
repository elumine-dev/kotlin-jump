/**
 * A raw control byte in a source file makes git stop reading it.
 *
 * Git decides whether a blob is binary by looking for a NUL in its first 8 000
 * bytes. `FindUnheardEvents.ts` carried one at offset 5 768, written as a raw
 * byte rather than an escape, so both of its deliveries showed up as
 * `1 file changed, 0 insertions(+), 0 deletions(-)`. Nobody could review them,
 * and neither could the adversarial pass that reads `git show` on every tag.
 *
 * Two more sources carried the same byte a hair outside the window, at 8 021
 * and 8 986. Any edit that trims a few lines above them flips those files too.
 *
 * The character itself is legitimate: it makes a composite map key that cannot
 * collide, a glob placeholder the next pass cannot rewrite, a prefix no fully
 * qualified name starts with. It just has to be written `\u0000`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT } from './harness';

// `.github/scripts` holds the release tooling, which runs on every publish:
// a byte hidden there would be as invisible as one in a provider. The list
// named `media/whatsnew`, which does not exist, so it guarded nothing.
const ROOTS = ['src', 'test', 'scripts', 'media/logcat', '.github/scripts'];
const SOURCE = /\.(ts|mts|cts|js|mjs)$/;
/** Everything below space except tab, newline and carriage return. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

function walk(dir: string, out: string[]): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE.test(name)) out.push(full);
  }
  return out;
}

describe('Sources stay plain text', () => {
  it('no source file carries a raw control byte', () => {
    const coupables: string[] = [];
    let lus = 0;
    for (const root of ROOTS) {
      for (const file of walk(path.join(REPO_ROOT, root), [])) {
        lus++;
        const text = readFileSync(file, 'utf8');
        const at = text.search(CONTROL);
        if (at < 0) continue;
        const line = text.slice(0, at).split('\n').length;
        coupables.push(
          `${path.relative(REPO_ROOT, file)}:${line} (U+${text.charCodeAt(at)
            .toString(16).padStart(4, '0').toUpperCase()})`,
        );
      }
    }
    // 817 fichiers aujourd hui. Le seuil protege contre une racine renommee
    // qui ferait rendre zero au balayage, il ne suit pas la taille du depot.
    expect(lus, 'le balayage doit voir des fichiers, sinon il ne prouve rien').toBeGreaterThan(600);
    expect(coupables, 'ecrire le caractere en echappement, par exemple \\u0000').toEqual([]);
  });

  it('temoin : le motif reconnait bien un octet de controle', () => {
    expect(CONTROL.test('a' + String.fromCharCode(0) + 'b')).toBe(true);
    expect(CONTROL.test('a\u0000b')).toBe(true);
    expect(CONTROL.test('tab\tnewline\r\nfin')).toBe(false);
    expect(CONTROL.test('du texte ordinaire')).toBe(false);
  });
});
