import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-031 adversarial — les six gardes, chacune issue d'un faux positif réel
 * trouvé pendant l'audit un par un d'un monorepo de 3 444 fichiers.
 */

const mod: any = await importOrNull('src/providers/UnusedResourceKeyProvider');
const scanner: any = await importOrNull('src/indexer/ValueResourceScanner');

const APP = '/w/app';
const VALUES = `${APP}/src/main/res/values/x.xml`;
const res = (body: string) => `<resources>\n${body}\n</resources>\n`;

/** Déclare depuis du vrai XML, comme en production. */
function declare(files: Record<string, string>) {
  return Object.entries(files).flatMap(([path, xml]) =>
    scanner.collectValueKeyDeclarations(path, xml, [APP, '/w/feature']),
  );
}

function find(files: Record<string, string>, sources: { path: string; text: string }[] = [], extra: any = {}) {
  return mod.findUnusedResourceKeys({
    declarations: declare(files),
    sources: [...Object.entries(files).map(([path, text]) => ({ path, text })), ...sources],
    modulesWithCode: [APP, '/w/feature'],
    ...extra,
  });
}

const names = (findings: any[]) => findings.map(f => `${f.kind}/${f.name}`).sort();

describe.skipIf(!mod || !scanner)('G0 — corpus tronqué', () => {
  it('un corpus incomplet ne peut rien prouver, donc zéro signalement', () => {
    const files = { [VALUES]: res('<string name="kj_dead">x</string>') };
    expect(find(files)).toHaveLength(1);
    expect(find(files, [], { truncated: true })).toEqual([]);
  });
});

describe.skipIf(!mod || !scanner)('G1 — une surcharge de configuration n’est pas un usage', () => {
  it('la même clé en values/ et values-night/ fait UNE trouvaille à deux variantes', () => {
    const found = find({
      [VALUES]: res('<color name="kj_dead">#fff</color>'),
      [`${APP}/src/main/res/values-night/x.xml`]: res('<color name="kj_dead">#000</color>'),
    });
    expect(found).toHaveLength(1);
    expect(found[0].variants).toHaveLength(2);
    expect(found[0].base.qualifier).toBe('values');
  });

  it('la base est la variante values/, quel que soit l’ordre de lecture', () => {
    const found = find({
      [`${APP}/src/main/res/values-w600dp/d.xml`]: res('<dimen name="kj_dead">2dp</dimen>'),
      [`${APP}/src/main/res/values/d.xml`]: res('<dimen name="kj_dead">1dp</dimen>'),
    });
    expect(found[0].base.qualifier).toBe('values');
    expect(found[0].variants[0].qualifier).toBe('values');
  });

  it('sans variante de base, la première par chemin fait office de base', () => {
    const found = find({
      [`${APP}/src/main/res/values-night/c.xml`]: res('<color name="kj_night_only">#000</color>'),
    });
    expect(found).toHaveLength(1);
    expect(found[0].base.qualifier).toBe('values-night');
  });

  it('une clé vivante ne devient pas morte parce qu’elle est surchargée', () => {
    const found = find(
      {
        [VALUES]: res('<color name="kj_live">#fff</color>'),
        [`${APP}/src/main/res/values-night/x.xml`]: res('<color name="kj_live">#000</color>'),
      },
      [{ path: `${APP}/Main.kt`, text: 'val c = R.color.kj_live' }],
    );
    expect(found).toEqual([]);
  });
});

describe.skipIf(!mod || !scanner)('G1b — une déclaration ne se ressuscite pas elle-même', () => {
  it('le name= d’une déclaration ne compte jamais comme littéral', () => {
    // Sans le blanchiment, collectStringLiterals rendrait vivante chaque clé.
    expect(names(find({ [VALUES]: res('<string name="kj_dead">x</string>') }))).toEqual(['string/kj_dead']);
  });

  it('mais un littéral nu dans du Kotlin sauve bien la clé', () => {
    const found = find(
      { [VALUES]: res('<string name="kj_dyn">x</string>') },
      [{ path: `${APP}/Main.kt`, text: 'val id = res("kj_dyn")' }],
    );
    expect(found).toEqual([]);
  });

  it('un littéral dans un AUTRE fichier values ne sauve rien', () => {
    const found = find({
      [VALUES]: res('<string name="kj_dead">x</string>'),
      [`${APP}/src/main/res/values/other.xml`]: res('<string name="autre">kj_dead</string>'),
    });
    expect(names(found)).toContain('string/kj_dead');
  });
});

describe.skipIf(!mod || !scanner)('G2 — les artefacts R8 mentent', () => {
  it('un seeds.txt listant toutes les clés ne change rien', () => {
    const files = { [VALUES]: res('<string name="kj_dead">x</string>') };
    const withArtifact = find(files, [
      { path: `${APP}/build/outputs/mapping/release/seeds.txt`, text: 'int string kj_dead' },
    ]);
    expect(names(withArtifact)).toEqual(['string/kj_dead']);
  });

  it('usage.txt et mapping.txt non plus', () => {
    const files = { [VALUES]: res('<color name="kj_dead">#fff</color>') };
    for (const name of ['usage.txt', 'mapping.txt']) {
      const found = find(files, [{ path: `${APP}/reports/${name}`, text: 'public static final int kj_dead' }]);
      expect(names(found)).toEqual(['color/kj_dead']);
    }
  });

  it('tout ce qui vit sous build/ est ignoré, quel que soit le nom', () => {
    const found = find(
      { [VALUES]: res('<string name="kj_dead">x</string>') },
      [{ path: `${APP}/build/generated/R.java`, text: 'public static int kj_dead=0x1;' }],
    );
    expect(names(found)).toEqual(['string/kj_dead']);
  });
});

describe.skipIf(!mod || !scanner)('G3 — les configs de SDK tiers sont invisibles', () => {
  it('les clés à préfixe fournisseur ne sont jamais signalées', () => {
    const found = find({
      [VALUES]: res([
        '<string name="com_braze_api_key">k</string>',
        '<string name="com_appboy_custom_endpoint">e</string>',
        '<string name="fb_login_protocol_scheme">s</string>',
        '<bool name="com_braze_handle_push_deep_links_automatically">true</bool>',
      ].join('\n')),
    });
    expect(found).toEqual([]);
  });

  it('mais un nom qui ressemble sans en être un reste signalé', () => {
    // prouve que seule l'allowlist protège les clés ci-dessus
    expect(names(find({ [VALUES]: res('<string name="brazen_thing">x</string>') })))
      .toEqual(['string/brazen_thing']);
  });

  it('les préfixes de bibliothèque AAR sont couverts par la même règle', () => {
    expect(find({ [VALUES]: res('<string name="abc_action_bar_home">x</string>') })).toEqual([]);
  });

  it('ignorePrefixes ajoute des préfixes sans remplacer les internes', () => {
    const files = { [VALUES]: res('<string name="acme_key">x</string>\n<string name="com_braze_x">y</string>') };
    expect(find(files)).toHaveLength(1);
    expect(find(files, [], { ignorePrefixes: ['acme_'] })).toEqual([]);
  });
});

describe.skipIf(!mod || !scanner)('G4 — un nom avec deux-points ne déclare rien', () => {
  it('<attr name="android:textColor"/> n’est jamais une trouvaille', () => {
    const found = find({
      [VALUES]: res([
        '<declare-styleable name="KjBadge">',
        '  <attr name="android:textColor" />',
        '  <attr name="android:background" format="reference" />',
        '</declare-styleable>',
      ].join('\n')),
    });
    expect(found).toEqual([]);
  });
});

describe.skipIf(!mod || !scanner)('G5 — l’héritage de style par le point', () => {
  it('déclarer l’enfant garde le parent vivant, sans aucune mention textuelle', () => {
    const found = find({
      [VALUES]: res([
        '<style name="Widget.Kj.Button" />',
        '<style name="Widget.Kj.Button.Primary" />',
      ].join('\n')),
    });
    // Primary n'a aucun enfant et personne ne le cite : lui seul est mort.
    expect(names(found)).toEqual(['style/Widget.Kj.Button.Primary']);
  });

  it('parent="Foo" et parent="@style/Foo" sauvent tous les deux', () => {
    for (const form of ['Base.Kj', '@style/Base.Kj']) {
      const found = find({
        [VALUES]: res(`<style name="Base.Kj" />\n<style name="Child" parent="${form}" />`),
      });
      expect(names(found)).toEqual(['style/Child']);
    }
  });

  it('R.style.A_B sauve le style déclaré A.B', () => {
    const found = find(
      { [VALUES]: res('<style name="Widget.Kj" />') },
      [{ path: `${APP}/Main.kt`, text: 'setStyle(R.style.Widget_Kj)' }],
    );
    expect(found).toEqual([]);
  });

  it('un style de plateforme comme parent ne sauve rien de local', () => {
    const found = find({
      [VALUES]: res('<style name="Widget" />\n<style name="C" parent="@android:style/Widget" />'),
    });
    expect(names(found)).toEqual(['style/C', 'style/Widget']);
  });
});

describe.skipIf(!mod || !scanner)('G6 — la consommation d’un attr', () => {
  it('l’appartenance à un declare-styleable suffit', () => {
    const found = find({
      [VALUES]: res([
        '<declare-styleable name="KjBadge">',
        '  <attr name="kjBadgeColor" format="color" />',
        '</declare-styleable>',
      ].join('\n')),
    });
    expect(found).toEqual([]);
  });

  it('R.styleable.X_y sauve un attr déclaré au premier niveau', () => {
    const found = find(
      { [VALUES]: res('<attr name="kjAccent" format="reference" />') },
      [{ path: `${APP}/V.kt`, text: 'a.getColor(R.styleable.KjBadge_kjAccent, 0)' }],
    );
    expect(found).toEqual([]);
  });

  it('?attr/nom et ?nom sauvent', () => {
    for (const form of ['?attr/kjAccent', '?kjAccent']) {
      const found = find({
        [VALUES]: res('<attr name="kjAccent" format="reference" />'),
        [`${APP}/src/main/res/layout/m.xml`]: `<View android:background="${form}" />`,
      });
      expect(found).toEqual([]);
    }
  });

  it('une URL contenant un ? ne sauve aucun attr', () => {
    const found = find({
      [VALUES]: res('<attr name="page" format="string" />\n<string name="u">https://x/y?page=1</string>'),
    });
    expect(names(found)).toContain('attr/page');
  });

  it('un <item> dans un style sauve l’attr sans être lui-même une déclaration', () => {
    const found = find({
      [VALUES]: res([
        '<attr name="kjAccent" format="reference" />',
        '<style name="Theme.Kj">',
        '  <item name="kjAccent">#fff</item>',
        '</style>',
      ].join('\n')),
    });
    expect(names(found)).toEqual(['style/Theme.Kj']);
  });
});

describe.skipIf(!mod || !scanner)('gardes héritées de KJ-029', () => {
  it('une clé déclarée dans deux modules est ignorée (overlay)', () => {
    const found = find({
      [VALUES]: res('<string name="shared">a</string>'),
      ['/w/feature/src/main/res/values/x.xml']: res('<string name="shared">b</string>'),
    });
    expect(found).toEqual([]);
  });

  it('un module sans code ne peut pas être le consommateur de ses ressources', () => {
    const found = mod.findUnusedResourceKeys({
      declarations: declare({ [VALUES]: res('<string name="kj_dead">x</string>') }),
      sources: [],
      modulesWithCode: [],
    });
    expect(found).toEqual([]);
  });

  it('un module bibliothèque est signalé, mais marqué comme tel', () => {
    const found = mod.findUnusedResourceKeys({
      declarations: declare({ [VALUES]: res('<string name="kj_dead">x</string>') }),
      sources: [],
      modulesWithCode: [APP],
      libraryModules: [APP],
    });
    expect(found).toHaveLength(1);
    expect(found[0].isLibraryModule).toBe(true);
  });

  it('le marqueur kotlin-jump:ignore exempte tout le fichier', () => {
    const found = find({
      [VALUES]: `<!-- kotlin-jump:ignore unused-resource -->\n${res('<string name="kj_dead">x</string>')}`,
    });
    expect(found).toEqual([]);
  });
});

describe.skipIf(!mod || !scanner)('précision des références', () => {
  it('battle déclarée et R.string.battle_cry dans le code : battle reste morte', () => {
    const found = find(
      { [VALUES]: res('<string name="battle">x</string>') },
      [{ path: `${APP}/M.kt`, text: 'val s = R.string.battle_cry' }],
    );
    expect(names(found)).toEqual(['string/battle']);
  });

  it('une référence en commentaire ne sauve rien', () => {
    const found = find(
      { [VALUES]: res('<string name="kj_dead">x</string>') },
      [
        { path: `${APP}/M.kt`, text: '// R.string.kj_dead' },
        { path: `${APP}/src/main/res/layout/m.xml`, text: '<!-- @string/kj_dead -->' },
      ],
    );
    expect(names(found)).toEqual(['string/kj_dead']);
  });

  it('tools: ne sauve pas, tools:keep sauve', () => {
    const dead = find(
      { [VALUES]: res('<string name="kj_dead">x</string>') },
      [{ path: `${APP}/src/main/res/layout/m.xml`, text: '<TextView tools:text="@string/kj_dead" />' }],
    );
    expect(names(dead)).toEqual(['string/kj_dead']);

    const kept = find(
      { [VALUES]: res('<string name="kj_kept">x</string>') },
      [{ path: `${APP}/src/main/res/values/keep.xml`, text: '<resources tools:keep="@string/kj_kept" />' }],
    );
    expect(kept).toEqual([]);
  });

  it('une référence depuis le manifest sauve', () => {
    const found = find(
      { [VALUES]: res('<string name="app_label">x</string>') },
      [{ path: `${APP}/src/main/AndroidManifest.xml`, text: '<application android:label="@string/app_label" />' }],
    );
    expect(found).toEqual([]);
  });

  it('une valeur qui contient son propre nom n’est pas une auto-référence', () => {
    expect(names(find({ [VALUES]: res('<string name="hello">hello world</string>') })))
      .toEqual(['string/hello']);
  });
});

describe.skipIf(!mod || !scanner)('performance', () => {
  it('2 500 déclarations contre 3 000 sources reste sous la seconde', () => {
    const body = Array.from({ length: 2500 }, (_, i) => `<string name="kj_${i}">v</string>`).join('\n');
    const declarations = scanner.collectValueKeyDeclarations(VALUES, res(body), [APP]);
    expect(declarations).toHaveLength(2500);

    const sources = Array.from({ length: 3000 }, (_, i) => ({
      path: `${APP}/src/main/kotlin/F${i}.kt`,
      text: `class F${i} {\n  val s = R.string.kj_${i % 1200}\n}\n`,
    }));

    const start = performance.now();
    const found = mod.findUnusedResourceKeys({
      declarations, sources, modulesWithCode: [APP],
    });
    const elapsed = performance.now() - start;

    expect(found).toHaveLength(1300);   // 2500 déclarées, 1200 référencées
    expect(elapsed).toBeLessThan(1000); // borne : l'algo ne doit pas être en O(clés × fichiers)
  });
});
