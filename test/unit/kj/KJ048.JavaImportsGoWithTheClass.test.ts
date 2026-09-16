import { describe, it, expect } from 'vitest';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Supprimer une classe emporte les imports qui la nomment dans les autres
 * fichiers, Java compris.
 *
 * Vu en compilant variant apres « Remove Everything Unused » : les posts de
 * `LiveListViewScrollingEvent` etaient partis, la classe aussi, et
 * `LiveDetailFragment.java` gardait `import ...LiveListViewScrollingEvent;`.
 * javac : `cannot find symbol`. L ampoule d un symbole retire ces imports
 * (`staleImports`) ; la commande de masse ne les appliquait pas, et comptait
 * sur le balayage, qui ne lit les imports qu en Kotlin.
 */

const J = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");

const apres = (sources: Array<{ path: string; text: string }>, path: string): string => {
  const texte = sources.find(s => s.path === path)!.text;
  const coupes = (collecterUnePasse(sources as any, ['/src/test/']).parFichier.get(path) ?? [])
    .sort((a: any, b: any) => b.start - a.start);
  let out = texte;
  for (const c of coupes as any[]) out = out.slice(0, c.start) + c.texte + out.slice(c.end);
  return out;
};

describe('KJ-048 la classe supprimee emporte ses imports dans les autres fichiers', () => {
  const evenement = f(`${J}/event/ScrollEvent.java`, 'package com.x.event;\n\npublic class ScrollEvent {\n}\n');
  const fragment = f(`${J}/ui/Fragment.java`, 'package com.x.ui;\n\nimport com.x.event.ScrollEvent;\nimport java.util.List;\n\npublic class Fragment {\n    public List<String> items() { return null; }\n}\n');
  const appel = f(`${J}/Main.java`, 'package com.x;\n\nimport com.x.ui.Fragment;\n\npublic class Main {\n    public static void main(String[] a) { new Fragment().items(); }\n}\n');

  it('temoin : la classe que seul un import nomme est bien coupee', () => {
    const coupes = collecterUnePasse([evenement, fragment, appel, GRADLE] as any, ['/src/test/']).parFichier.get(evenement.path) ?? [];
    expect(coupes.length).toBeGreaterThan(0);
  });

  it('Java : l import de la classe supprimee part, les autres restent', () => {
    const r = apres([evenement, fragment, appel, GRADLE], fragment.path);
    expect(r).not.toContain('ScrollEvent');
    expect(r).toContain('import java.util.List;');
  });

  it('Kotlin : meme chose, et une seule coupe pour la ligne', () => {
    const evtKt = f('/w/app/src/main/kotlin/com/x/event/ScrollEvent.kt', 'package com.x.event\n\nclass ScrollEvent\n');
    const fragKt = f('/w/app/src/main/kotlin/com/x/ui/Fragment.kt', 'package com.x.ui\n\nimport com.x.event.ScrollEvent\nimport java.util.UUID\n\nclass Fragment {\n    fun id() = UUID.randomUUID()\n}\n');
    const appelKt = f('/w/app/src/main/kotlin/com/x/Main.kt', 'package com.x\n\nimport com.x.ui.Fragment\n\nfun main() { println(Fragment().id()) }\n');
    const sources = [evtKt, fragKt, appelKt, GRADLE];
    const coupes = collecterUnePasse(sources as any, ['/src/test/']).parFichier.get(fragKt.path) ?? [];
    const lignes = coupes.map((c: any) => fragKt.text.slice(c.start, c.end));
    expect(lignes.filter((l: string) => l.includes('ScrollEvent')).length).toBe(1);
    expect(apres(sources, fragKt.path)).not.toContain('ScrollEvent');
  });

  it('Java : un ilot mort emporte aussi les imports de ses noms', () => {
    const ping = f(`${J}/a/Ping.java`, 'package com.x.a;\n\nimport com.x.b.Pong;\n\npublic class Ping {\n    Pong pong;\n}\n');
    const pong = f(`${J}/b/Pong.java`, 'package com.x.b;\n\nimport com.x.a.Ping;\n\npublic class Pong {\n    Ping ping;\n}\n');
    const user = f(`${J}/ui/User.java`, 'package com.x.ui;\n\nimport com.x.a.Ping;\nimport java.util.List;\n\npublic class User {\n    public List<String> items() { return null; }\n}\n');
    const main = f(`${J}/Main.java`, 'package com.x;\n\nimport com.x.ui.User;\n\npublic class Main {\n    public static void main(String[] a) { new User().items(); }\n}\n');
    const sources = [ping, pong, user, main, GRADLE];
    const familles = [...collecterUnePasse(sources as any, ['/src/test/']).parFichier.values()].flat().map((c: any) => c.famille);
    expect(familles, 'l ilot est bien coupe par la famille des ilots').toContain('ilots');
    expect(apres(sources, user.path)).not.toContain('Ping');
  });

  it('Java : un membre statique supprime emporte son import statique', () => {
    const cles = f(`${J}/a/Cles.java`, 'package com.x.a;\n\npublic class Cles {\n    public static final String MORTE = "m";\n    public static final String VIVANTE = "v";\n}\n');
    const ecran = f(`${J}/b/Ecran.java`, 'package com.x.b;\n\nimport static com.x.a.Cles.MORTE;\nimport com.x.a.Cles;\n\npublic class Ecran {\n    public String v() { return Cles.VIVANTE; }\n}\n');
    const main = f(`${J}/Main.java`, 'package com.x;\n\nimport com.x.b.Ecran;\n\npublic class Main {\n    public static void main(String[] a) { new Ecran().v(); }\n}\n');
    const sources = [cles, ecran, main, GRADLE];
    expect(apres(sources, cles.path)).not.toContain('MORTE');
    const r = apres(sources, ecran.path);
    expect(r).not.toContain('MORTE');
    expect(r).toContain('import com.x.a.Cles;');
  });

  it('Java : une entree d enum supprimee emporte son import statique', () => {
    const mode = f(`${J}/a/Mode.java`, 'package com.x.a;\n\npublic enum Mode {\n    VIVANT,\n    MORT,\n}\n');
    const ecran = f(`${J}/b/Ecran.java`, 'package com.x.b;\n\nimport static com.x.a.Mode.MORT;\nimport com.x.a.Mode;\n\npublic class Ecran {\n    public Mode v() { return Mode.VIVANT; }\n}\n');
    const main = f(`${J}/Main.java`, 'package com.x;\n\nimport com.x.b.Ecran;\n\npublic class Main {\n    public static void main(String[] a) { new Ecran().v(); }\n}\n');
    const sources = [mode, ecran, main, GRADLE];
    expect(apres(sources, mode.path)).not.toContain('MORT,');
    const r = apres(sources, ecran.path);
    expect(r).not.toContain('Mode.MORT');
    expect(r).toContain('import com.x.a.Mode;');
  });

  it('Java : la constante de compagnon Kotlin, importee par sa classe', () => {
    const cles = f('/w/app/src/main/kotlin/com/x/a/Cles.kt', 'package com.x.a\n\nclass Cles {\n    companion object {\n        const val MORTE = "m"\n        const val VIVANTE = "v"\n    }\n}\n');
    const ecran = f(`${J}/b/Ecran.java`, 'package com.x.b;\n\nimport static com.x.a.Cles.MORTE;\nimport com.x.a.Cles;\n\npublic class Ecran {\n    public String v() { return Cles.VIVANTE; }\n}\n');
    const main = f(`${J}/Main.java`, 'package com.x;\n\nimport com.x.b.Ecran;\n\npublic class Main {\n    public static void main(String[] a) { new Ecran().v(); }\n}\n');
    const sources = [cles, ecran, main, GRADLE];
    expect(apres(sources, cles.path)).not.toContain('MORTE');
    expect(apres(sources, ecran.path)).not.toContain('MORTE');
  });

  it('temoin : l import d un autre membre du meme nom de classe reste', () => {
    const cles = f(`${J}/a/Cles.java`, 'package com.x.a;\n\npublic class Cles {\n    public static final String MORTE = "m";\n    public static final String VIVANTE = "v";\n}\n');
    const ecran = f(`${J}/b/Ecran.java`, 'package com.x.b;\n\nimport static com.x.a.Cles.VIVANTE;\n\npublic class Ecran {\n    public String v() { return VIVANTE; }\n}\n');
    const main = f(`${J}/Main.java`, 'package com.x;\n\nimport com.x.b.Ecran;\n\npublic class Main {\n    public static void main(String[] a) { new Ecran().v(); }\n}\n');
    expect(apres([cles, ecran, main, GRADLE], ecran.path)).toContain('import static com.x.a.Cles.VIVANTE;');
  });

  it('entree homonyme : l import de l entree VIVANTE du meme nom reste', () => {
    // MediaSource.FEED part (1.42.328 rattache les mentions a leur enum), alors
    // que `FEED` est ecrit ailleurs pour EventSource. Chercher l import par le
    // nom seul retirait `import com.e.EventSource.FEED`, et Use.kt ne
    // compilait plus. Le conteneur de l import doit etre celui de l entree.
    const K = '/w/app/src/main/kotlin/com';
    const media = f(`${K}/m/MediaSource.kt`, 'package com.m\n\nenum class MediaSource {\n    FEED,\n    CARD,\n}\n');
    const event = f(`${K}/e/EventSource.kt`, 'package com.e\n\nenum class EventSource {\n    FEED,\n}\n');
    const use = f(`${K}/u/Use.kt`, 'package com.u\n\nimport com.e.EventSource.FEED\nimport com.m.MediaSource\n\nfun main() { println(FEED); println(MediaSource.CARD) }\n');
    const sources = [media, event, use, GRADLE];
    expect(apres(sources, media.path)).not.toContain('FEED');
    expect(apres(sources, use.path)).toContain('import com.e.EventSource.FEED');
  });
});
