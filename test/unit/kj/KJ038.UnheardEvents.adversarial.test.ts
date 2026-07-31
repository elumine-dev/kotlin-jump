import { describe, it, expect } from 'vitest';
import { findUnheardEvents, receiverBefore, postedRef } from '../../../src/providers/unheardEvents';
import { sanitizeForUsageScan } from '../../../src/util/kotlinScan';

/**
 * KJ-038 — les événements postés que personne n'écoute.
 *
 * Cette suite EST la spécification. Chaque cas vient soit d'une forme réelle
 * relevée sur un monorepo de 6410 fichiers, soit d'une faille mesurée de
 * l'outil concurrent.
 *
 * Rappel du contrat, plus strict ici qu'ailleurs dans la famille : supprimer
 * une classe non référencée, le compilateur rattrape ; supprimer un `post`,
 * personne ne rattrape, et le bug sort au runtime chez l'utilisateur.
 */

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });

const scan = (sources: { path: string; text: string }[], extra: Record<string, unknown> = {}) =>
  findUnheardEvents({ sources, testSourceSets: TEST_SETS, ...extra });
const names = (sources: any[], extra: Record<string, unknown> = {}) =>
  scan(sources, extra).events.map(e => e.name);

/** Tout corpus a besoin d'un bus : c'est `.register(` qui l'enseigne. */
const busFile = f(`${MAIN}/BusOwner.kt`, [
  'package com.x',
  '',
  'class BusOwner {',
  '    fun start() {',
  '        EventBus.getDefault().register(this)',
  '    }',
  '}',
].join('\n'));

/** Un souscripteur quelconque, pour que C2 ne coupe pas le scan. */
const anySubscriber = f(`${MAIN}/AnyListener.kt`, [
  'package com.x',
  '',
  'class AnyListener {',
  '    @Subscribe',
  '    fun onBusEvent(event: HeardEvent) {',
  '    }',
  '}',
].join('\n'));

const heardEvent = f(`${MAIN}/HeardEvent.kt`, 'package com.x\n\nclass HeardEvent\n');

/** Le socle minimal : un bus, une écoute, et le type qu'elle écoute. */
const base = [busFile, anySubscriber, heardEvent];

describe('la vérité terrain', () => {
  it('un événement posté sans souscripteur ni supertype est signalé', () => {
    // `PanelStateEvent`, posté une fois, sans
    // parent, donc sans échappatoire polymorphique.
    const sources = [
      ...base,
      f(`${MAIN}/PanelStateEvent.kt`, 'package com.x\n\nclass PanelStateEvent(val open: Boolean)\n'),
      f(`${MAIN}/IssueFragment.kt`, [
        'package com.x',
        '',
        'class IssueFragment {',
        '    fun openMenu() {',
        '        EventBus.getDefault().post(PanelStateEvent(true))',
        '    }',
        '}',
      ].join('\n')),
    ];
    expect(names(sources)).toEqual(['PanelStateEvent']);
    expect(scan(sources).events[0].verdict).toBe('unheard');
  });

  it('le même événement avec un souscripteur est muet', () => {
    const sources = [
      ...base,
      f(`${MAIN}/PanelStateEvent.kt`, 'package com.x\n\nclass PanelStateEvent(val open: Boolean)\n'),
      f(`${MAIN}/MenuListener.kt`, [
        'package com.x',
        '',
        'class MenuListener {',
        '    @Subscribe',
        '    fun onBusEvent(event: PanelStateEvent) {',
        '    }',
        '}',
      ].join('\n')),
      f(`${MAIN}/IssueFragment.kt`,
        'package com.x\n\nclass IssueFragment {\n    fun openMenu() {\n' +
        '        EventBus.getDefault().post(PanelStateEvent(true))\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });
});

describe('les deux failles de l’outil concurrent', () => {
  it('une souscription INLINE est vue comme les autres', () => {
    // `@Subscribe fun onBusEvent(event: X?) {` sur une seule ligne : 13
    // occurrences réelles. Une regex qui exige un saut de ligne les rate
    // toutes et transforme des écoutes réelles en faux orphelins.
    const sources = [
      ...base,
      f(`${MAIN}/RefreshEvent.kt`, 'package com.x\n\nclass RefreshEvent\n'),
      f(`${MAIN}/FeedActionBar.kt`, [
        'package com.x',
        '',
        'class FeedActionBar {',
        '    @Subscribe fun onBusEvent(event: RefreshEvent?) {',
        '    }',
        '}',
      ].join('\n')),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(RefreshEvent())\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('un post MULTI-LIGNES est vu, et ancré sur la ligne du post', () => {
    // 18 occurrences réelles : `.post(` en fin de ligne, constructeur à la
    // suivante. Une regex mono-ligne les rate, donc rate de vraies trouvailles.
    const sources = [
      ...base,
      f(`${MAIN}/NetworkStateEvent.kt`,
        'package com.x\n\nclass NetworkStateEvent(val a: Int, val b: Int)\n'),
      f(`${MAIN}/NetworkWatcher.kt`, [
        'package com.x',
        '',
        'class NetworkWatcher {',
        '    fun notifyChange(previous: Int, next: Int) {',
        '        EventBus.getDefault().post(',
        '            NetworkStateEvent(previous, next)',
        '        )',
        '    }',
        '}',
      ].join('\n')),
    ];
    const found = scan(sources).events;
    expect(found.map(e => e.name)).toEqual(['NetworkStateEvent']);
    expect(found[0].line).toBe(4);  // la ligne du `.post(`, pas celle du type
  });

  it('et le même post multi-lignes avec souscripteur est muet', () => {
    const sources = [
      ...base,
      f(`${MAIN}/NetworkStateEvent.kt`, 'package com.x\n\nclass NetworkStateEvent\n'),
      f(`${MAIN}/NetListener.kt`,
        'package com.x\n\nclass NetListener {\n    @Subscribe\n' +
        '    fun onBusEvent(event: NetworkStateEvent) {\n    }\n}\n'),
      f(`${MAIN}/NetworkWatcher.kt`,
        'package com.x\n\nclass NetworkWatcher {\n    fun go() {\n' +
        '        EventBus.getDefault().post(\n' +
        '            NetworkStateEvent()\n        )\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('un homonyme dans deux packages neutralise le post', () => {
    // Deux `MediaEvent` réels dans deux packages. Matcher sur le
    // dernier segment les confond ; ici le post ambigu est abandonné (P8).
    const sources = [
      ...base,
      f('/w/a/src/main/kotlin/com/a/Twin.kt', 'package com.a\n\nclass Twin\n'),
      f('/w/b/src/main/kotlin/com/b/Twin.kt', 'package com.b\n\nclass Twin\n'),
      f('/w/c/src/main/kotlin/com/c/Poster.kt',
        'package com.c\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(Twin())\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('mais un import qui tranche rend la trouvaille', () => {
    const sources = [
      ...base,
      f('/w/a/src/main/kotlin/com/a/Twin.kt', 'package com.a\n\nclass Twin\n'),
      f('/w/b/src/main/kotlin/com/b/Twin.kt', 'package com.b\n\nclass Twin\n'),
      f('/w/c/src/main/kotlin/com/c/Poster.kt',
        'package com.c\n\nimport com.a.Twin\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(Twin())\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual(['Twin']);
    expect(scan(sources).events[0].fqn).toBe('com.a.Twin');
  });
});

describe('ce qui n’est pas un bus', () => {
  it('UIThread.post et handler.post ne comptent pas', () => {
    const sources = [
      ...base,
      f(`${MAIN}/MyRunnable.kt`, 'package com.x\n\nclass MyRunnable : Runnable {\n    override fun run() {}\n}\n'),
      f(`${MAIN}/Caller.kt`, [
        'package com.x',
        '',
        'class Caller {',
        '    fun go() {',
        '        UIThread.post(MyRunnable())',
        '        handler.post(MyRunnable())',
        '    }',
        '}',
      ].join('\n')),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('postDelayed, postValue et une lambda ne matchent pas', () => {
    const sources = [
      ...base,
      f(`${MAIN}/Ev.kt`, 'package com.x\n\nclass Ev\n'),
      f(`${MAIN}/Caller.kt`, [
        'package com.x',
        '',
        'class Caller {',
        '    fun go() {',
        '        handler.postDelayed(Ev(), 100)',
        '        liveData.postValue(Ev())',
        '        view.post { doSomething() }',
        '    }',
        '}',
      ].join('\n')),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('sans aucun `.register(` nulle part, le scan ne dit rien', () => {
    // On ne sait pas ce qu'est un bus ici, donc on n'affirme rien (P0).
    const sources = [
      anySubscriber,
      heardEvent,
      f(`${MAIN}/Ev.kt`, 'package com.x\n\nclass Ev\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n        bus.post(Ev())\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('l’implémentation du bus elle-même ne produit rien', () => {
    // `Bus.java` poste `new DeadEvent(this, event)`. Détecté structurellement,
    // pas par un chemin en dur, pour couvrir une copie vendored n'importe où.
    const sources = [
      ...base,
      f('/w/lib/src/main/java/com/squareup/otto/DeadEvent.java',
        'package com.squareup.otto;\n\npublic class DeadEvent {\n    public DeadEvent(Object s, Object e) {}\n}\n'),
      f('/w/lib/src/main/java/com/squareup/otto/Bus.java', [
        'package com.squareup.otto;',
        '',
        'public class Bus {',
        '    public void register(Object o) {}',
        '    public void post(Object event) {',
        '        this.post(new DeadEvent(this, event));',
        '    }',
        '}',
      ].join('\n')),
    ];
    expect(names(sources)).toEqual([]);
  });
});

describe('l’héritage, que le bus aplatit', () => {
  it('souscrire au parent entend un post de variante sealed', () => {
    // Cas réel : `MediaHelper` souscrit au parent, trois
    // ViewModels postent `Parent.Close(...)`, `Parent.Pause`…
    const sources = [
      busFile,
      f(`${MAIN}/VideoEvent.kt`, [
        'package com.x',
        '',
        'sealed class VideoEvent {',
        '    class Close(val muted: Boolean) : VideoEvent()',
        '    object Pause : VideoEvent()',
        '}',
      ].join('\n')),
      f(`${MAIN}/VideoHelper.kt`,
        'package com.x\n\nclass VideoHelper {\n    @Subscribe\n' +
        '    fun onBusEvent(event: VideoEvent) {\n    }\n}\n'),
      f(`${MAIN}/VideoViewModel.kt`, [
        'package com.x',
        '',
        'class VideoViewModel {',
        '    fun go() {',
        '        EventBus.getDefault().post(VideoEvent.Close(true))',
        '    }',
        '}',
      ].join('\n')),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('POST D’UN OBJET SANS PARENTHÈSES : le piège qui rate en faux négatif', () => {
    // `object Pause : VideoEvent()` se poste `post(Pause)`. Exiger `(` après
    // le nom le rate silencieusement, et aucun audit des trouvailles ne peut
    // le révéler puisqu'il ne produit rien.
    const hierarchy = f(`${MAIN}/VideoEvent.kt`, [
      'package com.x',
      '',
      'sealed class VideoEvent {',
      '    object Pause : VideoEvent()',
      '}',
    ].join('\n'));
    const poster = f(`${MAIN}/VideoViewModel.kt`,
      'package com.x\n\nimport com.x.VideoEvent.Pause\n\nclass VideoViewModel {\n    fun go() {\n' +
      '        EventBus.getDefault().post(Pause)\n    }\n}\n');

    const heard = [
      busFile, hierarchy, poster,
      f(`${MAIN}/VideoHelper.kt`,
        'package com.x\n\nclass VideoHelper {\n    @Subscribe\n' +
        '    fun onBusEvent(event: VideoEvent) {\n    }\n}\n'),
    ];
    expect(names(heard)).toEqual([]);

    const unheard = [busFile, anySubscriber, heardEvent, hierarchy, poster];
    expect(names(unheard)).toEqual(['Pause']);
  });

  it('un conteneur n’est PAS une hiérarchie', () => {
    // `object ScreenEvents { class A ; class B }` : les enfants sont
    // indépendants. Souscrire à A ne dit rien de B.
    const sources = [
      busFile,
      f(`${MAIN}/ScreenEvents.kt`, [
        'package com.x',
        '',
        'object ScreenEvents {',
        '    class Opened(val uid: String)',
        '    class Idle(val uid: String)',
        '}',
      ].join('\n')),
      f(`${MAIN}/PageListener.kt`,
        'package com.x\n\nclass PageListener {\n    @Subscribe\n' +
        '    fun onBusEvent(event: ScreenEvents.Opened) {\n    }\n}\n'),
      f(`${MAIN}/PagePoster.kt`, [
        'package com.x',
        '',
        'class PagePoster {',
        '    fun go() {',
        '        EventBus.getDefault().post(ScreenEvents.Opened("a"))',
        '        EventBus.getDefault().post(ScreenEvents.Idle("b"))',
        '    }',
        '}',
      ].join('\n')),
    ];
    expect(names(sources)).toEqual(['Idle']);
  });

  it('Java : une interface implémentée est aplatie comme une superclasse', () => {
    const sources = [
      busFile,
      f('/w/a/src/main/java/com/x/Trackable.java', 'package com.x;\n\npublic interface Trackable {\n}\n'),
      f('/w/a/src/main/java/com/x/ClickEvent.java',
        'package com.x;\n\npublic class ClickEvent implements Trackable {\n}\n'),
      f('/w/a/src/main/java/com/x/Tracker.java', [
        'package com.x;',
        '',
        'public class Tracker {',
        '    @Subscribe',
        '    public void onBusEvent(Trackable event) {',
        '    }',
        '}',
      ].join('\n')),
      f('/w/a/src/main/java/com/x/Clicker.java',
        'package com.x;\n\npublic class Clicker {\n    void go() {\n' +
        '        EventBus.getDefault().post(new ClickEvent());\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('un ancêtre hors corpus fait abandonner le candidat', () => {
    // On ne peut pas exclure une souscription plus haut dans une chaîne qu'on
    // ne lit pas (H1).
    const sources = [
      ...base,
      f(`${MAIN}/LibEvent.kt`, 'package com.x\n\nclass LibEvent : SomeLibraryBase()\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(LibEvent())\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('un typealias relie le type souscrit au type posté', () => {
    // Sans arête d'alias, `@Subscribe fun on(e: PageOpened)` plus
    // `post(ScreenEvents.Opened())` est un faux orphelin garanti (H2).
    const sources = [
      busFile,
      f(`${MAIN}/ScreenEvents.kt`, 'package com.x\n\nobject ScreenEvents {\n    class Opened\n}\n'),
      f(`${MAIN}/Alias.kt`, 'package com.x\n\ntypealias PageOpened = ScreenEvents.Opened\n'),
      f(`${MAIN}/PageListener.kt`,
        'package com.x\n\nclass PageListener {\n    @Subscribe\n' +
        '    fun onBusEvent(event: PageOpened) {\n    }\n}\n'),
      f(`${MAIN}/PagePoster.kt`,
        'package com.x\n\nclass PagePoster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(ScreenEvents.Opened())\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });
});

describe('la règle de complétude', () => {
  it('une souscription illisible empoisonne TOUT le scan', () => {
    // Un `@Subscribe` sans paramètre : on ne sait pas ce qu'il écoute. Compter
    // au hasard, c'est inventer ; ne pas compter, c'est fabriquer un faux
    // positif. On se tait, et on dit pourquoi.
    const sources = [
      ...base,
      f(`${MAIN}/Broken.kt`,
        'package com.x\n\nclass Broken {\n    @Subscribe\n    fun onBusEvent() {\n    }\n}\n'),
      f(`${MAIN}/Orphan.kt`, 'package com.x\n\nclass Orphan\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(Orphan())\n    }\n}\n'),
    ];
    const result = scan(sources);
    expect(result.events).toEqual([]);
    expect(result.unreadable).toHaveLength(1);
    expect(result.unreadable[0].path).toBe(`${MAIN}/Broken.kt`);
  });

  it('le réglage assumeSubscribed rend la main à l’utilisateur', () => {
    const sources = [
      ...base,
      f(`${MAIN}/Orphan.kt`, 'package com.x\n\nclass Orphan\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(Orphan())\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual(['Orphan']);
    expect(names(sources, { assumeSubscribed: ['Orphan'] })).toEqual([]);
  });

  it('des posts sans AUCUNE souscription dans le corpus ne produisent rien', () => {
    // Le mécanisme d'écoute n'est pas celui qu'on sait lire. Sans cette garde,
    // les 338 posts du monorepo deviendraient 338 faux positifs (C2).
    const sources = [
      busFile,
      f(`${MAIN}/Ev.kt`, 'package com.x\n\nclass Ev\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(Ev())\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('une souscription sur Any entend tout', () => {
    const sources = [
      busFile,
      f(`${MAIN}/Catchall.kt`,
        'package com.x\n\nclass Catchall {\n    @Subscribe\n    fun onBusEvent(event: Any) {\n    }\n}\n'),
      f(`${MAIN}/Ev.kt`, 'package com.x\n\nclass Ev\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(Ev())\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('un corpus tronqué ne produit rien', () => {
    const sources = [
      ...base,
      f(`${MAIN}/Orphan.kt`, 'package com.x\n\nclass Orphan\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(Orphan())\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual(['Orphan']);
    expect(names(sources, { truncated: true })).toEqual([]);
  });

  it('un paramètre Java annoté et final reste lisible', () => {
    // Forme très courante. La rater empoisonnerait tout le scan.
    const sources = [
      busFile,
      f('/w/a/src/main/java/com/x/PreloadStartedEvent.java',
        'package com.x;\n\npublic class PreloadStartedEvent {\n}\n'),
      f('/w/a/src/main/java/com/x/Listener.java', [
        'package com.x;',
        '',
        'public class Listener {',
        '    @Subscribe',
        '    public void onBusEvent(@NonNull final PreloadStartedEvent event) {',
        '    }',
        '}',
      ].join('\n')),
      f('/w/a/src/main/java/com/x/Poster.java',
        'package com.x;\n\npublic class Poster {\n    void go() {\n' +
        '        EventBus.getDefault().post(new PreloadStartedEvent());\n    }\n}\n'),
    ];
    const result = scan(sources);
    expect(result.unreadable).toEqual([]);
    expect(result.events).toEqual([]);
  });
});

describe('les posts qu’on ne sait pas résoudre', () => {
  it('un post dynamique est écarté sans rien empoisonner', () => {
    // ~30 cas réels : variable, factory, builder, `when`. Chacun disparaît
    // seul ; le post concret à côté reste signalé.
    const sources = [
      ...base,
      f(`${MAIN}/Orphan.kt`, 'package com.x\n\nclass Orphan\n'),
      f(`${MAIN}/Poster.kt`, [
        'package com.x',
        '',
        'class Poster {',
        '    fun go() {',
        '        val event = buildSomething()',
        '        EventBus.getDefault().post(event)',
        '        EventBus.getDefault().post(factory.createEvent(1, 2))',
        '        EventBus.getDefault().post(builder.build())',
        '        EventBus.getDefault().post(Orphan())',
        '    }',
        '}',
      ].join('\n')),
    ];
    expect(names(sources)).toEqual(['Orphan']);
  });
});

describe('les tests ne sont pas la production', () => {
  it('un souscripteur qui n’existe que dans un test donne un verdict à part', () => {
    // Ce que l'outil concurrent compte à tort comme écoute de production.
    const sources = [
      ...base,
      f(`${MAIN}/TransitionEvent.kt`, 'package com.x\n\nclass TransitionEvent\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(TransitionEvent())\n    }\n}\n'),
      f('/w/app/src/test/kotlin/com/x/BaseTest.kt',
        'package com.x\n\nclass BaseTest {\n    @Subscribe\n' +
        '    fun onBusEvent(event: TransitionEvent) {\n    }\n}\n'),
    ];
    const found = scan(sources).events;
    expect(found.map(e => e.name)).toEqual(['TransitionEvent']);
    expect(found[0].verdict).toBe('testOnlySubscriber');
  });

  it('un post fait depuis un test n’est pas du poids mort de production', () => {
    const sources = [
      ...base,
      f(`${MAIN}/Orphan.kt`, 'package com.x\n\nclass Orphan\n'),
      f('/w/app/src/test/kotlin/com/x/PosterTest.kt',
        'package com.x\n\nclass PosterTest {\n    fun go() {\n' +
        '        EventBus.getDefault().post(Orphan())\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });
});

describe('les commentaires et les chaînes', () => {
  it('un post commenté n’est pas un post, un @Subscribe commenté n’est pas une écoute', () => {
    const sources = [
      ...base,
      f(`${MAIN}/Foo.kt`, 'package com.x\n\nclass Foo\n'),
      f(`${MAIN}/Bar.kt`, 'package com.x\n\nclass Bar\n'),
      f(`${MAIN}/Poster.kt`, [
        'package com.x',
        '',
        'class Poster {',
        '    fun go() {',
        '        // EventBus.getDefault().post(Foo())',
        '        EventBus.getDefault().post(Bar())',
        '    }',
        '}',
      ].join('\n')),
      f(`${MAIN}/Ghost.kt`, [
        'package com.x',
        '',
        'class Ghost {',
        '    // @Subscribe',
        '    // fun onBusEvent(event: Bar) {}',
        '}',
      ].join('\n')),
    ];
    expect(names(sources)).toEqual(['Bar']);
  });

  it('un @Subscribe dans un KDoc ou une chaîne n’empoisonne pas', () => {
    const sources = [
      ...base,
      f(`${MAIN}/Doc.kt`, [
        'package com.x',
        '',
        '/**',
        ' * Usage: @Subscribe fun onBusEvent(e: Thing)',
        ' */',
        'class Doc {',
        '    val sample = """@Subscribe fun broken()"""',
        '}',
      ].join('\n')),
    ];
    expect(scan(sources).unreadable).toEqual([]);
  });
});

describe('l’étendue de suppression', () => {
  it('un post seul sur sa ligne est supprimable', () => {
    const sources = [
      ...base,
      f(`${MAIN}/Orphan.kt`, 'package com.x\n\nclass Orphan\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(Orphan())\n    }\n}\n'),
    ];
    expect(scan(sources).events[0].removeStart).toBeGreaterThanOrEqual(0);
  });

  it('un post sous condition ne l’est pas', () => {
    // Supprimer laisserait `if (ready)` orphelin. Le verdict tient, le
    // correctif abandonne (X1).
    const sources = [
      ...base,
      f(`${MAIN}/Orphan.kt`, 'package com.x\n\nclass Orphan\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go(ready: Boolean) {\n' +
        '        if (ready) EventBus.getDefault().post(Orphan())\n    }\n}\n'),
    ];
    const found = scan(sources).events;
    expect(found.map(e => e.name)).toEqual(['Orphan']);
    expect(found[0].removeStart).toBe(-1);
  });

  it('un argument qui appelle quelque chose n’est pas supprimable', () => {
    const sources = [
      ...base,
      f(`${MAIN}/Orphan.kt`, 'package com.x\n\nclass Orphan(val v: Int)\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(Orphan(compute()))\n    }\n}\n'),
    ];
    const found = scan(sources).events;
    expect(found.map(e => e.name)).toEqual(['Orphan']);
    expect(found[0].removeStart).toBe(-1);
  });
});

describe('l’opt-out', () => {
  it('le marqueur inline retire la trouvaille', () => {
    const sources = [
      ...base,
      f(`${MAIN}/Orphan.kt`, 'package com.x\n\nclass Orphan\n'),
      f(`${MAIN}/Poster.kt`, [
        'package com.x',
        '',
        'class Poster {',
        '    fun go() {',
        '        // kotlin-jump:ignore unheard-event',
        '        EventBus.getDefault().post(Orphan())',
        '    }',
        '}',
      ].join('\n')),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('mais il ne peut PAS lever un empoisonnement', () => {
    // Ignorer un post retire une trouvaille ; ignorer un trou dans la preuve
    // en fabriquerait. Les deux ne partagent pas de nom.
    const sources = [
      ...base,
      f(`${MAIN}/Orphan.kt`, 'package com.x\n\nclass Orphan\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(Orphan())\n    }\n}\n'),
      f(`${MAIN}/Broken.kt`, [
        'package com.x',
        '',
        '// kotlin-jump:ignore unheard-event',
        'class Broken {',
        '    @Subscribe',
        '    fun onBusEvent() {',
        '    }',
        '}',
      ].join('\n')),
    ];
    const result = scan(sources);
    expect(result.unreadable).toHaveLength(1);
    expect(result.events).toEqual([]);
  });

  it('un nom dans ignoreNames est tu', () => {
    const sources = [
      ...base,
      f(`${MAIN}/Orphan.kt`, 'package com.x\n\nclass Orphan\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(Orphan())\n    }\n}\n'),
    ];
    expect(names(sources, { ignoreNames: ['Orphan'] })).toEqual([]);
  });
});

describe('les têtes qui ne sont pas directement un type', () => {
  it('une entrée d’enum postée désigne son enum', () => {
    // `post(Mode.ALLOW)` poste une instance de `Mode`. Le dernier segment
    // n'est pas un type, donc sans repli le site est abandonné : 15 sites
    // réels perdus ainsi sur un vrai monorepo.
    const enumFile = f(`${MAIN}/Mode.kt`, 'package com.x\n\nenum class Mode {\n    ALLOW,\n    DENY,\n}\n');
    const poster = f(`${MAIN}/Gate.kt`,
      'package com.x\n\nclass Gate {\n    fun go() {\n' +
      '        EventBus.getDefault().post(Mode.ALLOW)\n    }\n}\n');

    expect(names([busFile, anySubscriber, heardEvent, enumFile, poster])).toEqual(['ALLOW']);

    const listener = f(`${MAIN}/GateListener.kt`,
      'package com.x\n\nclass GateListener {\n    @Subscribe\n' +
      '    fun onBusEvent(event: Mode) {\n    }\n}\n');
    expect(names([busFile, enumFile, poster, listener])).toEqual([]);
  });

  it('`Thing.INSTANCE` depuis du Java désigne l’objet Kotlin', () => {
    const sources = [
      busFile, anySubscriber, heardEvent,
      f(`${MAIN}/Ping.kt`, 'package com.x\n\nobject Ping\n'),
      f('/w/a/src/main/java/com/x/Poster.java',
        'package com.x;\n\npublic class Poster {\n    void go() {\n' +
        '        EventBus.getDefault().post(Ping.INSTANCE);\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual(['Ping']);
  });

  it('mais un segment final inconnu ne retombe PAS sur son conteneur', () => {
    // Un conteneur n'est pas un supertype de ce qu'il contient. Retomber
    // dessus signalerait le mauvais type, et le masquerait s'il est souscrit.
    const sources = [
      busFile, anySubscriber, heardEvent,
      f(`${MAIN}/Holder.kt`, 'package com.x\n\nobject Holder\n'),
      f(`${MAIN}/Poster.kt`,
        'package com.x\n\nclass Poster {\n    fun go() {\n' +
        '        EventBus.getDefault().post(Holder.Unknown())\n    }\n}\n'),
    ];
    expect(names(sources)).toEqual([]);
  });
});

describe('la variable locale construite juste au-dessus', () => {
  it('`val event = FooEvent(); post(event)` est résolu', () => {
    const sources = [
      busFile, anySubscriber, heardEvent,
      f(`${MAIN}/Orphan.kt`, 'package com.x\n\nclass Orphan(val v: Int)\n'),
      f(`${MAIN}/Poster.kt`, [
        'package com.x',
        '',
        'class Poster {',
        '    fun go() {',
        '        val event = Orphan(1)',
        '        EventBus.getDefault().post(event)',
        '    }',
        '}',
      ].join('\n')),
    ];
    expect(names(sources)).toEqual(['Orphan']);
  });

  it('deux constructeurs pour le même nom rendent le site ambigu', () => {
    // La variable a été réassignée : on ne sait pas laquelle atteint le post.
    const sources = [
      busFile, anySubscriber, heardEvent,
      f(`${MAIN}/A.kt`, 'package com.x\n\nclass AlphaEvent\n\nclass BetaEvent\n'),
      f(`${MAIN}/Poster.kt`, [
        'package com.x',
        '',
        'class Poster {',
        '    fun go(flag: Boolean) {',
        '        var event = AlphaEvent()',
        '        if (flag) event = BetaEvent()',
        '        EventBus.getDefault().post(event)',
        '    }',
        '}',
      ].join('\n')),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('une factory ou un builder restent hors de portée', () => {
    const sources = [
      busFile, anySubscriber, heardEvent,
      f(`${MAIN}/Orphan.kt`, 'package com.x\n\nclass Orphan\n'),
      f(`${MAIN}/Poster.kt`, [
        'package com.x',
        '',
        'class Poster {',
        '    fun go() {',
        '        val event = factory.createOrphan()',
        '        EventBus.getDefault().post(event)',
        '    }',
        '}',
      ].join('\n')),
    ];
    expect(names(sources)).toEqual([]);
  });
});

describe('les primitives', () => {
  it('le receveur se lit à travers les sauts de ligne', () => {
    // `EventBus\n  .getDefault()\n  .post(` est une forme réelle. Lire une
    // seule ligne perdrait le receveur, donc P1 écarterait à tort.
    const text = 'EventBus\n    .getDefault()\n    .post(Foo())';
    const clean = sanitizeForUsageScan(text);
    expect(receiverBefore(clean, clean.lastIndexOf('.post('))).toBe('EventBus.getDefault()');
  });

  it('le receveur d’un appel simple est le nom nu', () => {
    const clean = sanitizeForUsageScan('        bus.post(Foo())');
    expect(receiverBefore(clean, clean.indexOf('.post('))).toBe('bus');
  });

  it('la tête d’un argument distingue un type d’une variable', () => {
    const raw = 'Foo(1), new Bar(), Pause, event, builder.build(), ScreenEvents.Opened()';
    const at = (s: string) => ({ start: raw.indexOf(s), end: raw.indexOf(s) + s.length });
    expect(postedRef(raw, at('Foo(1)'))).toBe('Foo');
    expect(postedRef(raw, at('new Bar()'))).toBe('Bar');
    expect(postedRef(raw, at('Pause'))).toBe('Pause');
    expect(postedRef(raw, at('event'))).toBe('');
    expect(postedRef(raw, at('builder.build()'))).toBe('');
    expect(postedRef(raw, at('ScreenEvents.Opened()'))).toBe('ScreenEvents.Opened');
  });
});
