import { describe, it, expect } from 'vitest';
import { planifier } from '../../../src/cleanup/planner';
import { lotMarkdown, planJson, planMarkdown, titre } from '../../../src/cleanup/exports';
import type { CoupePlanifiee } from '../../../src/cleanup/simulation';

/**
 * Campagne de nettoyage, T4 : ce que le plan ecrit.
 *
 * Un fichier par lot : la premiere ligne est le titre du commit, le bloc qui
 * suit est son corps, une ligne de preuve par coupe dans les termes exacts
 * que l outil peut defendre. Puis « Verify it yourself », une commande par
 * coupe, et les canaux lus. Rien n est en francais : le depot est public et
 * anglais ; le francais est l affaire de celui qui colle.
 */

const RACINE = '/w';
const APP = '/w/app/src/main/java/com/example/kiosk';
let n = 0;
const c = (x: Partial<CoupePlanifiee> & { path: string }): CoupePlanifiee => ({
  cle: `${x.famille ?? 'symboles'}\t${x.path}\t${x.quoi ?? `n${++n}`}`,
  round: 1, line: 4, famille: 'symboles', quoi: x.quoi ?? '', extrait: x.extrait ?? `class ${x.quoi ?? 'X'} {\n}\n`, texte: '',
  ...x,
});
const entete = { racine: RACINE, head: 'abc1234', branch: 'develop', generatedAt: new Date('2026-10-25T10:00:00Z') };
const simulation = { rondes: 2, complete: true, ecartes: [] as string[], canaux: ['Kotlin and Java sources', 'XML resources, layouts and binding attributes'], nonJuges: ['drawable resource files: Remove Everything Unused never deletes them'] };

const screen = c({ path: `${APP}/Screen.kt`, quoi: 'Screen', extrait: 'class Screen {\n    fun go() = Helper().run()\n}\n',
  preuve: { verdict: 'unreferenced', mentions: { tests: 0 }, emporte: [{ path: `${APP}/Nav.kt`, line: 2 }] } });
const importNav = c({ path: `${APP}/Nav.kt`, famille: 'balayage', line: 2, extrait: 'import com.example.kiosk.Screen\n', preuve: { verdict: 'cascade', suit: 'Screen' } });
const helper = c({ path: `${APP}/Helper.kt`, quoi: 'Helper', round: 2, extrait: 'class Helper {\n    fun run() = 1\n}\n', preuve: { verdict: 'unreferenced', mentions: { tests: 0 } } });
const twin = c({ path: `${APP}/Twin.kt`, quoi: 'Twin', preuve: { verdict: 'unreferenced', mentions: { tests: 0 }, homonyme: true } });
const plan = planifier([screen, importNav, helper, twin], { racine: RACINE, moduleDirs: ['/w/app'] });
const lotDe = (cle: string) => plan.lots.find(l => l.coupes.some(k => k.cle === cle))!;

describe('T4, le fichier d un lot', () => {
  const md = lotMarkdown({ ...entete, plan, simulation }, lotDe(screen.cle));

  it('commence par le titre du commit, puis la garantie de la vague', () => {
    const lignes = md.split('\n');
    expect(lignes[0]).toMatch(/^Remove dead code in app: 2 declarations, 1 orphaned import in 3 files$/);
    expect(lignes[1]).toBe('');
    expect(lignes[2]).toBe('Wave 1: every cut below is dead in the workspace at abc1234 as it stands, with no other cut applied first.');
  });

  it('une ligne par coupe, chemin relatif et ligne, avec la preuve dans les termes du detecteur', () => {
    expect(md).toContain('app/src/main/java/com/example/kiosk/Screen.kt:5  class Screen');
    expect(md).toContain('0 references outside its declaration; takes the import in Nav.kt:3');
    expect(md).toContain('app/src/main/java/com/example/kiosk/Nav.kt:3  import com.example.kiosk.Screen');
    expect(md).toContain('left with no user once Screen goes');
  });

  it('« Verify it yourself » donne la commande et le compte attendu, et nomme l homonyme', () => {
    expect(md).toContain('rg -w Screen');
    expect(md).toContain('2 files, all in this batch');
    expect(md).toContain('rg -w Twin');
    expect(md).toMatch(/Twin.*another declaration of this name exists/);
  });

  it('dit les canaux lus et ce qui n a pas ete juge', () => {
    expect(md).toContain('Channels read: Kotlin and Java sources, XML resources, layouts and binding attributes.');
    expect(md).toContain('Not judged: drawable resource files: Remove Everything Unused never deletes them.');
  });

  it('ne contient aucun tiret cadratin ni demi cadratin', () => {
    expect(md).not.toMatch(/[–—]/);
  });
});

describe('T4, libelles qui ne mentent pas', () => {
  const lotDeCoupes = (coupes: CoupePlanifiee[], causes?: Map<string, any>) => {
    const p = planifier(coupes, { racine: RACINE, moduleDirs: ['/w/app'], causes });
    return { plan: p, lot: p.lots[0] };
  };

  it('un import orphelin nomme les coupes de son fichier qui l utilisaient, pas la classe importee', () => {
    const fonction = c({ path: `${APP}/Repo.kt`, famille: 'membres', quoi: 'stream', extrait: '    fun stream(): Observable<Int> = Observable.just(1)\n', preuve: { verdict: 'unreferenced', mentions: { tests: 0 } } });
    const imp = c({ path: `${APP}/Repo.kt`, famille: 'imports', line: 3, extrait: 'import io.reactivex.Observable\n', preuve: { verdict: 'cascade', suit: 'Observable' } });
    const { plan: p, lot } = lotDeCoupes([fonction, imp]);
    const md = lotMarkdown({ ...entete, plan: p, simulation }, lot);
    expect(md).toContain('left with no user once stream goes');
    expect(md).not.toContain('once Observable goes');
  });

  it('une declaration dont les mentions ailleurs sont celles d un homonyme ne promet pas un seul fichier a rg', () => {
    // Une declaration de premier niveau (famille symboles) dont le detecteur a ecarte des mentions d un homonyme (KJ-064).
    const v = c({ path: `${APP}/Color.kt`, famille: 'symboles', quoi: 'primaryLight', extrait: 'val primaryLight = 1\n', preuve: { verdict: 'unreferenced', mentions: { tests: 0 }, via: 'visibility' } });
    const { plan: p, lot } = lotDeCoupes([v]);
    const md = lotMarkdown({ ...entete, plan: p, simulation }, lot);
    expect(md).toMatch(/rg -w primaryLight  → more than 1 file/);
    expect(md).not.toContain('rg -w primaryLight  → 1 file');
  });

  it('un lot fait seulement de fichiers ne repete pas « in N files »', () => {
    const lottie = c({ path: '/w/app/src/main/assets/a.json', famille: 'ressources', extrait: '{}\n', preuve: { verdict: 'unreferenced' } });
    const lottie2 = c({ path: '/w/app/src/main/assets/b.json', famille: 'ressources', extrait: '{}\n', preuve: { verdict: 'unreferenced' } });
    const { lot } = lotDeCoupes([lottie, lottie2]);
    expect(titre(lot)).toBe('Remove dead code in assets of app: 2 asset files');
    const layout = c({ path: '/w/app/src/main/res/layout/old.xml', famille: 'ressources', extrait: '<LinearLayout/>\n', preuve: { verdict: 'unreferenced' } });
    expect(titre(lotDeCoupes([layout]).lot)).toBe('Remove dead code in app: 1 resource file');
  });

  it('une locale du balayage n a pas de ligne rg : personne ne l a jugee a l echelle du depot', () => {
    const locale = c({ path: `${APP}/Calc.kt`, famille: 'balayage', extrait: '    val result = 1\n', preuve: { verdict: 'write-only', nom: 'result' } });
    const { plan: p, lot } = lotDeCoupes([locale]);
    const md = lotMarkdown({ ...entete, plan: p, simulation }, lot);
    expect(md).not.toContain('rg -w result');
  });

  it('un membre dit que les autres occurrences de son nom appartiennent a d autres classes', () => {
    const membre = c({ path: `${APP}/Repo.kt`, famille: 'membres', quoi: 'go', extrait: '    fun go() = 1\n', preuve: { verdict: 'unreferenced', mentions: { tests: 0 } } });
    const { plan: p, lot } = lotDeCoupes([membre]);
    const md = lotMarkdown({ ...entete, plan: p, simulation }, lot);
    expect(md).toMatch(/rg -w go  → every hit outside Repo\.kt belongs to another class/);
    expect(md).not.toContain('rg -w go  → 1 file');
  });

  it('la liste sans declencheur ne montre pas le suffixe de repetition des cles', () => {
    const a1 = c({ path: `${APP}/X.kt`, famille: 'balayage', round: 2, extrait: 'import a.B\n', preuve: { verdict: 'unreferenced', nom: 'import a.B' } });
    const a2 = { ...c({ path: `${APP}/X.kt`, famille: 'balayage', round: 2, extrait: 'import a.B\n', preuve: { verdict: 'unreferenced', nom: 'import a.B' } }), cle: `${a1.cle}#2` };
    const p = planifier([a1, a2], { racine: RACINE, moduleDirs: ['/w/app'] });
    const md = planMarkdown({ ...entete, plan: p, simulation });
    expect(md).not.toMatch(/#2/);
  });

  it('ne dans une jonction d historique : le titre dit plus vieux que l historique, pas le sujet du merge', () => {
    const v = c({ path: `${APP}/Old.kt`, quoi: 'Old' });
    const causes = new Map([[v.cle, { kind: 'born', label: 'older than the history (2024-07-08)', date: '2024-07-08', truncated: true }]]);
    expect(titre(lotDeCoupes([v], causes).lot)).toBe('Remove dead code older than the history (2024-07-08) in app: 1 declaration in 1 file');
  });
});

describe('T4, la vague 2 nomme son declencheur et son lot', () => {
  it('la preuve pointe la coupe de ronde 1 et le numero de son lot', () => {
    const lot = lotDe(helper.cle);
    const md = lotMarkdown({ ...entete, plan, simulation }, lot);
    expect(md.split('\n')[2]).toBe('Wave 2: each deletion names the earlier cut that removed its last user.');
    expect(md).toContain(`dead once Screen goes (batch ${String(lotDe(screen.cle).id).padStart(2, '0')})`);
  });
});

describe('T4, plan.md et plan.json', () => {
  const md = planMarkdown({ ...entete, plan, simulation });
  const json = JSON.parse(planJson({ ...entete, plan, simulation }));

  it('plan.md resume les vagues et liste les lots en tableau', () => {
    expect(md).toContain('# Dead code cleanup plan');
    expect(md).toContain('Wave 1: 3 cuts in 1 batch. Wave 2: 1 cut in 1 batch.');
    expect(md).toMatch(/\| 1 \| 1 \| app \| 3 \| /);
  });

  it('plan.json porte des cles, jamais des offsets, et le declencheur de chaque coupe', () => {
    expect(json.version).toBe(1);
    expect(json.head).toBe('abc1234');
    const cuts = json.batches.flatMap((b: any) => b.cuts);
    expect(cuts).toHaveLength(4);
    for (const k of cuts) {
      expect(k.cle).toBeTruthy();
      expect(k).not.toHaveProperty('start');
      expect(k).not.toHaveProperty('end');
    }
    expect(cuts.find((k: any) => k.quoi === 'Helper').triggers).toEqual([screen.cle]);
    expect(json.batches[0].files).toEqual(expect.arrayContaining(['app/src/main/java/com/example/kiosk/Screen.kt']));
  });

  it('un extrait long est tronque et le dit', () => {
    const gros = c({ path: `${APP}/Big.kt`, quoi: 'Big', extrait: `class Big {\n${'    val x = 1\n'.repeat(200)}}\n` });
    const p = planifier([gros], { racine: RACINE, moduleDirs: ['/w/app'] });
    const k = JSON.parse(planJson({ ...entete, plan: p, simulation })).batches[0].cuts[0];
    expect(k.extrait.length).toBeLessThanOrEqual(600);
    expect(k.extraitTronque).toBe(true);
  });
});

describe('T4b, « Verify it yourself » compte les fichiers qui nomment vraiment la coupe', () => {
  // Rejoue sur la reference : 7 lignes sur 20 donnaient un compte que `rg -w`
  // contredisait (un contrat vit dans deux fichiers, un commentaire cite la
  // classe, le declencheur de vague 2 la nomme encore a HEAD). La ligne doit
  // dire ce que le relecteur verra, fichier par fichier.
  const DOC = `${APP}/Doc.kt`;
  const mentions = {
    brut: new Map([['Screen', new Set([screen.path, importNav.path, DOC])], ['Helper', new Set([helper.path, screen.path])]]),
    code: new Map([['Screen', new Set([screen.path, importNav.path])], ['Helper', new Set([helper.path, screen.path])]]),
    declare: new Map([['Screen', new Set([screen.path])], ['Helper', new Set([helper.path])]]),
    exclus: new Set<string>(),
  };
  const p = planifier([screen, importNav, helper], { racine: RACINE, moduleDirs: ['/w/app'], mentions });
  const lot = (cle: string) => p.lots.find(l => l.coupes.some(k => k.cle === cle))!;

  // « source files » : rg liste aussi les .md et les .json du depot, que la
  // passe ne lit pas ; sur la reference, `observe` en touchait 22 de plus.
  it('nomme chaque fichier etranger et ce qu il y fait : un commentaire ne compte pas, une coupe du lot si', () => {
    const md = lotMarkdown({ ...entete, plan: p, simulation }, lot(screen.cle));
    expect(md).toContain('rg -w Screen  → 3 source files: this one, Doc.kt (comment or string only), Nav.kt (an import, this batch)');
  });

  it('en vague 2, le fichier qui nommait encore la coupe a HEAD est celui du declencheur, avec son lot', () => {
    const md = lotMarkdown({ ...entete, plan: p, simulation }, lot(helper.cle));
    expect(md).toContain('rg -w Helper  → 2 source files: this one, Screen.kt (inside Screen, batch 01)');
  });

  it('une mention que le detecteur n a pas comptee est dite en majuscules, et le lot passe au palier 2', () => {
    const douteux = c({ path: `${APP}/Odd.kt`, quoi: 'Odd', preuve: { verdict: 'unreferenced', mentions: { tests: 0 } } });
    const partout = new Map([['Odd', new Set([douteux.path, `${APP}/User.kt`])]]);
    const q = planifier([douteux], { racine: RACINE, moduleDirs: ['/w/app'], mentions: { brut: partout, code: partout, declare: new Map(), exclus: new Set() } });
    const md = lotMarkdown({ ...entete, plan: q, simulation }, q.lots[0]);
    expect(md).toContain('rg -w Odd  → 2 source files: this one, User.kt (NOT COUNTED, check it)');
    expect(md).toContain('[uncounted-mention]');
    expect(q.lots[0].palier).toBe(2);
  });

  it('une cle de ressource se cherche qualifiee, et ses declarations se comptent a part', () => {
    const cle = c({ path: '/w/app/src/main/res/values/strings.xml', famille: 'cles', quoi: 'string/kiosk_title', extrait: '    <string name="kiosk_title">K</string>\n' });
    const nuit = c({ path: '/w/app/src/main/res/values-night/strings.xml', famille: 'cles', quoi: 'string/kiosk_title', extrait: '    <string name="kiosk_title">K</string>\n' });
    const DOC = `${APP}/Doc.kt`;
    const idx = {
      brut: new Map([['string/kiosk_title', new Set([DOC])]]),
      code: new Map([['string/kiosk_title', new Set<string>()]]),
      declare: new Map([['string/kiosk_title', new Set([cle.path, nuit.path])]]),
      exclus: new Set<string>(),
    };
    const q = planifier([cle, nuit], { racine: RACINE, moduleDirs: ['/w/app'], mentions: idx });
    const md = lotMarkdown({ ...entete, plan: q, simulation }, q.lots[0]);
    expect(md).toContain('rg "(R2?\\.|@\\+?)string[./]kiosk_title\\b"  → 1 source file: Doc.kt (comment or string only); declared in 2 files, all in this batch');
  });

  it('une cle que rien ne nomme de facon qualifiee dit 0 fichiers, pas la phrase de repli au mot nu', () => {
    // Sur la reference, `consulter` : le mot nu est dans six fichiers (du texte
    // francais), la cle qualifiee dans aucun. La ligne de repli disait « rg -w consulter ».
    const cle = c({ path: '/w/app/src/main/res/values/strings.xml', famille: 'cles', quoi: 'string/ghost', extrait: '    <string name="ghost">G</string>\n' });
    const idx = { brut: new Map(), code: new Map(), declare: new Map([['string/ghost', new Set([cle.path])]]), exclus: new Set<string>(), noms: new Set(['string/ghost']) };
    const q = planifier([cle], { racine: RACINE, moduleDirs: ['/w/app'], mentions: idx });
    const md = lotMarkdown({ ...entete, plan: q, simulation }, q.lots[0]);
    expect(md).toContain('rg "(R2?\\.|@\\+?)string[./]ghost\\b"  → 0 source files; declared in 1 file, all in this batch');
  });

  it('une declaration sans coupe et une entree de baseline sont dites pour ce qu elles sont', () => {
    const poste = c({ path: `${APP}/Service.kt`, famille: 'evenements', quoi: 'LostEvent', extrait: '        bus.post(LostEvent())\n', preuve: { verdict: 'unheard' } });
    const WRAPPER = `${APP}/Wrapper.kt`, BASELINE = '/w/config/detekt/baseline.xml';
    const partout = new Map([['LostEvent', new Set([poste.path, WRAPPER, BASELINE])]]);
    const q = planifier([poste], { racine: RACINE, moduleDirs: ['/w/app'], mentions: { brut: partout, code: partout, declare: new Map([['LostEvent', new Set([WRAPPER])]]), exclus: new Set() } });
    const md = lotMarkdown({ ...entete, plan: q, simulation }, q.lots[0]);
    expect(md).toContain('rg -w LostEvent  → 3 source files: this one, Wrapper.kt (declared there), baseline.xml (a baseline entry)');
  });

  it('une coupe qui explique une mention est nommee pour ce qu elle est : un autre poste, la declaration, une entree de baseline', () => {
    const poste1 = c({ path: `${APP}/Service.kt`, famille: 'evenements', quoi: 'DoneEvent', extrait: '        bus.post(DoneEvent())\n', preuve: { verdict: 'unheard' } });
    const poste2 = c({ path: `${APP}/Other.kt`, famille: 'evenements', quoi: 'DoneEvent', extrait: '        bus.post(DoneEvent())\n', preuve: { verdict: 'unheard' } });
    const classe = c({ path: `${APP}/DoneEvent.kt`, quoi: 'DoneEvent', round: 2, extrait: 'class DoneEvent\n' });
    const entree = c({ path: '/w/config/detekt/baseline.xml', famille: 'baseline', round: 2, quoi: 'stale baseline entry for DoneEvent.kt, which no longer exists',
      extrait: '    <ID>MagicNumber:DoneEvent.kt$DoneEvent$1</ID>\n', preuve: { verdict: 'stale' } });
    const partout = new Map([['DoneEvent', new Set([poste1.path, poste2.path, classe.path, entree.path])]]);
    const q = planifier([poste1, poste2, classe, entree], { racine: RACINE, moduleDirs: ['/w/app'], mentions: { brut: partout, code: partout, declare: new Map([['DoneEvent', new Set([classe.path])]]), exclus: new Set() } });
    const md = lotMarkdown({ ...entete, plan: q, simulation }, q.lots.find(l => l.coupes.some(k => k.cle === poste1.cle))!);
    // La classe et l entree de baseline qui la nomme sont de la meme ronde : elles voyagent ensemble, lot 02.
    expect(md).toContain('rg -w DoneEvent  → 4 source files: this one, DoneEvent.kt (declared there, batch 02), Other.kt (another post, this batch), baseline.xml (a baseline entry, batch 02)');
  });

  it('un fichier de ressource ne contient pas son propre nom : 0 fichiers, et le fichier est sa declaration', () => {
    const asset = c({ path: '/w/app/src/main/assets/lottie/login_done.json', famille: 'ressources', extrait: '{}', preuve: { verdict: 'unreferenced' } });
    const idx = { brut: new Map(), code: new Map(), declare: new Map(), exclus: new Set<string>(), noms: new Set(['login_done']) };
    const q = planifier([asset], { racine: RACINE, moduleDirs: ['/w/app'], mentions: idx });
    const md = lotMarkdown({ ...entete, plan: q, simulation }, q.lots[0]);
    expect(md).toContain('rg -w login_done  → 0 source files; the file itself is the declaration');
  });

  it('des fichiers de meme nom qui disent la meme chose se comptent au lieu de se repeter', () => {
    const cle = c({ path: '/w/app/src/main/res/xml/remote_config_defaults.xml', famille: 'remoteconfig', quoi: 'flag_x', extrait: '    <entry><key>flag_x</key><value>true</value></entry>\n', preuve: { verdict: 'unreferenced', variantes: 1 } });
    const autres = ['main', 'debug', 'release'].map(v => `/w/core/ui/src/${v}/res/xml/remote_config_defaults.xml`);
    const partout = new Map([['flag_x', new Set([cle.path, ...autres])]]);
    const q = planifier([cle], { racine: RACINE, moduleDirs: ['/w/app', '/w/core/ui'], mentions: { brut: partout, code: partout, declare: new Map([['flag_x', new Set([cle.path, ...autres])]]), exclus: new Set() } });
    const md = lotMarkdown({ ...entete, plan: q, simulation }, q.lots[0]);
    expect(md).toContain('rg -w flag_x  → 4 source files: this one, 3 files (another flag_x, in core/ui)');
  });

  it('plan.json porte les mentions, chemins relatifs, pour qu un autre outil les relise', () => {
    const json = JSON.parse(planJson({ ...entete, plan: p, simulation }));
    const k = json.batches.flatMap((b: any) => b.cuts).find((k: any) => k.quoi === 'Screen');
    expect(k.mentions).toEqual([
      { path: 'app/src/main/java/com/example/kiosk/Doc.kt', kind: 'comment-only' },
      { path: 'app/src/main/java/com/example/kiosk/Nav.kt', kind: 'cut', cle: importNav.cle },
    ]);
  });
});
