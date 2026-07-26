import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { REPO_ROOT, DEMO_ROOT } from './harness';

/**
 * Garde permanente du process de demos.
 *
 * Kevin, 2026-07-25 : « certains gifs, tu dis que tu fais quelque chose,
 * mais il n'y a rien qui apparaît ». Trois causes ont été trouvées :
 *   1. la feature n'était pas exécutée (geste simulé) ;
 *   2. elle n'avait rien rendu au moment de la caption ;
 *   3. elle rendait hors du cadre visible.
 * Ces tests empêchent le retour des causes 1 et 3 ; la cause 2 est bloquée
 * à l'enregistrement par les assertions du Stage.
 */

const DEMOS_DIR = path.join(REPO_ROOT, 'scripts', 'demo', 'demos');
/**
 * Cadre 1040 px, gouttière ~55 px, Menlo 18 px ≈ 10,8 px/caractère → ~91
 * colonnes. Le chiffre est CALIBRÉ, pas mesuré au pixel : la demo
 * `private-file-isolation` pointe la colonne 90 depuis des mois et Kevin
 * l'a validée, ce qui borne l'estimation par le bas. On garde 88 comme
 * cible de conception (marge de sécurité) et 92 comme limite dure.
 */
const TARGET_COLS = 88;
const HARD_LIMIT_COLS = 92;

const demoFiles = readdirSync(DEMOS_DIR).filter(f => f.endsWith('.demo.ts'));

/** Demos de la vague KJ — celles couvertes par le nouveau process. */
const KJ_DEMOS = [
  'named-arguments', 'postfix-completion', 'live-templates', 'surround-with',
  'smart-join-lines', 'extract-string-resource', 'screen-flow-map', 'udf-xray',
  'compose-outline', 'lifecycle-pairing', 'dispatcher-lens', 'room-migration-drift',
  'unused-imports', 'resource-usage-badges', 'dependency-usage-badges',
  'manifest-necessity', 'resource-shadowing', 'reverse-string-map',
  'method-separators', 'android-project-view', 'recent-locations',
].map(n => `${n}.demo.ts`);

describe('Process demos — pertinence prouvée', () => {
  it('chaque demo KJ contient au moins une assertion de rendu', () => {
    const sans = KJ_DEMOS.filter(f => {
      const src = readFileSync(path.join(DEMOS_DIR, f), 'utf8');
      return !/stage\.assert(Visible|Decorations|Diagnostics|CodeLens|Hover|Text|Panel)\(/.test(src);
    });
    expect(sans, 'demos sans preuve que la feature rend quelque chose').toEqual([]);
  });

  it('aucune caption ne promet un résultat avant son assertion', () => {
    // La caption de résultat est la DERNIÈRE du script : elle doit venir
    // après au moins une assertion, sinon elle annonce l'invérifié.
    const fautives = KJ_DEMOS.filter(f => {
      const src = readFileSync(path.join(DEMOS_DIR, f), 'utf8');
      const lastCaption = src.lastIndexOf('stage.caption(');
      const firstAssert = src.search(/stage\.assert\w+\(/);
      return firstAssert < 0 || firstAssert > lastCaption;
    });
    expect(fautives, 'caption finale posée avant toute assertion').toEqual([]);
  });
});

describe('Process demos — voix des captions (anti-IA)', () => {
  const BANNED = [
    'unlock', 'seamless', 'leverage', 'comprehensive', 'effortlessly',
    'robuste', 'exploiter', 'incontournable', 'véritable',
  ];

  it('aucun tiret cadratin comme connecteur dans les captions KJ', () => {
    const fautives: string[] = [];
    for (const f of KJ_DEMOS) {
      for (const line of readFileSync(path.join(DEMOS_DIR, f), 'utf8').split('\n')) {
        if (line.includes('stage.caption(') && line.includes('—')) {
          fautives.push(`${f}: ${line.trim().slice(0, 60)}`);
        }
      }
    }
    expect(fautives, 'tell anti-IA n° 1 : em-dash connecteur').toEqual([]);
  });

  it('aucun mot de la liste noire dans les captions KJ', () => {
    const fautives: string[] = [];
    for (const f of KJ_DEMOS) {
      for (const line of readFileSync(path.join(DEMOS_DIR, f), 'utf8').split('\n')) {
        if (!line.includes('stage.caption(')) continue;
        const hit = BANNED.find(w => line.toLowerCase().includes(w));
        if (hit) fautives.push(`${f}: « ${hit} »`);
      }
    }
    expect(fautives).toEqual([]);
  });
});

describe('Process demos — ancrages dans le cadre', () => {
  it('aucun callout ne vise une colonne hors du cadre visible', () => {
    const fautifs: string[] = [];
    for (const f of demoFiles) {
      const src = readFileSync(path.join(DEMOS_DIR, f), 'utf8');
      const re = /(calloutAt|dwellOn)\(\{\s*line:\s*(\d+),\s*column:\s*(\d+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const col = Number(m[3]);
        // Limite dure pour toutes les demos ; les demos KJ visent en plus
        // la cible de conception, plus conservatrice.
        const limit = KJ_DEMOS.includes(f) ? TARGET_COLS : HARD_LIMIT_COLS;
        if (col > limit) {
          fautifs.push(`${f}: ${m[1]} colonne ${col} > ${limit} visibles`);
        }
      }
    }
    expect(fautifs, 'flèche hors du cadre : le spectateur ne verra rien').toEqual([]);
  });

  it('aucun callout ne coupe une ligne ni ne déborde du cadre', () => {
    // Une décoration `after` posée au milieu du texte INSÈRE le label et
    // coupe le code en deux. calloutAt ancre donc en fin de ligne ; ce test
    // vérifie que le label qui en résulte tient dans le cadre.
    const fautifs: string[] = [];
    for (const f of KJ_DEMOS) {
      const src = readFileSync(path.join(DEMOS_DIR, f), 'utf8');
      const opens = [...src.matchAll(/openFile\(\s*'([^']+)'/g)].map(m => [m.index ?? 0, m[1]] as const);
      for (const m of src.matchAll(/calloutAt\(\{\s*line:\s*(\d+),[^}]*\},\s*'([^']*)'/g)) {
        const line = Number(m[1]);
        const label = m[2];
        const prev = opens.filter(o => o[0] < (m.index ?? 0)).pop();
        if (!prev) continue;
        const fixture = path.join(DEMO_ROOT, prev[1]);
        if (!existsSync(fixture)) continue;
        const lines = readFileSync(fixture, 'utf8').split('\n');
        if (line >= lines.length) {
          fautifs.push(`${f}: ligne ${line} inexistante`);
          continue;
        }
        const end = lines[line].length + 3 + label.length;
        if (end > HARD_LIMIT_COLS) {
          fautifs.push(`${f}: « ${label} » finit colonne ${end} > ${HARD_LIMIT_COLS}`);
        }
      }
    }
    expect(fautifs, 'callout illisible : hors cadre').toEqual([]);
  });

  it('aucune chaîne assertText ne préexiste dans les fixtures au repos', () => {
    // Trou constaté le 25/07 (named-arguments) : le commentaire de la fixture
    // contenait mot pour mot le résultat attendu, et l'assertion passait
    // alors que le refactor échouait à l'écran (popup « No code actions »).
    // Une chaîne assertée doit être PRODUITE par la feature, donc absente
    // du workspace au repos.
    const fautifs: string[] = [];
    const fixtureCache = new Map<string, string>();
    const readFixture = (rel: string): string | undefined => {
      if (!fixtureCache.has(rel)) {
        const abs = path.join(DEMO_ROOT, rel);
        fixtureCache.set(rel, existsSync(abs) ? readFileSync(abs, 'utf8') : '');
      }
      return fixtureCache.get(rel);
    };
    for (const f of KJ_DEMOS) {
      const src = readFileSync(path.join(DEMOS_DIR, f), 'utf8');
      const opened = [...src.matchAll(/openFile\(\s*'([^']+)'/g)].map(m => m[1]);
      for (const m of src.matchAll(/assertText\(\s*'[^']*',\s*'((?:\\.|[^'\\])*)'/gs)) {
        const needle = m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        for (const rel of opened) {
          const content = readFixture(rel);
          if (content && content.includes(needle)) {
            fautifs.push(`${f}: « ${needle.trim().slice(0, 50)} » déjà dans ${rel}`);
          }
        }
      }
    }
    expect(fautifs, 'assertion satisfiable sans que la feature agisse').toEqual([]);
  });

  it('les fichiers ciblés par les demos KJ existent', () => {
    const manquants: string[] = [];
    for (const f of KJ_DEMOS) {
      const src = readFileSync(path.join(DEMOS_DIR, f), 'utf8');
      for (const m of src.matchAll(/openFile\(\s*'([^']+)'/g)) {
        if (!existsSync(path.join(DEMO_ROOT, m[1]))) manquants.push(`${f} → ${m[1]}`);
      }
    }
    expect(manquants).toEqual([]);
  });
});
