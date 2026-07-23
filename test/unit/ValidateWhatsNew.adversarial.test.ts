/**
 * Adversarial tests for `.github/scripts/validate-whats-new.mjs`.
 *
 * The validator is the LAST gate between a release draft and the
 * Marketplace. If it misses a problem, the problem reaches real users.
 * These tests exist specifically so that "silent ship of broken
 * what's-new" cannot happen — every class of corruption the validator
 * was designed to catch is exercised here as a hostile input.
 *
 * Approach: write a temporary whats-new.json to disk via a symlinked
 * repo stub, run the validator as a child process, assert on exit code
 * and stderr. This is the exact code path `.publish` and CI use, so a
 * green test here means the real gate behaves the same way.
 *
 * Categories covered:
 *   - schema/structure (missing required fields, wrong types)
 *   - version mismatches (ahead, behind, --version gate)
 *   - media file pointers (missing, too small, URL-shaped, wrong ext)
 *   - size limits (oversized titles, summaries, bullets)
 *   - LLM leak patterns (chain-of-thought, TODO markers, template vars)
 *   - duplicate media assignment across highlights
 *   - invalid `kind` enum values
 *   - invalid JSON syntax (malformed file)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VALIDATOR = path.join(REPO_ROOT, '.github', 'scripts', 'validate-whats-new.mjs');

/** Build an isolated repo root so the validator sees only the fixture we
 *  planted — not the real media/whats-new.json in the actual repo. We
 *  COPY (not symlink) the validator because node resolves symlinks for
 *  `import.meta.url` so __dirname inside the script would leak back to
 *  the real repo and validate the wrong file. */
function makeFixtureRepo(data: unknown, opts: { version?: string; planted?: string[] } = {}): string {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'kj-validate-wn-'));
  // Mirror the structure the validator expects relative to `__dirname`:
  //   <tmp>/.github/scripts/validate-whats-new.mjs  (real validator, copied)
  //   <tmp>/media/whats-new.json                    (fixture)
  //   <tmp>/assets/demos/*.webp                     (fake webp files for media fields)
  //   <tmp>/package.json                            (for version cross-check)
  mkdirSync(path.join(tmp, '.github', 'scripts'), { recursive: true });
  mkdirSync(path.join(tmp, 'media'),               { recursive: true });
  mkdirSync(path.join(tmp, 'assets', 'demos'),     { recursive: true });

  copyFileSync(VALIDATOR, path.join(tmp, '.github', 'scripts', 'validate-whats-new.mjs'));

  // Plant package.json with the given version (or a default 1.16.0).
  writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'fake', version: opts.version || '1.16.0' }, null, 2),
  );

  // Plant media/whats-new.json
  if (typeof data === 'string') writeFileSync(path.join(tmp, 'media', 'whats-new.json'), data);
  else writeFileSync(path.join(tmp, 'media', 'whats-new.json'), JSON.stringify(data, null, 2));

  // Plant webp stubs (≥ 1 KB each so they clear the size threshold).
  for (const name of (opts.planted || [])) {
    const p = path.join(tmp, 'assets', 'demos', name);
    writeFileSync(p, Buffer.alloc(2048, 0x99));
  }

  return tmp;
}

/** Invoke the validator against the fixture. Returns {exit, stderr, stdout}. */
function runValidator(fixture: string, versionArg?: string) {
  const args = [path.join(fixture, '.github', 'scripts', 'validate-whats-new.mjs')];
  if (versionArg !== undefined) args.push('--version', versionArg);
  const r = spawnSync('node', args, { encoding: 'utf8', cwd: fixture });
  return {
    exit:   r.status ?? -1,
    stderr: r.stderr || '',
    stdout: r.stdout || '',
  };
}

let TMP_DIRS: string[] = [];
beforeEach(() => { TMP_DIRS = []; });
afterEach(() => {
  for (const d of TMP_DIRS) rmSync(d, { recursive: true, force: true });
});

function fixture(data: unknown, opts: { version?: string; planted?: string[] } = {}): string {
  const d = makeFixtureRepo(data, opts);
  TMP_DIRS.push(d);
  return d;
}

// ── Happy path ────────────────────────────────────────────────────────────

describe('ADV-validate-whats-new — happy path', () => {
  it('exits 0 on a minimal valid file', () => {
    const r = runValidator(fixture({
      version: '1.16.0',
      summary: 'A release.',
      sections: [{ heading: 'Notes', bullets: ['Nothing special.'] }],
    }));
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  it('exits 0 on a rich valid file', () => {
    const r = runValidator(fixture({
      version: '1.16.0',
      tagline: 'Big release',
      summary: 'Packed with features.',
      highlights: [
        { title: 'Feature A', description: 'Does A things.', kind: 'feature', media: 'a.webp', mediaAlt: 'Demo A' },
        { title: 'Feature B', description: 'Does B things.', kind: 'improvement' },
      ],
      sections: [{ heading: 'Highlights', bullets: ['A shipped', 'B shipped'] }],
    }, { planted: ['a.webp'] }));
    expect(r.exit).toBe(0);
  });
});

// ── Missing / wrong required fields ───────────────────────────────────────

describe('ADV-validate-whats-new — required field enforcement', () => {
  it('fails when version is missing', () => {
    const r = runValidator(fixture({ summary: 'x', sections: [{ heading: 'h', bullets: ['b'] }] }));
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/version/);
  });

  it('fails when summary is missing', () => {
    const r = runValidator(fixture({ version: '1.16.0', sections: [{ heading: 'h', bullets: ['b'] }] }));
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/summary/);
  });

  it('fails when sections is missing', () => {
    const r = runValidator(fixture({ version: '1.16.0', summary: 'x' }));
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/sections/);
  });

  it('fails when sections is an empty array', () => {
    const r = runValidator(fixture({ version: '1.16.0', summary: 'x', sections: [] }));
    expect(r.exit).toBe(1);
  });

  it('fails when a section has no bullets', () => {
    const r = runValidator(fixture({
      version: '1.16.0',
      summary: 'x',
      sections: [{ heading: 'h', bullets: [] }],
    }));
    expect(r.exit).toBe(1);
  });
});

// ── Version checks ────────────────────────────────────────────────────────

describe('ADV-validate-whats-new — version gates', () => {
  it('fails when --version does not match the file version', () => {
    const r = runValidator(
      fixture({ version: '1.16.0', summary: 'x', sections: [{ heading: 'h', bullets: ['b'] }] }),
      '1.17.0',
    );
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/1\.16\.0.*1\.17\.0|1\.17\.0.*1\.16\.0/);
  });

  it('fails when the file version is not valid semver', () => {
    const r = runValidator(fixture({
      version: 'not-semver',
      summary: 'x',
      sections: [{ heading: 'h', bullets: ['b'] }],
    }));
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/semver/);
  });

  it('fails when whats-new.json is BEHIND package.json', () => {
    const r = runValidator(fixture(
      { version: '1.15.0', summary: 'x', sections: [{ heading: 'h', bullets: ['b'] }] },
      { version: '1.16.0' },  // package.json says 1.16.0
    ));
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/BEHIND/);
  });

  it('passes when whats-new.json is AHEAD of package.json (staging next release)', () => {
    const r = runValidator(fixture(
      { version: '1.17.0', summary: 'x', sections: [{ heading: 'h', bullets: ['b'] }] },
      { version: '1.16.0' },
    ));
    expect(r.exit).toBe(0);
  });
});

// ── Media field rules ────────────────────────────────────────────────────

describe('ADV-validate-whats-new — media field integrity', () => {
  const base = {
    version: '1.16.0',
    summary: 'x',
    sections: [{ heading: 'h', bullets: ['b'] }],
  };

  it('fails when media file does not exist', () => {
    const r = runValidator(fixture({
      ...base,
      highlights: [{ title: 'A', media: 'missing.webp' }],
    }));
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/does not exist/);
  });

  it('fails when media points at a URL instead of a filename', () => {
    const r = runValidator(fixture({
      ...base,
      highlights: [{ title: 'A', media: 'https://example.com/foo.webp' }],
    }, { planted: ['foo.webp'] }));
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/URL/);
  });

  it('fails when media has the wrong extension', () => {
    const r = runValidator(fixture({
      ...base,
      highlights: [{ title: 'A', media: 'foo.png' }],
    }));
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/valid webp filename/);
  });

  it('fails when media file is suspiciously small (< 1 KB)', () => {
    const tmp = fixture({
      ...base,
      highlights: [{ title: 'A', media: 'tiny.webp' }],
    });
    // Overwrite the planted file with a truly tiny one.
    writeFileSync(path.join(tmp, 'assets', 'demos', 'tiny.webp'), Buffer.alloc(100, 0x00));
    const r = runValidator(tmp);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/suspiciously small|does not exist/);
  });

  it('fails when two highlights assign the same media', () => {
    const r = runValidator(fixture({
      ...base,
      highlights: [
        { title: 'A', media: 'shared.webp' },
        { title: 'B', media: 'shared.webp' },
      ],
    }, { planted: ['shared.webp'] }));
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/more than one highlight/);
  });

  it('accepts a valid media filename pointing at a real file', () => {
    const r = runValidator(fixture({
      ...base,
      highlights: [{ title: 'A', media: 'ok.webp', mediaAlt: 'alt text' }],
    }, { planted: ['ok.webp'] }));
    expect(r.exit).toBe(0);
  });
});

// ── Enum + type checks ───────────────────────────────────────────────────

describe('ADV-validate-whats-new — kind enum + type safety', () => {
  const base = {
    version: '1.16.0',
    summary: 'x',
    sections: [{ heading: 'h', bullets: ['b'] }],
  };

  it('fails on unknown kind value', () => {
    const r = runValidator(fixture({
      ...base,
      highlights: [{ title: 'A', kind: 'wow' }],
    }));
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/kind.*wow/);
  });

  it('accepts each valid kind value', () => {
    for (const kind of ['feature', 'improvement', 'fix', 'note']) {
      const r = runValidator(fixture({
        ...base,
        highlights: [{ title: 'A', kind }],
      }));
      expect(r.exit, `kind=${kind}`).toBe(0);
    }
  });

  it('fails when a highlight is not an object', () => {
    const r = runValidator(fixture({
      ...base,
      highlights: ['not an object'],
    }));
    expect(r.exit).toBe(1);
  });

  it('fails when highlight title is not a non-empty string', () => {
    const r = runValidator(fixture({
      ...base,
      highlights: [{ title: '' }],
    }));
    expect(r.exit).toBe(1);
  });
});

// ── Size limits ──────────────────────────────────────────────────────────

describe('ADV-validate-whats-new — size limits', () => {
  const base = {
    version: '1.16.0',
    summary: 'x',
    sections: [{ heading: 'h', bullets: ['b'] }],
  };

  it('fails when summary exceeds 800 chars', () => {
    const r = runValidator(fixture({
      ...base,
      summary: 'x'.repeat(801),
    }));
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/summary.*exceeds/i);
  });

  it('fails when a highlight title exceeds 120 chars', () => {
    const r = runValidator(fixture({
      ...base,
      highlights: [{ title: 'A'.repeat(121) }],
    }));
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/title.*exceeds/i);
  });

  it('fails when a bullet exceeds 600 chars', () => {
    const r = runValidator(fixture({
      ...base,
      sections: [{ heading: 'h', bullets: ['x'.repeat(601)] }],
    }));
    expect(r.exit).toBe(1);
  });

  it('fails when a section has too many bullets (> 5)', () => {
    const r = runValidator(fixture({
      ...base,
      sections: [{ heading: 'h', bullets: ['b', 'b', 'b', 'b', 'b', 'b'] }],
    }));
    expect(r.exit).toBe(1);
  });

  it('warns / fails when highlights array has more than 3 entries', () => {
    const r = runValidator(fixture({
      ...base,
      highlights: [
        { title: '1' }, { title: '2' }, { title: '3' }, { title: '4' },
      ],
    }));
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/only the first 3/i);
  });
});

// ── LLM-leak / placeholder detection ─────────────────────────────────────

describe('ADV-validate-whats-new — leak and placeholder guards', () => {
  const base = {
    version: '1.16.0',
    summary: 'x',
    sections: [{ heading: 'h', bullets: ['b'] }],
  };

  const LEAKS = [
    { text: 'I will now describe the feature.',           why: 'first-person' },
    { text: 'TODO: finish this bullet.',                  why: 'todo marker' },
    { text: 'FIXME in the description.',                  why: 'fixme marker' },
    { text: 'Lorem ipsum dolor sit amet.',                why: 'lorem ipsum' },
    { text: 'Ships with <placeholder>.',                  why: 'bracketed placeholder' },
    { text: 'Claude drafted these notes for you.',        why: 'bare Claude reference' },
    { text: 'Drafting the notes here.',                   why: 'meta-drafting phrase' },
    { text: 'Features ship in {version}.',                why: 'template variable' },
  ];

  for (const { text, why } of LEAKS) {
    it(`rejects "${why}" in summary: "${text.slice(0, 40)}..."`, () => {
      const r = runValidator(fixture({ ...base, summary: text }));
      expect(r.exit).toBe(1);
    });

    it(`rejects "${why}" in highlight description`, () => {
      const r = runValidator(fixture({
        ...base,
        highlights: [{ title: 'x', description: text }],
      }));
      expect(r.exit).toBe(1);
    });

    it(`rejects "${why}" in section bullet`, () => {
      const r = runValidator(fixture({
        ...base,
        sections: [{ heading: 'h', bullets: [text] }],
      }));
      expect(r.exit).toBe(1);
    });
  }

  // TODO nuance: marker FORMS are leaks, prose ABOUT todos is legitimate copy
  // (v1.24.0 ships "Overdue TODO Highlighting" — the feature is named after
  // the marker).
  for (const text of ['TODO(2025-01-01) cleanup', 'ships soon. TODO...', 'TODO']) {
    it(`rejects TODO marker form in bullet: "${text}"`, () => {
      const r = runValidator(fixture({
        ...base,
        sections: [{ heading: 'h', bullets: [text] }],
      }));
      expect(r.exit).toBe(1);
    });
  }

  for (const text of [
    'Overdue TODO Highlighting',
    'Dated TODO comments past their due date now render in red.',
  ]) {
    it(`accepts prose about todos in bullet: "${text.slice(0, 40)}"`, () => {
      const r = runValidator(fixture({
        ...base,
        sections: [{ heading: 'h', bullets: [text] }],
      }));
      expect(r.exit).toBe(0);
    });
  }

  it('rejects markdown code fences (not rendered by webview)', () => {
    const r = runValidator(fixture({
      ...base,
      sections: [{ heading: 'h', bullets: ['```kotlin\nval x = 1\n```'] }],
    }));
    expect(r.exit).toBe(1);
  });

  it('accepts sane, non-leaky release text', () => {
    const r = runValidator(fixture({
      version: '1.16.0',
      summary: 'Coroutine clarity — dispatcher badges and @Suppress hover.',
      highlights: [
        { title: 'Dispatchers', description: 'Badges render inline on withContext.', kind: 'feature' },
      ],
      sections: [{ heading: 'Notes', bullets: ['Backwards compatible.'] }],
    }));
    expect(r.exit).toBe(0);
  });
});

// ── JSON parse errors ────────────────────────────────────────────────────

describe('ADV-validate-whats-new — malformed file', () => {
  it('exits with a clear error on malformed JSON', () => {
    const r = runValidator(fixture('{ "version": "1.16.0",\n  summary: not quoted }' as any));
    // Parse errors use exit code 2 (fatal bootstrap failure) vs 1 (validation).
    expect(r.exit).toBe(2);
    expect(r.stderr).toMatch(/not valid JSON/);
  });

  it('exits with error when file is an array instead of object', () => {
    const r = runValidator(fixture([1, 2, 3] as any));
    expect(r.exit).toBe(2);
    expect(r.stderr).toMatch(/must be a JSON object/);
  });
});
