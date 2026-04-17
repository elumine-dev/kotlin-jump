/**
 * Tests pour VersionCatalogIndex — parsing TOML, résolution accesseurs hyphen/dot.
 *
 * Attack surface:
 *  1. Section [versions] — clés et valeurs string
 *  2. Section [libraries] — format objet `{ group, name, version.ref }` et shorthand `"g:n:v"`
 *  3. getByAccessor() — dot→hyphen conversion
 *  4. Sections [bundles] et [plugins] — silencieusement ignorées
 *  5. Commentaires TOML — ignorés
 *  6. reindexFile() — idempotent, écrase le contenu précédent
 *
 * Tests nommés SP2-VCI-* pour faciliter le grep.
 */

import { describe, it, expect } from 'vitest';
import { VersionCatalogIndex } from '../../src/indexer/VersionCatalogIndex';

const TOML_BASIC = `
[versions]
kotlin = "1.9.22"
compose = "1.6.2"
retrofit = "2.9.0"

[libraries]
core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "kotlin" }
compose-ui = { group = "androidx.compose.ui", name = "ui", version.ref = "compose" }
retrofit-core = { group = "com.squareup.retrofit2", name = "retrofit", version.ref = "retrofit" }
gson = "com.google.code.gson:gson:2.10.1"
`.trim();

// ── SP2-VCI-1 : format objet avec version.ref ─────────────────────────────────

describe('SP2-VCI-1 — format objet { group, name, version.ref }', () => {
  it('core-ktx résolu via version.ref', () => {
    const idx = new VersionCatalogIndex();
    idx.reindexFile(TOML_BASIC);
    const e = idx.getByAccessor('core-ktx');
    expect(e).toBeDefined();
    expect(e!.group).toBe('androidx.core');
    expect(e!.name).toBe('core-ktx');
    expect(e!.version).toBe('1.9.22');
  });

  it('compose-ui résolu via version.ref', () => {
    const idx = new VersionCatalogIndex();
    idx.reindexFile(TOML_BASIC);
    const e = idx.getByAccessor('compose-ui');
    expect(e!.version).toBe('1.6.2');
  });
});

// ── SP2-VCI-2 : format shorthand "g:n:v" ─────────────────────────────────────

describe('SP2-VCI-2 — format shorthand "group:name:version"', () => {
  it('gson shorthand extrait correctement', () => {
    const idx = new VersionCatalogIndex();
    idx.reindexFile(TOML_BASIC);
    const e = idx.getByAccessor('gson');
    expect(e!.group).toBe('com.google.code.gson');
    expect(e!.name).toBe('gson');
    expect(e!.version).toBe('2.10.1');
  });
});

// ── SP2-VCI-3 : version.ref non résolu — fallback ────────────────────────────

describe('SP2-VCI-3 — version.ref non résolu', () => {
  it('version.ref inexistant → fallback sur le nom de la ref, pas de crash', () => {
    const toml = `
[libraries]
mylib = { group = "com.example", name = "mylib", version.ref = "nonexistent" }
`.trim();
    const idx = new VersionCatalogIndex();
    expect(() => idx.reindexFile(toml)).not.toThrow();
    const e = idx.getByAccessor('mylib');
    expect(e).toBeDefined();
    expect(e!.version).toBe('nonexistent'); // fallback = nom de la ref
  });
});

// ── SP2-VCI-4 : accessor dot→hyphen conversion ────────────────────────────────

describe('SP2-VCI-4 — accessor compose.ui → TOML key compose-ui', () => {
  it('dot dans accessor converti en hyphen pour lookup', () => {
    const idx = new VersionCatalogIndex();
    idx.reindexFile(TOML_BASIC);
    // accessor "compose.ui" → cherche "compose-ui" dans l'index
    const e = idx.getByAccessor('compose.ui');
    expect(e).toBeDefined();
    expect(e!.name).toBe('ui');
  });

  it('SP2-VCI-4b: retrofit.core → retrofit-core', () => {
    const idx = new VersionCatalogIndex();
    idx.reindexFile(TOML_BASIC);
    const e = idx.getByAccessor('retrofit.core');
    expect(e!.group).toBe('com.squareup.retrofit2');
  });
});

// ── SP2-VCI-5 : accessor direct (hyphen) ─────────────────────────────────────

describe('SP2-VCI-5 — accessor exact avec hyphen', () => {
  it('compose-ui trouvé directement', () => {
    const idx = new VersionCatalogIndex();
    idx.reindexFile(TOML_BASIC);
    expect(idx.getByAccessor('compose-ui')).toBeDefined();
  });
});

// ── SP2-VCI-6 : accessor inconnu ─────────────────────────────────────────────

describe('SP2-VCI-6 — accessor inconnu', () => {
  it('retourne undefined', () => {
    const idx = new VersionCatalogIndex();
    idx.reindexFile(TOML_BASIC);
    expect(idx.getByAccessor('nonexistent.library')).toBeUndefined();
  });

  it('index vide → undefined', () => {
    const idx = new VersionCatalogIndex();
    expect(idx.getByAccessor('anything')).toBeUndefined();
  });
});

// ── SP2-VCI-7 : sections [bundles] et [plugins] ignorées ─────────────────────

describe('SP2-VCI-7 — sections ignorées', () => {
  it('[bundles] ne crée pas d\'entrées', () => {
    const toml = `
[versions]
junit = "5.10.1"

[libraries]
junit5 = { group = "org.junit", name = "junit-jupiter", version.ref = "junit" }

[bundles]
testing = ["junit5"]

[plugins]
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "junit" }
`.trim();
    const idx = new VersionCatalogIndex();
    idx.reindexFile(toml);
    // bundles et plugins ne doivent pas polluer l'index libraries
    expect(idx.getByAccessor('testing')).toBeUndefined();
    expect(idx.getByAccessor('kotlin-jvm')).toBeUndefined();
    // mais la library doit être là
    expect(idx.getByAccessor('junit5')).toBeDefined();
  });
});

// ── SP2-VCI-8 : commentaires TOML ignorés ────────────────────────────────────

describe('SP2-VCI-8 — commentaires ignorés', () => {
  it('lignes commençant par # ignorées', () => {
    const toml = `
[versions]
# kotlin = "OLD_VERSION"
kotlin = "1.9.22"

[libraries]
# core-ktx = { group = "ignored", name = "ignored", version.ref = "kotlin" }
core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "kotlin" }
`.trim();
    const idx = new VersionCatalogIndex();
    idx.reindexFile(toml);
    const e = idx.getByAccessor('core-ktx');
    expect(e!.group).toBe('androidx.core');
    expect(e!.version).toBe('1.9.22');
  });
});

// ── SP2-VCI-9 : reindexFile idempotent (écrase) ───────────────────────────────

describe('SP2-VCI-9 — reindexFile écrase le contenu précédent', () => {
  it('deuxième reindexFile remplace le premier', () => {
    const idx = new VersionCatalogIndex();
    idx.reindexFile(`
[versions]
v = "1.0.0"
[libraries]
mylib = { group = "com.a", name = "a", version.ref = "v" }
`.trim());
    expect(idx.getByAccessor('mylib')!.group).toBe('com.a');

    idx.reindexFile(`
[versions]
v = "2.0.0"
[libraries]
mylib = { group = "com.b", name = "b", version.ref = "v" }
`.trim());
    const e = idx.getByAccessor('mylib');
    expect(e!.group).toBe('com.b');
    expect(e!.version).toBe('2.0.0');
  });
});

// ── version littérale (pas de ref) ───────────────────────────────────────────

describe('SP2-VCI — version littérale dans l\'objet', () => {
  it('version = "1.0" sans version.ref', () => {
    const toml = `
[libraries]
mylib = { group = "com.example", name = "lib", version = "1.2.3" }
`.trim();
    const idx = new VersionCatalogIndex();
    idx.reindexFile(toml);
    expect(idx.getByAccessor('mylib')!.version).toBe('1.2.3');
  });
});
