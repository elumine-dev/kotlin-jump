import { describe, it, expect } from 'vitest';
import { planifier } from '../../../src/cleanup/planner';
import type { CoupePlanifiee } from '../../../src/cleanup/simulation';

/**
 * Campagne de nettoyage, T3 : le planificateur.
 *
 * Il ne lit aucun fichier : il recoit les coupes de la simulation, avec leur
 * ronde, et rend des lots. Vague 1 = ronde 1, zero reference aujourd hui.
 * Vague 2 = le reste, chaque coupe pointant les coupes anterieures dont le
 * texte retire la nommait. Un lot ne separe jamais ce qui doit partir
 * ensemble, et ne depasse pas son budget sauf quand une composante seule le
 * depasse.
 */

const RACINE = '/w';
const APP = '/w/app/src/main/java/com/example/kiosk';
const UI = '/w/core/ui/src/main/java/com/example/portal';
const MODULES = ['/w/app', '/w/core/ui'];

let n = 0;
const c = (x: Partial<CoupePlanifiee> & { path: string }): CoupePlanifiee => ({
  cle: `${x.famille ?? 'symboles'}\t${x.path}\t${x.quoi ?? `n${++n}`}`,
  round: 1, line: 0, famille: 'symboles', quoi: x.quoi ?? '', extrait: x.extrait ?? `class ${x.quoi ?? 'X'} {}\n`, texte: '',
  ...x,
});
const plan = (coupes: CoupePlanifiee[], extra: Record<string, unknown> = {}) =>
  planifier(coupes, { racine: RACINE, moduleDirs: MODULES, ...extra });
const lotDe = (p: ReturnType<typeof planifier>, cle: string) => p.lots.find(l => l.coupes.some(k => k.cle === cle))!;

describe('T3, vagues et declencheurs', () => {
  it('une coupe de ronde 2 pointe la coupe de ronde 1 dont le texte retire la nommait', () => {
    const a = c({ path: `${APP}/Screen.kt`, quoi: 'Screen', extrait: 'class Screen {\n    fun go() = Helper().run()\n}\n' });
    const b = c({ path: `${APP}/Helper.kt`, quoi: 'Helper', round: 2 });
    const p = plan([a, b]);
    expect(lotDe(p, a.cle).wave).toBe(1);
    expect(lotDe(p, b.cle).wave).toBe(2);
    expect(lotDe(p, b.cle).coupes[0].declencheurs).toEqual([a.cle]);
    expect(p.sansDeclencheur).toEqual([]);
  });

  it('une coupe de ronde 2 que rien n explique est listee a part, en vague 2', () => {
    const b = c({ path: `${APP}/Lost.kt`, quoi: 'Lost', round: 2 });
    const p = plan([c({ path: `${APP}/Other.kt`, quoi: 'Other' }), b]);
    expect(lotDe(p, b.cle).wave).toBe(2);
    expect(p.sansDeclencheur).toEqual([b.cle]);
  });

  it('une entree de baseline perimee est declenchee par la suppression du fichier qu elle nomme', () => {
    const fichier = c({ path: `${APP}/ExoHelper.kt`, famille: 'fichiers', extrait: 'package k\n\nobject ExoHelper {\n    fun go() = 1\n}\n', contenait: ['ExoHelper'] });
    const entree = c({ path: '/w/config/detekt/baseline.xml', famille: 'baseline', round: 2,
      quoi: 'stale baseline entry for ExoHelper.kt, which no longer exists', extrait: '    <ID>MagicNumber:ExoHelper.kt$ExoHelper$1</ID>\n', preuve: { verdict: 'stale' } });
    const p = plan([fichier, entree], { moduleDirs: [...MODULES, '/w'] });
    expect(lotDe(p, entree.cle).coupes[0].declencheurs).toEqual([fichier.cle]);
    expect(p.sansDeclencheur).toEqual([]);
  });

  it('la baseline est declenchee par le fichier meme quand la classe ne porte pas le nom du fichier', () => {
    // Sur un vrai projet : `DeleteEverythingTaskListener.kt` declare `DeleteEverthingTaskListener`, une faute de frappe.
    const fichier = c({ path: `${APP}/ExoHelper.kt`, famille: 'fichiers', extrait: 'package k\n\nobject ExoHelpr {\n    fun go() = 1\n}\n', contenait: ['ExoHelpr'] });
    const entree = c({ path: '/w/config/detekt/baseline.xml', famille: 'baseline', round: 2,
      quoi: 'stale baseline entry for ExoHelper.kt, which no longer exists', extrait: '    <ID>MagicNumber:ExoHelper.kt$ExoHelpr$1</ID>\n', preuve: { verdict: 'stale' } });
    const p = plan([fichier, entree], { moduleDirs: [...MODULES, '/w'] });
    expect(lotDe(p, entree.cle).coupes[0].declencheurs).toEqual([fichier.cle]);
  });

  it('un fichier supprime declenche par son texte entier', () => {
    const fichier = c({ path: `${APP}/Dead.kt`, famille: 'fichiers', extrait: 'package k\n\nclass Dead {\n    val t = R.string.kiosk_title\n}\n', contenait: ['Dead'] });
    const cle = c({ path: '/w/app/src/main/res/values/strings.xml', famille: 'cles', quoi: 'string/kiosk_title', round: 2, extrait: '    <string name="kiosk_title">K</string>\n' });
    const p = plan([fichier, cle]);
    expect(lotDe(p, cle.cle).coupes[0].declencheurs).toEqual([fichier.cle]);
  });
});

describe('T3, ce qui voyage ensemble', () => {
  it('un import perime ou une injection suit sa declaration dans le meme lot', () => {
    const decl = c({ path: `${APP}/Foo.kt`, quoi: 'Foo' });
    const imp = c({ path: `${APP}/Bar.kt`, famille: 'balayage', extrait: 'import com.example.kiosk.Foo\n', preuve: { verdict: 'cascade', suit: 'Foo' } });
    const inj = c({ path: `${UI}/Component.kt`, famille: 'injections', quoi: 'Foo', extrait: '    fun inject(target: Foo)\n', preuve: { verdict: 'cascade', suit: 'Foo' } });
    const p = plan([decl, imp, inj], { maxFilesPerBatch: 1 });
    expect(lotDe(p, imp.cle).id).toBe(lotDe(p, decl.cle).id);
    expect(lotDe(p, inj.cle).id).toBe(lotDe(p, decl.cle).id);
  });

  it('un ilot est indivisible, meme sous un budget d un fichier', () => {
    const ping = c({ path: `${APP}/Ping.kt`, famille: 'ilots', quoi: 'Ping', preuve: { verdict: 'island', gardePar: ['go'] } });
    const go = c({ path: `${APP}/Pong.kt`, famille: 'ilots', quoi: 'go', preuve: { verdict: 'island', gardePar: ['Ping'] } });
    const p = plan([ping, go], { maxFilesPerBatch: 1 });
    expect(lotDe(p, ping.cle).id).toBe(lotDe(p, go.cle).id);
  });

  it('un import orphelin dont la declaration porte un autre nom voyage avec les coupes de son fichier', () => {
    // `import a.b.Util` orpheline en ronde 2 parce que la seule fonction qui
    // l utilisait part en ronde 2 : rien ne s appelle Util, et l import ne
    // doit pas se compter lui meme comme la declaration qu il suit.
    const appelant = c({ path: `${APP}/Caller.kt`, quoi: 'Caller', extrait: 'class Caller {\n    fun go() = Screen().helper()\n}\n' });
    const fonction = c({ path: `${APP}/Screen.kt`, famille: 'balayage', round: 2, extrait: '    fun helper() = Util.go()\n', preuve: { verdict: 'unreferenced', nom: 'helper' } });
    const imp = c({ path: `${APP}/Screen.kt`, famille: 'imports', round: 2, extrait: 'import com.example.Util\n', preuve: { verdict: 'cascade', suit: 'Util' } });
    const p = plan([appelant, fonction, imp]);
    expect(lotDe(p, imp.cle).id).toBe(lotDe(p, fonction.cle).id);
    expect(p.sansDeclencheur).toEqual([]);
  });

  it('les coupes d un meme fichier et d une meme ronde ne se separent jamais en deux lots', () => {
    const a = c({ path: `${APP}/Big.kt`, quoi: 'Alpha', extrait: 'class Alpha {\n    fun a() = 1\n}\n' });
    const b = c({ path: `${APP}/Big.kt`, quoi: 'Beta', extrait: 'class Beta {\n    fun b() = 1\n}\n' });
    const p = plan([a, b], { maxLinesPerBatch: 3 });
    expect(lotDe(p, a.cle).id).toBe(lotDe(p, b.cle).id);
  });

  it('un contrat et ses surcharges, une cle et ses variantes', () => {
    const k1 = c({ path: `${UI}/Api.kt`, famille: 'contrats', quoi: 'com.example.Api.fetch' });
    const k2 = c({ path: `${APP}/ApiImpl.kt`, famille: 'contrats', quoi: 'com.example.Api.fetch' });
    const r1 = c({ path: '/w/app/src/main/res/xml/remote_config_defaults.xml', famille: 'remoteconfig', quoi: 'flag_x' });
    const r2 = c({ path: '/w/app/src/debug/res/xml/remote_config_defaults.xml', famille: 'remoteconfig', quoi: 'flag_x' });
    const p = plan([k1, k2, r1, r2], { maxFilesPerBatch: 1 });
    expect(lotDe(p, k1.cle).id).toBe(lotDe(p, k2.cle).id);
    expect(lotDe(p, r1.cle).id).toBe(lotDe(p, r2.cle).id);
  });

  it('une declaration dont le fichier part voyage avec le fichier, et seul le fichier compte', () => {
    const decl = c({ path: `${APP}/Dead.kt`, quoi: 'Dead', fichierSupprime: true, extrait: 'class Dead {\n}\n' });
    const fichier = c({ path: `${APP}/Dead.kt`, famille: 'fichiers', extrait: 'package k\n\nclass Dead {\n}\n', contenait: ['Dead'] });
    const p = plan([decl, fichier]);
    const lot = lotDe(p, decl.cle);
    expect(lot.id).toBe(lotDe(p, fichier.cle).id);
    expect(lot.lignes).toBe(4);
    expect(lot.fichiers).toEqual([`${APP}/Dead.kt`]);
  });
});

describe('T3, lots, budget et ordre', () => {
  const une = (i: number, dir = APP) => c({ path: `${dir}/C${i}.kt`, quoi: `C${i}`, extrait: `class C${i} {\n    fun a() = 1\n}\n` });

  it('emballe sous le budget de fichiers, et une composante trop grosse fait son propre lot', () => {
    const grosse = ['A', 'B', 'C'].map(x => c({ path: `${APP}/${x}.kt`, famille: 'contrats', quoi: 'com.example.Big.run' }));
    const p = plan([une(1), une(2), une(3), une(4), une(5), ...grosse], { maxFilesPerBatch: 2 });
    const simples = p.lots.filter(l => l.groupe.kind !== 'oversized');
    expect(simples.map(l => l.fichiers.length).sort()).toEqual([1, 2, 2]);
    const gros = p.lots.find(l => l.groupe.kind === 'oversized')!;
    expect(gros.fichiers).toHaveLength(3);
  });

  it('emballe aussi sous le budget de lignes', () => {
    const p = plan([une(1), une(2), une(3)], { maxLinesPerBatch: 4 });
    expect(p.lots).toHaveLength(3);
  });

  it('groupe par repertoire de module, etiquette relative a la racine, et la racine se nomme root', () => {
    const p = plan([une(1), une(2, UI), c({ path: '/w/gradle/libs.versions.toml', famille: 'alias', quoi: 'old-lib', extrait: 'old-lib = "a:b:1"\n' })],
      { moduleDirs: [...MODULES, '/w'] });
    expect(p.lots.map(l => l.groupe.label).sort()).toEqual(['app', 'core/ui', 'root']);
    expect(p.lots.every(l => l.groupe.kind === 'module')).toBe(true);
  });

  it('les fichiers d assets entiers vont dans leur propre lot et ne pesent pas dans les lignes', () => {
    const lottie = c({ path: '/w/app/src/main/assets/anim.json', famille: 'ressources', extrait: '{\n'.repeat(500), preuve: { verdict: 'unreferenced' } });
    const p = plan([une(1), lottie], { maxLinesPerBatch: 10 });
    expect(lotDe(p, lottie.cle).id).not.toBe(lotDe(p, une(1).cle).id);
    expect(lotDe(p, lottie.cle).lignes).toBe(0);
    expect(lotDe(p, lottie.cle).assets).toBe(1);
  });

  it('ordre : vague, puis palier, puis taille decroissante', () => {
    const grosse = c({ path: `${APP}/G.kt`, quoi: 'G', extrait: 'class G {\n'.repeat(10) });
    const petite = une(1);
    const douteuse = c({ path: '/w/app/src/main/res/values/strings.xml', famille: 'cles', quoi: 'string/s', extrait: '    <string name="s">x</string>\n' });
    const tard = c({ path: `${APP}/Late.kt`, quoi: 'Late', round: 2 });
    const p = plan([tard, douteuse, petite, grosse], { maxFilesPerBatch: 1 });
    expect(p.lots.map(l => l.coupes[0].cle)).toEqual([grosse.cle, petite.cle, douteuse.cle, tard.cle]);
    expect(p.lots.map(l => l.id)).toEqual([1, 2, 3, 4]);
  });
});

describe('T3, paliers et doutes', () => {
  it('palier 1 : sans mention de test et sans doute', () => {
    const p = plan([c({ path: `${APP}/Clean.kt`, quoi: 'Clean', preuve: { verdict: 'unreferenced', mentions: { tests: 0 } } })]);
    expect(p.lots[0].palier).toBe(1);
    expect(p.lots[0].coupes[0].doutes).toEqual([]);
  });

  it('une cle de ressource, une cle Remote Config, un homonyme, un suffixe de cadre : palier 2 et le doute nomme', () => {
    const cas: [CoupePlanifiee, string][] = [
      [c({ path: '/w/app/src/main/res/values/strings.xml', famille: 'cles', quoi: 'string/s' }), 'resource-key'],
      [c({ path: '/w/app/src/main/res/xml/remote_config_defaults.xml', famille: 'remoteconfig', quoi: 'k' }), 'remote-config-key'],
      [c({ path: `${APP}/Twin.kt`, quoi: 'Twin', preuve: { verdict: 'unreferenced', homonyme: true } }), 'homonym'],
      [c({ path: `${APP}/OldFragment.kt`, quoi: 'OldFragment' }), 'framework-suffix'],
    ];
    for (const [coupe, doute] of cas) {
      const p = plan([coupe]);
      expect(p.lots[0].palier).toBe(2);
      expect(p.lots[0].coupes[0].doutes).toContain(doute);
    }
  });


  it('une mention de test garde la coupe hors du palier 1', () => {
    const p = plan([c({ path: `${APP}/T.kt`, quoi: 'T', preuve: { verdict: 'unreferenced', mentions: { tests: 2 } } })]);
    expect(p.lots[0].palier).toBe(2);
  });
});

describe('T3, la cause en titre', () => {
  const racines = (n: number) => Array.from({ length: n }, (_, i) => c({ path: `${APP}/R${i}.kt`, quoi: `R${i}` }));
  const cause = (ticket: string) => ({ kind: 'orphan' as const, label: `${ticket} (pull request #7)`, ticket, pr: '7', date: '2026-01-01', author: 'Ann' });

  it('a 60 % des racines, la cause donne son titre au lot', () => {
    const r = racines(5);
    const causes = new Map(r.slice(0, 3).map(x => [x.cle, cause('TK-123')]));
    const p = plan(r, { causes });
    expect(p.lots).toHaveLength(1);
    expect(p.lots[0].groupe.kind).toBe('cause');
    expect(p.lots[0].groupe.label).toBe('TK-123 (pull request #7)');
  });

  it('a 40 %, le module garde le titre et la cause reste une etiquette par coupe', () => {
    const r = racines(5);
    const causes = new Map(r.slice(0, 2).map(x => [x.cle, cause('TK-123')]));
    const p = plan(r, { causes });
    expect(p.lots[0].groupe.kind).toBe('module');
    expect(p.lots[0].coupes.filter(k => k.cause?.ticket === 'TK-123')).toHaveLength(2);
  });

  it('une ressource ou une locale ne porte pas de cause : un nom de fichier comme colors ne nomme pas un ticket', () => {
    const res = c({ path: '/w/app/src/main/res/values/colors.xml', famille: 'ressources', extrait: '<resources/>\n', preuve: { verdict: 'unreferenced' } });
    const causes = new Map([[res.cle, cause('TK-9')]]);
    const p = plan([res], { causes });
    expect(p.lots[0].groupe.kind).toBe('module');
    expect(p.lots[0].coupes[0].cause).toBeUndefined();
  });

  it('groupBy cause : les lots se forment par cause, le module en repli', () => {
    const r = racines(4);
    const causes = new Map([[r[0].cle, cause('TK-1')], [r[1].cle, cause('TK-1')], [r[2].cle, cause('TK-2')]]);
    const p = plan(r, { causes, groupBy: 'cause' });
    expect(p.lots.map(l => l.groupe.label).sort()).toEqual(['TK-1 (pull request #7)', 'TK-2 (pull request #7)', 'app']);
  });
});

describe('T3b, ce qui voyage ensemble dans une ronde', () => {
  it('un gardien trouve mort par les symboles emporte les membres d ilot qu il tenait, meme dans un autre module', () => {
    // Sur la reference : trois helpers tenus par une classe que le detecteur de
    // symboles trouvait morte lui aussi. Separes en deux lots par le budget, le
    // lot des helpers laissait le constructeur du gardien sans ses types : KSP
    // refusait de compiler. Un gardien n est pas forcement un membre d ilot.
    const gardien = c({ path: `${UI}/DeviceHelper.kt`, quoi: 'DeviceHelper', extrait: 'class DeviceHelper(private val disk: DiskHelper) {\n}\n' });
    const membre = c({ path: `${APP}/DiskHelper.kt`, famille: 'ilots', quoi: 'DiskHelper', extrait: 'class DiskHelper {\n}\n',
      preuve: { verdict: 'island', gardePar: ['DeviceHelper'] } });
    const p = plan([gardien, membre]);
    expect(lotDe(p, gardien.cle)).toBe(lotDe(p, membre.cle));
  });

  it('une coupe dont le texte retire nomme une declaration de la meme ronde part avec elle', () => {
    const appelant = c({ path: `${APP}/Screen.kt`, quoi: 'Screen', extrait: 'class Screen {\n    fun go() = Helper().run()\n}\n' });
    const helper = c({ path: `${UI}/Helper.kt`, quoi: 'Helper', extrait: 'class Helper {\n    fun run() = 1\n}\n' });
    const p = plan([appelant, helper]);
    expect(lotDe(p, appelant.cle)).toBe(lotDe(p, helper.cle));
    expect(p.lots).toHaveLength(1);
  });

  it('un nom de membre ne soude pas tout ce qui le prononce', () => {
    const membre = c({ path: `${APP}/Repo.kt`, famille: 'membres', quoi: 'run', extrait: '    fun run() = 1\n' });
    const autre = c({ path: `${UI}/Job.kt`, quoi: 'Job', extrait: 'class Job {\n    fun start() = worker.run()\n}\n' });
    const p = plan([membre, autre]);
    expect(lotDe(p, membre.cle)).not.toBe(lotDe(p, autre.cle));
  });

  it('une declaration de ronde 2 ne voyage pas avec la coupe de ronde 1 qui la nommait : elle la suit', () => {
    const a = c({ path: `${APP}/Screen.kt`, quoi: 'Screen', extrait: 'class Screen {\n    fun go() = Helper().run()\n}\n' });
    const b = c({ path: `${UI}/Helper.kt`, quoi: 'Helper', round: 2 });
    const p = plan([a, b]);
    expect(lotDe(p, a.cle)).not.toBe(lotDe(p, b.cle));
    expect(lotDe(p, b.cle).coupes[0].declencheurs).toEqual([a.cle]);
  });
});

describe('T3c, les mentions reelles au texte d origine', () => {
  const SCREEN = `${APP}/Screen.kt`;
  const screen = () => c({ path: SCREEN, quoi: 'Screen', extrait: 'class Screen {\n}\n', preuve: { verdict: 'unreferenced', mentions: { tests: 0 } } });
  const index = (brut: string[], code: string[], declare: string[] = [SCREEN], exclus: string[] = []) => ({
    brut: new Map([['Screen', new Set([SCREEN, ...brut])]]),
    code: new Map([['Screen', new Set([SCREEN, ...code])]]),
    declare: new Map([['Screen', new Set(declare)]]),
    exclus: new Set(exclus),
  });

  it('une mention en code que rien n explique est un doute, et la coupe passe au palier 2', () => {
    const s = screen();
    const p = plan([s], { mentions: index([`${APP}/Other.kt`], [`${APP}/Other.kt`]) });
    const k = lotDe(p, s.cle).coupes[0];
    expect(k.mentions).toEqual([{ path: `${APP}/Other.kt`, kind: 'uncounted' }]);
    expect(k.doutes).toContain('uncounted-mention');
    expect(k.palier).toBe(2);
  });

  it('un commentaire, une coupe de ce plan, un homonyme declare et un source set orphelin sont expliques, sans doute', () => {
    const s = screen();
    const nav = c({ path: `${APP}/Nav.kt`, famille: 'balayage', extrait: 'import com.example.kiosk.Screen\n', preuve: { verdict: 'cascade', suit: 'Screen' } });
    const DOC = `${APP}/Doc.kt`, TWIN = `${UI}/Screen.kt`, SAVED = '/w/app/src/savedAndroidTest/java/Saved.kt';
    const p = plan([s, nav], { mentions: index([DOC, nav.path, TWIN, SAVED], [nav.path, TWIN, SAVED], [SCREEN, TWIN], [SAVED]) });
    const k = lotDe(p, s.cle).coupes.find(x => x.cle === s.cle)!;
    expect(k.mentions).toEqual([
      { path: DOC, kind: 'comment-only' },
      { path: nav.path, kind: 'cut', cle: nav.cle },
      { path: SAVED, kind: 'excluded' },
      { path: TWIN, kind: 'homonym' },
    ]);
    expect(k.doutes).toEqual([]);
    expect(k.palier).toBe(1);
  });

  it('les mentions d un membre ailleurs sont des membres d autres classes, pas un doute', () => {
    const m = c({ path: `${APP}/Repo.kt`, famille: 'membres', quoi: 'observe', extrait: '    fun observe() = 1\n' });
    const partout = new Map([['observe', new Set([m.path, `${UI}/Other.kt`])]]);
    const p = plan([m], { mentions: { brut: partout, code: partout, declare: new Map(), exclus: new Set() } });
    const k = lotDe(p, m.cle).coupes[0];
    expect(k.mentions).toEqual([{ path: `${UI}/Other.kt`, kind: 'other-class' }]);
    expect(k.doutes).toEqual([]);
  });

  it('sans index de mentions, rien ne change : pas de champ, pas de doute', () => {
    const s = screen();
    const k = lotDe(plan([s]), s.cle).coupes[0];
    expect(k.mentions).toBeUndefined();
    expect(k.doutes).toEqual([]);
  });

  it('la declaration d un evenement poste, coupee a la ronde suivante, explique sa mention ; une classe declaree sans coupe est dite declaree la', () => {
    // Sur la reference : le poste part en ronde 1, la classe de l evenement en
    // ronde 2. Une coupe plus tardive qui EST la chose nommee n est pas un
    // texte qui pointera dans le vide : c est la suite de la coupe.
    const poste = c({ path: `${APP}/Service.kt`, famille: 'evenements', quoi: 'DoneEvent', extrait: '        bus.post(DoneEvent())\n', preuve: { verdict: 'unheard' } });
    const classe = c({ path: `${APP}/DoneEvent.kt`, quoi: 'DoneEvent', round: 2, extrait: 'class DoneEvent\n' });
    const autre = c({ path: `${APP}/Sink.kt`, famille: 'evenements', quoi: 'LostEvent', extrait: '        bus.post(LostEvent())\n', preuve: { verdict: 'unheard' } });
    const WRAPPER = `${APP}/Wrapper.kt`;
    const idx = {
      brut: new Map([['DoneEvent', new Set([poste.path, classe.path])], ['LostEvent', new Set([autre.path, WRAPPER])]]),
      code: new Map([['DoneEvent', new Set([poste.path, classe.path])], ['LostEvent', new Set([autre.path, WRAPPER])]]),
      declare: new Map([['DoneEvent', new Set([classe.path])], ['LostEvent', new Set([WRAPPER])]]),
      exclus: new Set<string>(),
    };
    const p = plan([poste, classe, autre], { mentions: idx });
    expect(lotDe(p, poste.cle).coupes.find(k => k.cle === poste.cle)!.mentions).toEqual([{ path: classe.path, kind: 'cut', cle: classe.cle }]);
    expect(lotDe(p, autre.cle).coupes.find(k => k.cle === autre.cle)!.mentions).toEqual([{ path: WRAPPER, kind: 'declared' }]);
    expect(p.lots.flatMap(l => l.coupes).every(k => !k.doutes.includes('uncounted-mention'))).toBe(true);
  });

  it('une entree de baseline qui nomme la coupe est une entree de baseline, pas une mention a verifier', () => {
    const s = screen();
    const BASELINE = '/w/config/detekt/baseline.xml';
    const partout = new Map([['Screen', new Set([SCREEN, BASELINE])]]);
    const p = plan([s], { mentions: { brut: partout, code: partout, declare: new Map(), exclus: new Set() } });
    const k = lotDe(p, s.cle).coupes[0];
    expect(k.mentions).toEqual([{ path: BASELINE, kind: 'baseline' }]);
    expect(k.doutes).toEqual([]);
  });

  it('un nom indexe que rien ne nomme a une liste vide, pas d absence : la fiche dira 0 fichiers', () => {
    const cle = c({ path: '/w/app/src/main/res/values/strings.xml', famille: 'cles', quoi: 'string/ghost', extrait: '    <string name="ghost">G</string>\n' });
    const idx = { brut: new Map(), code: new Map(), declare: new Map(), exclus: new Set<string>(), noms: new Set(['string/ghost']) };
    expect(lotDe(plan([cle], { mentions: idx }), cle.cle).coupes[0].mentions).toEqual([]);
    const sans = { ...idx, noms: new Set<string>() };
    expect(lotDe(plan([cle], { mentions: sans }), cle.cle).coupes[0].mentions).toBeUndefined();
  });

  it('une cle declaree aussi dans un autre module : ses mentions dans ce module sont celles de l autre cle', () => {
    const cle = c({ path: '/w/app/src/main/res/values/strings.xml', famille: 'cles', quoi: 'string/consulter', extrait: '    <string name="consulter">Lire</string>\n' });
    const AUTRE_DECL = '/w/core/ui/src/main/res/values/strings.xml', LAYOUT = '/w/core/ui/src/main/res/layout/card.xml';
    const idx = {
      brut: new Map([['string/consulter', new Set([LAYOUT])]]),
      code: new Map([['string/consulter', new Set([LAYOUT])]]),
      declare: new Map([['string/consulter', new Set([cle.path, AUTRE_DECL])]]),
      exclus: new Set<string>(),
    };
    const k = lotDe(plan([cle], { mentions: idx }), cle.cle).coupes[0];
    expect(k.mentions).toEqual([{ path: LAYOUT, kind: 'homonym', module: 'core/ui' }]);
    expect(k.doutes).toEqual(['resource-key']);
  });
});
