/**
 * The notes schema and the validator must agree on every length.
 *
 * `.publish` asked `claude -p` for notes under a JSON schema with no
 * `maxLength`, while `validate-whats-new.mjs` rejects a bullet over 600
 * characters. A drafted bullet of 640 characters passed the schema, the
 * validator aborted the release after the changelog, README and package
 * files had been rewritten, and they had to be restored by hand.
 *
 * One module now holds the limits; the validator reads them and `.publish`
 * builds its schema and its prompt rule from them. This guard fails when a
 * copy creeps back into either place.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const LIMITS_MODULE = path.join(REPO, '.github', 'scripts', 'whats-new-limits.mjs');
const run = (flag: string) => spawnSync('node', [LIMITS_MODULE, flag], { encoding: 'utf8' });

describe('limites des notes : une seule source', () => {
  it('le schema borne chaque texte par la limite du validateur', async () => {
    const { LIMITS } = await import(LIMITS_MODULE);
    const r = run('--schema');
    expect(r.status).toBe(0);
    const schema = JSON.parse(r.stdout);
    const h = schema.properties.highlights;
    const s = schema.properties.sections;
    expect(schema.properties.summary.maxLength).toBe(LIMITS.summary);
    expect(schema.properties.tagline.maxLength).toBe(LIMITS.tagline);
    expect(h.maxItems).toBe(LIMITS.highlights);
    expect(h.items.properties.title.maxLength).toBe(LIMITS.title);
    expect(h.items.properties.description.maxLength).toBe(LIMITS.description);
    expect(s.items.properties.bullets.maxItems).toBe(LIMITS.sectionBullets);
    expect(s.items.properties.bullets.items.maxLength).toBe(LIMITS.bullet);
    expect(schema.required).toEqual(['summary', 'tagline', 'highlights', 'sections']);
  });

  it('la regle du prompt cite les memes nombres', async () => {
    const { LIMITS } = await import(LIMITS_MODULE);
    const r = run('--rules');
    expect(r.status).toBe(0);
    for (const n of [LIMITS.summary, LIMITS.tagline, LIMITS.title, LIMITS.description, LIMITS.bullet]) {
      expect(r.stdout).toContain(String(n));
    }
  });

  it('le validateur ne garde aucune copie des nombres', () => {
    const src = readFileSync(path.join(REPO, '.github', 'scripts', 'validate-whats-new.mjs'), 'utf8');
    expect(src).toMatch(/from '\.\/whats-new-limits\.mjs'/);
    expect(src).not.toMatch(/const MAX_\w+\s*=\s*\d/);
  });

  it('.publish construit son schema et sa regle depuis le module', () => {
    const publish = readFileSync(path.join(REPO, '.publish'), 'utf8');
    expect(publish).not.toMatch(/--json-schema\s+'\{/);
    expect(publish).toMatch(/--json-schema "\$\(node "\$ROOT_DIR\/\.github\/scripts\/whats-new-limits\.mjs" --schema\)"/);
    expect(publish).toMatch(/\$\(node "\$ROOT_DIR\/\.github\/scripts\/whats-new-limits\.mjs" --rules\)/);
  });
});
