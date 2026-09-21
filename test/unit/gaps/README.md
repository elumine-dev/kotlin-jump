# Tests des trous de détection

Un fichier par trou de `doc/gaps-detection.md`. Ces tests décrivent le comportement
**voulu**, pas l'actuel : ils sont écrits avant l'implémentation et servent de cahier des
charges exécutable, comme les suites `test/unit/kj/`.

## En deux minutes

Ce dossier contient **quarante-et-un fichiers de tests** décrivant des trous de détection
mesurés sur le projet de référence. Ils décrivent le comportement **voulu**, pas l'actuel :
la plupart des cas positifs échouent, et c'est leur raison d'être.

| Si vous cherchez | Allez à |
|---|---|
| ce que veut dire un test rouge ici | *Comment lire ce dossier* |
| les comptes à jour | *Où en est le dossier* |
| quoi implémenter en premier | *Par où commencer* |
| vérifier que ce document dit vrai | *Les trois contrôles* |
| le détail d'un gap | *Ce que les mesures ont donné, gap par gap* |

**Deux chiffres pour situer.** Les deux plus gros gisements sont **G1** (46 fournitures
Dagger mortes, mesurées) et **G17** (~63 membres masqués, estimés). Les seize autres
entrées totalisent une quinzaine de trouvailles, mais plusieurs débloquent les premières :
corriger G9 fait tomber une partie de G7 sans effort.

**Et un avertissement.** Aucun de ces trous n'est un faux positif. Deux audits l'ont
vérifié sur les familles qui agissent sur le code : ce que le détecteur affirme est juste,
il en dit seulement moins qu'il ne pourrait.

# Comment lire ce dossier

## Comment lire un fichier

Chaque fichier a trois blocs.

**Le témoin de bonne formation.** Il prouve que la fixture est lisible et que le
détecteur fonctionne sur elle. Sans lui, un `it.fails()` pourrait échouer parce que la
fixture est mal écrite, et on croirait avoir décrit le trou alors qu'on décrit un bug de
test. Il doit passer.

**Les cas positifs, en `it.fails()`.** Ce que le détecteur devrait trouver et ne trouve
pas. `it.fails()` inverse le verdict : le cas « passe » tant que l'assertion échoue. Le
jour où l'implémentation arrive, le cas devient rouge et se signale tout seul.

**Les gardes, en `it()` ordinaire.** Ce qui ne doit **jamais** être rapporté. Elles sont
au moins aussi importantes que les cas positifs : c'est par là qu'une implémentation trop
large coupe du code vivant.

## Le canari, et pourquoi les gardes sont rouges

Une garde dit « le détecteur ne doit pas rapporter X ». Tant que le détecteur ne rapporte
**rien du tout** sur le motif (parce qu'une garde amont l'écarte entièrement), cette
phrase est vraie sans rien prouver. La suite serait verte et ne protégerait personne.

Chaque garde exige donc un **canari** dans le même appel : une déclaration morte de façon
évidente, que le détecteur doit rapporter. La garde devient « il juge bien ce corpus
**et** il épargne la cible ».

Conséquence voulue : **les gardes sont rouges aujourd'hui**, et c'est le verdict honnête.
Elles verdiront avec l'implémentation. Si la sentinelle tombe sans que les gardes passent,
c'est que l'implémentation juge mais se trompe.

Le canari n'est nécessaire que là où une garde amont écarte tout le motif, c'est à dire
pour G1 et G2. Quand le détecteur juge déjà le corpus, comme dans G4, les gardes passent
d'elles mêmes et pour la bonne raison ; le canari y reste par précaution, au cas où une
garde amont viendrait à s'élargir.

Les gardes du corpus tronqué mordent partout dès maintenant : elles s'appuient sur une
fixture que le détecteur juge déjà.

## La sentinelle

Elle fixe par écrit l'état mesuré aujourd'hui (« sur un `@Module`, rien n'est jamais
jugé »). Elle **échouera le jour de l'implémentation**, en même temps que les gardes
deviendront vertes. Les deux mouvements vont ensemble.

# Où en est le dossier

## État

Verdict au 2026-09-20, sur `npm run test:gaps` :
**511 verts, 26 rouges, 104 it.fails, 15 skippés = 656 cas**

Tableau régénéré depuis le run réel, pas saisi à la main.

Les huit trous du document ont leur fichier, plus G10, première piste ouverte instruite, plus
`Circuit`, qui n'est pas un trou mais la mesure du circuit complet.

| Trou | Fichier | Verts | Rouges | `it.fails()` | Skippés |
|---|---|---|---|---|---|
| Circuit | `Circuit.WhatTheWholeLoopStillMisses.test.ts` | 16 | 0 | 6 |  |
| G1 | `G01.AProvisionNobodyRequests.test.ts` | 4 | 9 | 8 |  |
| G2 | `G02.AModuleNobodyInstalls.test.ts` | 6 | 5 | 2 |  |
| G4 | `G04.AnInterfaceThatOnlyServesADeadBinding.test.ts` | 15 | 0 | 4 |  |
| G5 | `G05.AQualifierWhoseProvisionsAllDied.test.ts` | 7 | 6 | 5 |  |
| G6 | `G06.AKindTheDetectorNeverConsiders.test.ts` | 5 | 6 | 4 |  |
| G7 | `G07.AnInterfaceWhoseMethodsNobodyCalls.test.ts` | 17 | 0 | 5 |  |
| G8 | `G08.AViewOnlyADeadLayoutNames.test.ts` | 11 | 0 | 4 |  |
| G9 | `G09.AGuardThatNeverRelaxes.test.ts` | 11 | 0 | 5 |  |
| G10 | `G10.ASealedBranchNestedOutOfSight.test.ts` | 10 | 0 | 4 |  |
| G11 | `G11.ABuildConfigFieldNobodyReads.test.ts` | 2 | 0 | 1 | 10 |
| G12 | `G12.ANestedDeclarationNobodyJudgesWhole.test.ts` | 11 | 0 | 6 |  |
| G13 | `G13.AnIslandTooBigToBeSeen.test.ts` | 10 | 0 | 4 |  |
| G14 | `G14.AnUnappliedPluginWithParentheses.test.ts` | 27 | 0 | 2 |  |
| G15 | `G15.AnEntryHiddenByALibraryHomonym.test.ts` | 8 | 0 | 4 |  |
| G16 | `G16.ASymbolHiddenByALibraryHomonym.test.ts` | 8 | 0 | 4 |  |
| G17 | `G17.AMemberNameSharedWithEveryone.test.ts` | 9 | 0 | 4 |  |
| G18 | `G18.AResourceKeyTheePlatformAlsoDeclares.test.ts` | 9 | 0 | 3 |  |
| G19 | `G19.AnAssetNobodyOpens.test.ts` | 13 | 0 | 0 |  |
| G20 | `G20.AViewNoXmlNamesAnyMore.test.ts` | 16 | 0 | 0 |  |
| G21 | `G21.ALibraryCopiedInAndForgotten.test.ts` | 16 | 0 | 0 |  |
| G22 | `G22.AScopeAnnotationThatAnchorsItsNeighbours.test.ts` | 11 | 0 | 4 |  |
| G23 | `G23.AnAnchorThatIsAReadEntryPoint.test.ts` | 15 | 0 | 4 |  |
| G24 | `G24.APrivateHomonymIsNotAHomonym.test.ts` | 15 | 0 | 0 |  |
| G25 | `G25.ResolutionThatOnlyWorksOneWay.test.ts` | 14 | 0 | 1 |  |
| G26 | `G26.ThreeSourceSetsAreNotThreeClasses.test.ts` | 12 | 0 | 0 |  |
| G27 | `G27.AnUnjudgedSubtypeVouchesForItsParent.test.ts` | 12 | 0 | 2 |  |
| G28 | `G28.AFilterThatSwallowsItsVerdict.test.ts` | 22 | 0 | 0 |  |
| G29 | `G29.ADiscoveryThatStopsAtTheFamilyBorder.test.ts` | 16 | 0 | 2 |  |
| G30 | `G30.AnOverrideWhoseWholeChainIsVisible.test.ts` | 14 | 0 | 4 |  |
| G31 | `G31.AMemberNoSupertypeDeclares.test.ts` | 11 | 0 | 1 |  |
| G32 | `G32.AnOverlayThatCoversNothing.test.ts` | 14 | 0 | 0 |  |
| G33 | `G33.AWalkThatOnlyATestTakes.test.ts` | 11 | 0 | 3 |  |
| G34 | `G34.TheSameDiscoveryMissingAThirdTime.test.ts` | 15 | 0 | 1 |  |
| G35 | `G35.OneFileThatSilencesAWholeFamily.test.ts` | 16 | 0 | 0 |  |
| G36 | `G36.WhenTwoAnswersDisagree.test.ts` | 18 | 0 | 0 |  |
| G37 | `G37.TwoFindingsOneEdit.test.ts` | 10 | 0 | 0 |  |
| G38 | `G38.AVerdictBuiltOnUnjudgedWitnesses.test.ts` | 12 | 0 | 1 |  |
| G39 | `G39.AHolderNobodyRuns.test.ts` | 11 | 0 | 3 |  |
| G40 | `G40.OneRuleBehindSixHoles.test.ts` | 19 | 0 | 2 |  |
| G41 | `G41.TheSecondRuleBehindThreeHoles.test.ts` | 18 | 0 | 0 |  |

## Ce qui est déjà corrigé

Six trous sont fermés. Leur signe commun : **plus aucun `it.fails()`** dans leur fichier,
parce que chaque cas attendu-en-échec est devenu vert.

| Trou | Correctif | Fichier de `src/` | Mesuré sur le projet de référence |
|---|---|---|---|
| G29, G34, G22 | passer les portées `@Scope` découvertes aux membres et aux îlots | `unusedMembers.ts`, `deadIslands.ts` | `M4` 4815 → 3067, membres 135 → 150, îlots 20 → 30, **0 perdue** |
| G36 | `alive:same-file` s'applique quelle qu'ait été la branche KJ-067 | `unusedSymbols.ts` | `find` 136 = `explain` 136, plus aucun désaccord |
| G28 | exposer `wouldBe` et `selfInFile` | `unusedSymbols.ts` | 0 trouvaille, mais une garde se mesure sans la simuler |
| G24 | un `private` de premier niveau n'est pas un homonyme | `unusedSymbols.ts` | `F3` 763 → 723, 40 angles morts levés, `find` inchangé |
| G37 | une étendue partagée ne rend qu'une trouvaille | `unheardEvents.ts` | 1 doublon fondu, les fratries à étendues distinctes conservées |
| G35 | une table de correspondance n'est pas une lecture de tout | `unusedRemoteConfigKeys.ts` | 3 déclencheurs sur 4 étaient abusifs, 29 clés atteignables |
| G30 | `M2` devient conditionnel, et la chaîne se résout par import | `unusedMembers.ts` | +23 surcharges jugées, toutes retenues par une garde de compilation |
| G27 | `F8` ne se laisse cautionner que par une annotation qui FABRIQUE | `unusedSymbols.ts` | **F8 93 → 0**, +1 trouvaille, compilée sur les deux apps |
| G26 | trois source sets qui s'excluent ne font pas trois classes | `unusedSymbols.ts` | **F3 723 → 720**, 0 trouvaille, 3 déclarations enfin jugées |
| G21 | la famille des îlots ABSORBE ses déclarations F7 au lieu de les prendre pour son extérieur | `deadIslands.ts`, `unusedMembers.ts` | **îlots 20 → 50**, plan 549 → 579, quatre coupes compilées |
| G38 | `selfOnly` exige au moins un témoin porté par un membre vivant | `unusedMembers.ts` | **selfOnly 180 → 162**, 0 suppression touchée |
| G14 | le filtre des plugins non appliqués lit les cinq formes du Kotlin DSL | `ResourceCorpus.ts` | **45 → 44 modules bibliothèque**, plan inchangé |
| G31 | `M3` ne retient plus un membre Java qu'aucun ancêtre ne déclare | `unusedMembers.ts` | **+8 trouvailles**, les huit compilées ensemble |
| G32 | la garde de recouvrement ne s'applique que si quelqu'un nomme la ressource | `UnusedResourceProvider.ts` | 0 trouvaille, et la mesure de G32 était fausse |
| G20 | `F7` ne s'applique plus aux VUES : ce scanner lit le XML | `unusedSymbols.ts` | **+5 symboles**, compilés sur les deux apps |
| G19 | `assets/` gagne une représentation, dans son propre canal | `UnusedResourceProvider.ts`, `ResourceCorpus.ts` | **+3 assets**, 33 Ko, compilé |

**G35 mérite un mot, parce que son chiffre ne s'est pas réalisé tel quel.** Le
coupe-circuit voyait trois sites, et deux étaient des tables de correspondance : un
`.all.getValue(clé)` ne lit que cette clé-là. Ils ne déclenchent plus. Mais la regex qui
cherchait ces sites en manquait un quatrième, `FirebaseRemoteConfig.getInstance().all`
dans l'écran de mise au point qui liste toutes les valeurs, et celui-là est un vrai
balayage. L'élargir était la seule honnêteté possible : s'appuyer sur un angle mort pour
annoncer un gain n'en est pas un.

La famille reste donc éteinte sur le projet de référence, mais pour une raison unique,
nommée, et levable en une ligne : le marqueur `kotlin-jump:ignore unused-remote-config-key`
posé sur le fichier qui balaie rend les 29 clés. Et `explain` ne contredit plus `find` : il
répond `R4:every-key-read:<le fichier>` au lieu de `unreferenced`.

**G30 est le cas où la compilation a décidé du correctif.** M2 (`@Override`) est le plus gros
filtre du projet, 4965 membres. Le rendre conditionnel à une chaîne entièrement visible a
libéré 23 surcharges. J'en ai coupé une, `FileServiceImpl.createTempFile`, et compilé :
`:common:compileDebugKotlin` a échoué. Le contrat
`FileService.createTempFile(): File?` restait, la classe n'implémentait plus son interface.

Les 23 sont toutes dans ce cas : ce sont des **paires**, et la paire est la vraie trouvaille.
Elles sont donc retenues par `M11:bound-by-contract` jusqu'à ce que la famille sache porter
une coupe liée. Le gain net sur le projet de référence est zéro, et c'est la seule réponse
qui ne casse pas le build.

Deux autres gardes sont venues de la mesure, pas du raisonnement :

- **Un supertype homonyme d'un type de bibliothèque.** `HostFirebaseMessagingService`
  étend le `FirebaseMessagingService` de Firebase, et le projet déclare sa propre
  `interface FirebaseMessagingService`. Résolue par nom nu, la chaîne paraissait visible :
  `onNewToken` et `onRegistered` cessaient d'être gardées et cinq îlots morts apparaîssaient
  sur des rappels que Firebase appelle. Les notifications push seraient parties avec. La
  résolution passe maintenant par l'**import** du fichier.
- **Un homonyme de membre entre classes sœurs.** `PageExternalAnalyticsIdModelHelper` et
  `PageAnalyticsIdModelHelper` surchargent toutes deux `restoreIdModel`. La récolte compte
  par nom, donc la déclaration de l'une prouvait la vie de l'autre, et un îlot mort
  disparaissait. Tant qu'une déclaration du même nom n'est ni la sienne ni celle d'un
  ancêtre, M2 reste la seule réponse honnête.

Après ces trois gardes, le diff sur le projet de référence est **vide dans les deux sens** :
mêmes 333 membres, mêmes 20 îlots, même plan à 548 coupes.

**G27 est le plus gros déblocage du dossier, et le moins spectaculaire.** F8 disait « un
parent dont le sous-type appartient à un cadre est lui-même atteint par ce cadre », mais
acceptait n'importe quelle annotation non bénigne. Mesuré sur le projet de référence, ses
cautions étaient :

| Caution | Parents écartés | Fabrique quelque chose ? |
|---|---|---|
| `@ScopeApplication`, `@ScopeActivity`, `@ScopeFragment`… | 119 | non, ce sont des portées DI |
| `@UnstableApi` | 32 | non, un marqueur d'opt-in |
| `@Provides`, `@Component`, `@Subcomponent`, `@Module` | 29 | non |
| `@RunWith`, `@SmallTest`, `@LargeTest`, `@Rule` | 22 | non, des annotations de test |
| `@Parcelize`, `@Database`, `@TypeConverters` | 12 | **oui** |

Une liste **positive** est la seule forme qui dise ce que la règle prétend dire. Résultat :
**F8 passe de 93 déclarations à zéro**, et une seule trouvaille apparaît.

Cette trouvaille, `BlockingOnClickListener` (`core/ui/…/utils/touch/`), valait la
vérification : le dépôt en contient **trois** du même nom simple, dans trois paquets, et 59
lignes le nomment. Toutes importent `com.example.app.common.touch` ou
`com.example.host.common.touch` ; **rien** n'importe la `core`. F8 la protégeait parce
qu'un sous-type annoté d'un de ses homonymes cautionnait le nom NU. Coupe appliquée,
`:app` et `:host` compilés : **EXIT 0**.

**Une garde retirée parce qu'aucun mutant ne la tuait.** J'avais aussi exclu les portées DI
explicitement (KJ-070, troisième site). Le mutant qui supprime cette exclusion ne fait tomber
aucun témoin : la liste positive les écarte déjà. Code mort, retiré.

**G26 est le plus petit correctif du lot, et celui dont les gardes étaient les plus fausses.**
Android compile un type de build à la fois : une classe déclarée dans `debug`, `release` et
`staging`, même module et même paquet, est une classe en trois versions. F3 en voyait trois.
La preuve qu'elles s'excluent, c'est le projet lui-même : deux source sets actifs ensemble
qui déclarent la même classe ne compilent pas.

Résultat exactement conforme à la table de frontière de G26 :

| Cas | Avant | Après |
|---|---|---|
| `ShortcutHelper` ×3, même module et paquet | `F3` | **`alive:main`** |
| `LogModule` dans `app` **et** `host/app` | `F3` | `F3`, à juste titre |
| `BaseActivity` ×3 plus une quatrième dans `host/base` | `F3` | `F3`, à juste titre |

**Les mutants ont trouvé deux trous dans mes propres gardes.** Trois vérifications protegent
la fusion : pas de `main`, source sets tous distincts, clé module + paquet. Seule la première
était éprouvée. Les deux gardes existantes du fichier se couvraient mutuellement — « deux
modules, même paquet » mettait les deux copies dans le même source set, donc c'était
l'unicité des source sets qui la sauvait, pas la clé. Deux cas ajoutés, et les trois mutants
tombent.

**G21 est la plus grosse récolte du dossier, et celle qui a demandé le plus de prudence.**
Une déclaration écartée par un filtre n'est pas **prouvée vivante**, elle est **non jugée** ;
la prendre pour l'extérieur de l'îlot en fait un citant vivant que personne n'a jugé. Deux
classes F7 tenaient ainsi neuf fichiers d'une bibliothèque recopiée et morte.

Ce que F7 dit — « le cadre peut instancier un sous-type sans le nommer » — cette famille sait
le vérifier elle-même : le manifeste et les layouts enracinent (`alive:root`), ce que le
filtre amont ne sait pas faire. L'absorber dans le bassin, c'est le faire juger par le
modèle qui répond à la question.

**Îlots 20 → 50.** Quatre coupes compilées sur les deux apps, couvrant chaque forme : une
classe `View` morte entière, des membres d'un `Fragment` vivant, une paire homonyme sur deux
`Activity`, six membres d'un autre `Fragment`.

**Un faux positif attrapé avant de sortir.** `AppApplication.breakingNewsController` est
un `@Inject lateinit var`, que le code généré de Dagger écrit. Il sortait en
`M4:F7:Application` parce que sa classe étend `Application`, et non en `M6:@Inject` : le
filtre du cadre passait **avant** celui de l'annotation du membre. Absorbé dans le bassin, il
devenait un îlot mort. `M6` passe maintenant avant `M4` — les deux écartent, donc aucune
trouvaille de la famille des membres ne change, c'est l'étiquette qui compte et la famille
des îlots la lit.

**Cinq suites existantes reposaient sur le défaut.** `KJ046`, `KJ066`, `KJ067`, `KJ069` et la
garde de `G21` elle-même utilisaient toutes une `Activity` comme ancre, précisément parce que
F7 la gardait vivante gratuitement. La garde « une ancre que quelqu'un construit garde le
groupe entier » passait donc **pour une raison qui n'était pas la sienne** : l'ancre étant
hors du bassin, rien de ce qui la nommait ne comptait. Chaque fixture a reçu la vraie raison
de vivre qu'elle simulait — une entrée au manifeste, ou un point d'entrée qui l'appelle.

**G38 ne touche aucune suppression, et c'est le but.** `selfOnly` est le seul verdict qui
déclenche une **transformation** : `MakeSelfOnlyPrivate` propose de passer le membre en
`private`. Il exige maintenant qu'au moins un témoin soit porté par un membre vivant. 18
propositions retirées, zéro suppression changée. Exemple vérifié : le seul témoin de
`AdSpotView.Companion.cacheAd` est dans un `override fun didLoad`, que personne n'a jugé.

**G14 ne rapporte rien, et c'est le seul dont on peut dire qu'il protège.** Le filtre ne
lisait que `apply false` ; `.apply(false)`, la forme d'appel du Kotlin DSL, lui échappait —
et c'est celle que le build racine du projet de référence écrit, quatorze fois. La racine
était donc comptée parmi les 45 modules bibliothèque. **45 → 44**, plan inchangé à 579.

Le coût était cosmétique. Ce que le trou **pouvait** coûter ne l'était pas, et je l'ai tracé
dans le câblage plutôt que de reprendre la note :

```
moduleDirs  = chaque chemin de build.gradle, suffixe retire  → pour la RACINE, la racine elle-même
publishedModules = moduleDirs dont le build declare la publication
F14:published    = isUnder(chemin, un de ces dirs)            → vrai pour TOUT le corpus
```

Un projet qui écrit `alias(libs.plugins.mavenPublish).apply(false)` à sa racine éteignait son
détecteur de symboles morts **partout, sans un message pour le dire**. Le fichier de G14
porte maintenant quatre témoins qui rejouent cette chaîne, dont un qui vérifie qu'un plugin
de publication réellement appliqué éteint bien tout — sans quoi les trois autres seraient
vrais par vacuité.

Un mutant qui remet l'ancien filtre tue huit témoins.

**G31 rapportait deux membres. Il en rapporte huit.** M3 écarte tout membre d'une classe
Java portant un supertype, parce qu'en Java `@Override` est optionnel. La relache tient en
une condition, et elle réutilise la machinerie de G30 : toute la chaîne d'ancêtres est
résolue ici, aucun d'eux ne déclare ce nom, et aucun homonyme ne rend les mentions
inattribuables.

Les huit, vérifiées une par une par grep exhaustif : chacune a **une seule occurrence**, sa
propre déclaration. La seconde occurrence de `setBehaviors` est un commentaire
(« Child classes MUST call setBehaviors »), et le layout `fragment_admin_rateme.xml` n'a pas
de bloc `<data>`, donc pas de data binding. `GraphApp.activityUi` avait l'air d'une
méthode de composant Dagger : c'est une helper `static` d'une classe `final`.

Les huit coupées ensemble dans cinq fichiers, `:app:assembleDebug` : **✅ 89 s**.

**G32 : le correctif est juste, et la mesure du document était fausse.** La garde de
recouvrement protège d'une ambiguïté de **résolution** ; quand personne ne demande le nom,
il n'y a rien à résoudre. Elle s'appliquait pourtant avant même de regarder les références.

Mais le seul candidat qu'elle coûtait, `layout/text_pair`, **n'est pas mort**. Aucun fichier
n'écrit la chaîne `text_pair` — c'est ce que la sonde avait mesuré — mais le view binding
génère `TextPairBinding`, que deux modules importent, chacun pour sa copie. Le détecteur le
savait déjà par son ensemble `bindings` ; c'est la relecture à la main qui avait manqué le
chemin. **Sixième sonde fausse du document, et la première où le détecteur avait raison
contre moi.**

**G20 tient en une observation.** Une classe qui prolonge `View` a deux voies
d'instanciation : `new X(...)` dans du code, ou une balise XML que `LayoutInflater` lit par
réflexion. C'est la seconde, invisible à une analyse de **code**, qui justifiait le filtre.
Mais ce scanner **lit le XML** : la balise, le style, la règle de conservation sont toutes
des mentions que la récolte compte déjà. Le filtre couvrait une invisibilité qui n'en est
pas une.

**+5 symboles**, zéro perdu. `DebugMenuListener` méritait un regard : le dépôt en déclare
deux, et l'import du seul appelant désigne la copie `core` ; la copie `host` est bien
morte, et c'est la résolution d'homonymes qui le dit. Les cinq coupées ensemble sur les deux
apps : **EXIT 0** (premier essai en échec, rejeu vert — le cache KSP, pour la troisième fois,
désormais rejoué par l'outil lui-même).

Rien de tel pour un `Fragment`, une `Activity` ou un `Worker` : leur contrat d'instanciation
passe par un nom de classe que le corpus ne contient pas forcément, un `Fragment` se
reconstruisant après une rotation à partir du nom rangé dans son `Bundle`. Trois suites
voisines l'utilisaient comme exemple canonique de F7 et ont été réécrites : `G21`, `G28`,
`G40`.

**G19 a demandé trois mesures pour trouver sa forme**, et c'est la partie intéressante.

| Tentative | Résultat | Ce qui n'allait pas |
|---|---|---|
| assets dans `sources`, tous source sets | **40 assets**, run > 600 s | 55 Mo de `.otf` décodés en UTF-8 dans la récolte |
| binaires par leur chemin seul | 40 assets, 43 s | vingt `.zip` de `savedAndroidTest`, des bouchons de `src/debug` |
| `src/main/assets/` seulement | 5 assets | `css/fonts.css` et un gabarit `.CHANGE_ME` |
| **canal séparé, deux gardes** | **3 assets** | — |

Le défaut de fond n'était pas le compte, c'était le **canal**. Versé dans `sources`, le texte
d'un asset passe dans la récolte générale et garde en vie n'importe quelle déclaration dont
le nom y figure par hasard : mesuré, une extension `observe` cessait d'être rapportée parce
qu'un JSON de bouchon contenait le mot. C'est exactement l'avertissement que le corpus porte
déjà sur les `.txt` de R8. Les assets ont donc leur propre champ, et leur texte ne sert
qu'à décider de la vie d'un **autre** asset.

Les trois trouvailles sont celles que G19 annonçait, et aucune n'est nommée nulle part dans
le dépôt. La règle des frères tient : `DynamicAdAnimationHelper.kt` porte **14** littéraux
`lottie/dynamicAd/`, donc le dossier est lu par littéraux, donc celui qui n'y figure pas est
mort.

**Un défaut trouvé en chemin, hors liste.** `RemoveEverythingUnused` lisait une trouvaille
de Remote Config à plat (`k.path`, `k.removeStart`), alors qu'elle porte un nom et la liste
de ses déclarations, une par variante de build. Trois `undefined`, rangés sous une clé
`undefined` sans que rien ne proteste. Invisible jusqu'ici : le coupe-circuit rendait zéro
trouvaille, donc la boucle ne tournait jamais. Corrigé, avec deux témoins dans
`KJ050.RemoveEverythingUnused.test.ts` qui tombent tous les deux si on remet l'ancienne
lecture.

Pour G1 et G2, les verts sont : le témoin de bonne formation, la sentinelle, et la garde
du corpus tronqué. Tout le reste est rouge ou en échec attendu.

**G4 est différent, et c'est un bon signe.** Ses 8 gardes passent réellement, parce que
le détecteur juge bel et bien ce corpus : il rapporte une interface quand elle est seule.
Il n'y a donc pas de vacuité à craindre, et la protection est déjà mesurée. Seuls les 4
cas positifs échouent.

**G5 et G6 sont les cas les plus nets.** Leurs gardes échouent toutes sur
`expected [...] to include 'CanaryGone'` : le canari est une déclaration de la sorte
ignorée, et cette sorte n'est jamais jugée. Le message d'échec nomme au passage ce que le
détecteur rapporte *bien* dans le même appel (`[ 'Repo' ]`, `[ 'build' ]`,
`[ 'navigate' ]`, `[ 'Box' ]`), ce qui prouve que le corpus est lu et que seule la sorte
est ignorée.

**Partage entre G5 et G6.** Les deux sortes tombent par le même mécanisme, mais ne se
cassent pas de la même façon, donc elles ont chacune leur fichier. `G05` traite
l'annotation : sa cascade Dagger, et les gardes de réflexion (`AnnotationRetention.RUNTIME`,
`@interface` sans `@Retention`). `G06` traite le `typealias`, qui a un piège bien à lui :
un alias de classe s'appelle comme un **constructeur**, pas seulement comme un type.

**G7, comme G4, a toutes ses gardes vertes et significatives.** Le détecteur juge bien ces
corpus : il rapporte une interface seule, et une méthode morte qui ne surcharge rien. Les
canaris (`CanaryGone` côté symboles, `canaryGoneMember` côté membres) sont donc réellement
rapportés, et chaque garde teste quelque chose.

**Partage entre G4 et G7.** `G04` couvre l'interface dont le seul usage comme type est une
liaison Dagger morte. `G07` couvre celle qui n'est jamais utilisée comme type du tout, et
son apport propre est ailleurs : dans la **coupe**. Ses deux sous-familles se distinguent
par ce qui part avec l'interface, ce que le fichier teste des deux côtés à la fois,
`findUnusedSymbols` pour l'abstraction et `findUnusedMembers` pour la surcharge.

**G8 teste une cascade, donc des rondes.** Ses fixtures sont données au détecteur telles
que la boucle de point fixe les verrait à chaque tour : R1 tout présent, R2 sans le
contrôleur, R3 sans le layout non plus. La sentinelle fixe la progression mesurée
(5 → 5 → 3 mentions, toujours vivante) et le point de rupture. Les étages 1 et 2 de la
cascade sont couverts par l'extension et ne sont pas retestés ; le fichier commence à
l'étage 3, là où elle s'arrête.

**G9 est le seul dont les gardes décrivent ce qu'il faut CONSERVER.** Elles passent déjà
et doivent continuer à passer : la garde « supertype hors du corpus » a raison au premier
tour, puisque la balise XML instancie bel et bien la classe. Un relâchement trop large
supprimerait une vue que le layout instancie, et le compilateur ne rattraperait pas — le
projet compile, puis plante à l'inflation. C'est une panne d'exécution, pas de build, donc
la seule protection est ici.

Sa sentinelle est la plus nette du dossier : même corpus, même motif d'injection, seul le
supertype change, et le verdict bascule.

```
supertype DANS le workspace   -> unreferenced, via=injection, 2 sites
supertype HORS workspace      -> alive:main, non rapportée
aucun supertype               -> unreferenced, via=injection, 2 sites
```

**Ce dossier est hors de la porte `npm test`.** Vingt-six de ses cas sont rouges par
conception, et le resteront tant que les trous correspondants ne seront pas bouchés. Les
laisser dans la porte la rendrait rouge en permanence, donc muette : une suite qui échoue
toujours ne dit plus rien quand elle échoue.

```
npm test            8420 verts, la porte
npm run test:gaps    511 verts, 26 rouges, 104 it.fails
```

L'exclusion vit dans `vitest.config.ts`, le dossier a sa propre config dans
`vitest.gaps.config.ts`. C'était une décision de projet, pas une décision de test.

**G3 n'aura pas de fichier.** Décision de Kevin du 2026-09-20 : ce n'est pas une erreur,
rien à changer. Le `@Suppress("unused")` continue de protéger. Ne pas écrire de test qui
contourne cette protection, et ne pas toucher aux suites existantes qui l'affirment.

# Par où commencer

## Quelle famille implémenter en premier

Mesure consolidée sur le corpus de référence, utile pour décider de l'ordre :

| Trou | Trouvailles réelles |
|---|---|
| G1 | **46 en production** (65 au total) sur 393 |
| G5 | 5 |
| G7 | 4 sur 6 candidats |
| G9 | 2, dont 1 réelle |
| G2, G4, G11 | 1 chacun |
| G6, G10 | 0 au premier tour |

G1 vaut plus de 80 % du gisement, et c'est aussi la famille la plus délicate : c'est là
que ses huit gardes comptent le plus. G6 et G10 pèsent zéro aujourd'hui mais gardent leur
intérêt, leur valeur étant au tour suivant de la boucle.

G1, G8 et G9 se tiennent : G8 constate qu'une cascade s'arrête, G9 en donne la cause, G1
fournit le premier maillon.

## La famille des homonymes est complète

Quatre étages, un seul mécanisme : **une mention qualifiée par un autre porteur compte
quand même pour le nom local.**

| | Ce qui masque | Ce qui est perdu | Ampleur mesurée |
|---|---|---|---|
| G15 | `Proxy.Type.HTTP` | `UriScheme.HTTP` | 1 entrée |
| G16 | `kotlin.Result` | `com.x.Result` | 0, risque sur `Size` (4 imports) |
| G17 | `OtherBuilder.build()` | `Builder.build()` | 59 % de couverture, **~63 membres** |
| G18 | `android.R.string.cancel` | `R.string.cancel` | 0, risque sur `transparent` |

**L'ordre de traitement s'en déduit : G17 d'abord, de très loin.**

Une nuance pour le correctif : G15 et G18 ont déjà une résolution partielle qui fonctionne
— par enum du corpus pour l'un, par préfixe `@android:` pour l'autre. G16 et G17 n'en ont
aucune.

Troisième `it.fails()` du dossier à me corriger : la forme XML `@android:string/cancel`
était déjà traitée. Le cas est passé dans les gardes, avec la note.

## Quels trous sont déjà couverts ailleurs

Vérification systématique, après la découverte du recouvrement sur G12.

**G4 : aucun recouvrement.** Les trois familles qui pourraient l'attraper se taisent, et
chacune pour une raison différente — les îlots ne se forment pas (le `@Module` n'est pas
candidat), les symboles voient l'interface `alive:main` (sa clause `implements`), KJ-072
exige des surcharges vides (or `setTitle` a un corps). Trois tests le fixent.

**G7 : couvert, puis cesse de l'être.**

| Corpus | `findDeadIslands` |
|---|---|
| l'interface et sa vue, seules | rapporte l'îlot |
| + les deux déclarations d'injection | **rien** |

La deuxième ligne est le cas réel de la vitrine. L'îlot se défait parce que les injections
nomment la vue — c'est le mécanisme de G9 vu depuis une autre famille.

**Conséquence pour l'ordre de traitement : corriger G9 ferait tomber une partie de G7 sans
effort**, l'îlot se reformant dès que les déclarations d'injection cesseraient de compter.
C'est un argument pour traiter G9 tôt malgré son faible volume propre.

## Vérification du recouvrement, complétée

Chaque entrée confrontée aux trois familles qui pourraient l'attraper :

| Entrée | Îlots | Symboles | Membres | Verdict |
|---|---|---|---|---|
| G2 module orphelin | rien | rien | rien | trou entier |
| G4 abstraction pour liaison morte | rien | rien | rien | trou entier |
| G5 qualificateur | rien | rien | rien | trou entier |
| G11 `buildConfigField` | rien | rien | rien | trou entier |
| G7 interface sans appel | **couvert**, puis non | rien | — | conditionnel |
| G12 déclaration imbriquée | — | rien | partiel | enums vides déjà couverts |

**Ce qui fait tenir ces trous, c'est que les gardes s'empilent.** Pour G2, les îlots ne se
forment pas (le module n'est pas candidat), les symboles l'écartent par `F5:@Module`, les
membres par l'annotation étrangère sur `@Provides`. Si l'une tombait, les deux autres
continueraient de taire le motif. G5 cumule même deux trous du document — celui de G1 sur
la fourniture et celui de G6 sur la sorte.

Six tests de plus verrouillent ces constats, trois dans `G02` et trois dans `G05`.

# Les trois contrôles

## Le tableau d'état est régénéré, plus saisi à la main

Après vingt tours d'ajouts, les comptes du tableau avaient dérivé sur plusieurs lignes : je
les mettais à jour de mémoire à chaque fichier touché. Il est maintenant produit depuis le
run réel par `tableau.mjs`, à lancer ainsi :

```
npx vitest run test/unit/gaps/ --reporter=json --outputFile=/tmp/gaps.json
node test/unit/gaps/tableau.mjs
```

**Un piège dans le compteur, qui vaut d'être noté.** La première version comptait les
`it.fails(` par une recherche de texte, et annonçait 11 cas positifs pour G1 alors qu'il
en a 8. La cause : les docstrings de ces fichiers **citent** `it.fails()` en prose, pour
expliquer la convention. Le compteur ne retient plus que les lignes dont le premier mot est
l'appel.

C'est exactement le motif que ce dossier documente ailleurs — une mention dans un
commentaire comptée comme un usage — rencontré cette fois dans mon propre outillage.

## Les références au corpus sont vérifiées

Les fichiers de ce dossier citent **82 références `fichier:ligne`** du projet de
référence. Elles sont le lien entre un test et le motif réel qu'il reproduit : si l'une
est fausse, le lecteur suit une piste morte.

`verif-references.mjs` les contrôle toutes, à lancer ainsi :

```
node test/unit/gaps/verif-references.mjs
```

Résultat : **82 fichiers trouvés, 82 lignes existantes, 76 vérifiables en contenu, zéro
décalage.**

**Le critère a dû être resserré trois fois, et chaque version rendait des faux décalages
avant d'être corrigée :**

| Critère essayé | Faux décalages | Pourquoi |
|---|---|---|
| l'identifiant suit la référence dans le commentaire | 17 sur 24 | « MORTE », « écrit », « VIVANTE » pris pour des identifiants |
| la ligne n'est pas un `import` | 10 de plus | plusieurs entrées citent l'import **comme** une occurrence du symbole |
| la ligne n'est pas un commentaire | 4 de plus | G13 cite « Please do not modify », qui **est** le marqueur |

Ce qui reste est le seul critère défendable : la ligne existe et n'est ni vide ni une
accolade seule. Dans ce dossier, un import et un commentaire sont des cibles légitimes.

C'est la quatrième fois qu'une sonde rapide annonce un problème qui se dissout à l'examen
des exemples. Le réflexe qui a servi à chaque fois : lire les trois premiers cas avant de
croire le chiffre.

## Les fixtures sont confrontées aux vrais fichiers

Dernier maillon de l'audit : une fixture peut citer le bon `fichier:ligne` et **perdre
l'essentiel en simplifiant**. Rien ne le signalerait — le test passerait sans tester le
vrai cas.

`verif-fixtures.ts` charge les vrais fichiers derrière six entrées et vérifie que le
détecteur, ou la mesure, y rend le même verdict :

```
npx tsx test/unit/gaps/verif-fixtures.ts
```

| Gap | Vrais fichiers | Verdict |
|---|---|---|
| G4 | `ShellMainLayout` + impl + module | rien, conforme |
| G15 | `UriScheme` + `OkHttpBuilderFactory` + `UrlControllerImplementation` | `FILE, HTTPS` — **`HTTP` bien masquée** |
| G1 | `ExoModule` | rien, conforme |
| G12 | `DatabaseService` | `DatabaseService`, pas `OrderBy`, conforme |
| G19 | les 13 fichiers de `lottie/dynamicAd/` + son `when` | 12 nommés, `300x600_data.json` orphelin |
| G19 | les 5 fichiers de `lottie/onboarding/` + les layouts | `login_finished.json` orphelin |

**Une limite à connaître :** un sous-corpus de trois fichiers rapporte des trouvailles
**périphériques** qu'un corpus complet n'aurait pas. G15 en donne l'exemple :
`UriScheme.FILE` ressort ici parce que son unique usage vit dans un fichier non chargé,
alors qu'elle est vivante sur le corpus entier. Ce qui compte est le verdict sur la
**cible**, pas la liste complète — et sur la cible, les quatre concordent.

Le dossier porte donc trois contrôles, tous nés d'une dérive constatée :

| Outil | Ce qu'il garantit |
|---|---|
| `tableau.mjs` | les comptes du README viennent du run, pas de ma mémoire |
| `verif-references.mjs` | les 200 `fichier:ligne` cités existent et disent ce qu'on annonce |
| `verif-fixtures.ts` | les fixtures reproduisent le verdict des vrais fichiers |

Les deux dernières lignes de `verif-fixtures.ts` ne lancent pas de détecteur, puisque G19
n'en a pas : elles refont la mesure des frères sur le vrai dossier. Si quelqu'un ajoute une
animation ou corrige le `when`, le contrôle le dira avant que le document ne mente.

## Contrôle de cohérence du dossier

Vérifié ce tour-ci, fichier par fichier :

- **Chaque fichier a exactement une sentinelle.** Aucun n'en a deux, aucun n'en manque.
- **Dix fichiers sur onze ont un canari.** Le onzième est `G11`, dont le détecteur n'existe
  pas du tout, et c'est documenté plus haut.
- **Aucune garde n'affirme une absence sans preuve de vie.** Toutes passent par `epargne`,
  ou portent leur propre `toContain(canari)` avant le `not.toContain(cible)` — y compris
  les trois cas hors helper : la garde « module publié » de G06, celle des méthodes de
  plateforme de G07 (`toString`, `onDetachedFromWindow`), et la sentinelle de G10.

Les trois `not.toContain` restants sont dans des `it.fails()`, donc des cas positifs et non
des gardes.

# Ce que les mesures ont donné, gap par gap

## Mesures faites avant d'écrire

Chaque fichier s'appuie sur un contrôle exécuté hors suite, pour que les `it.fails()`
échouent sur la bonne cause et pas sur une fixture mal formée.

**G1** — la garde des annotations étrangères (`unusedMembers.ts:446`) :

```
SANS annotation   -> 2 trouvailles : provideEvictor, provideDatabaseProvider
AVEC @Provides    -> 0 trouvaille
```

**G2** — `explainSymbols` donne la cause exacte, et elle n'est pas celle que le document
supposait au départ :

```
MainActivityV2Module  -> class / F5:@Module
MainActivityV2Wiring  -> class / F5:@Module   (même corps, autre nom)
PlainWiring           -> class / unreferenced (même corps, sans l'annotation)
```

Ce n'est donc pas le suffixe `Module` de `FRAMEWORK_NAME_SUFFIXES` qui écarte la classe,
c'est l'annotation `@Module` absente de `BENIGN_TOPLEVEL_ANNOTATIONS`. Renommer ne change
rien, la sentinelle de `G02` le verrouille.

## Correction du chiffre de G1

Les 64 fournitures mortes ne sont pas homogènes : **46 sont en production**, 16 dans le
module de démonstration `demo/adkit`, 2 dans un module que la sonde n'a pas localisé.
Le chiffre à retenir pour décider de l'ordre est 46.

Les seize de la démo partagent une forme qui appelle son propre cas de test, désormais
dans `G01` : `fun provideEmptyContentCardRepository() = object : ContentCardRepository { … }`.
Le type de retour est **implicite** et la valeur est un objet anonyme de plusieurs
dizaines de lignes. Le détecteur devra lire le type depuis l'expression, et la coupe
emportera tout le corps de l'objet.

## G1 : les homonymes, et une troisième correction de l'oracle

Trois fournitures **identiques** dans trois modules, trois verdicts différents :
`ContextualNewsModule.kt:129` morte, `NewsModule.kt:127` **vivante**,
`ShowcaseModule.kt:106` morte. Un détecteur qui raisonnerait par nom de méthode se
tromperait dans les deux sens. Le cas est dans `G01` : il vérifie que le verdict se prend
par `(container, méthode)`.

L'oracle lui-même a dû être corrigé deux fois de plus :

- **Par sous-chaîne, une `Factory` peut en masquer une autre.**
  `ProvideModule_ProvideAdProviderFactory` est un suffixe de
  `CoreUiProvideModule_ProvideAdProviderFactory`. Avec des frontières de mot, le compte
  passe de 64 à **65**.
- **L'auto-exclusion doit porter sur le nom de fichier, pas sur le chemin.** Une `Factory`
  est générée une fois par variante ; en n'excluant qu'un chemin, chaque classe se voyait
  elle-même et le compte tombait à 19.

## G1 couvre maintenant les quatre formes du corpus

Les 46 fournitures mortes de production prennent quatre formes, et `G01` a désormais un
cas pour chacune :

1. **Type de retour explicite**, la forme de base (`ExoModule`, onze cas).
2. **Type implicite avec objet anonyme** (`CoreUiModule`, seize cas) : le type se lit
   depuis l'expression, la coupe emporte tout le corps de l'objet.
3. **Module à état** (`AppActivityModule`, `MainActivityV2Module`) : couper la
   fourniture rend le champ orphelin, puis le constructeur, puis le module. La trouvaille
   est le premier maillon d'une cascade.
4. **Liaisons génériques** (`AppApplicationModule`) : `DatabasesProvider<A>` et
   `DatabasesProvider<B>` sont deux liaisons distinctes, et le module en aligne quatre
   dont deux mortes et deux vivantes. C'est une garde, pas un cas positif : un détecteur
   qui effacerait les arguments de type raterait les deux mortes.

Plus les homonymes du tour précédent, qui se jugent par `(container, méthode)`.

## Pourquoi G1 ne peut pas se construire sur une recherche de mentions

Mesuré contre le graphe Dagger sur les 393 fournitures. Le critère naïf « le type fourni
est écrit quelque part ailleurs » donne :

| | |
|---|---|
| faux positifs sur les 328 vivantes | **0** |
| mortes qu'il déclarerait vivantes | **46 sur 48, soit 96 %** |

Prudent et inutile. Le type d'une fourniture morte est presque toujours écrit ailleurs :
`DatabaseProvider` apparaît dans `ExoDatabaseProvider`, `ShellMainLayout` dans
`AppMainLayout`. Ce qui compte n'est pas que le type soit **écrit**, c'est qu'il soit
**demandé**.

Le contre-exemple est dans `G01`. Il passe aujourd'hui pour la mauvaise raison — rien
n'est jugé sur un `@Module` — et devra passer demain pour la bonne. C'est exactement le
rôle que joue la sentinelle du même fichier.

## Les six formes de demande sont les bonnes, vérifié sur le corpus

Les huit gardes de `G01` reposaient sur une liste écrite par raisonnement. Confrontée aux
208 fournitures vivantes dont le type est lisible, elle tient : **zéro cas inexpliqué**.

| Forme | Combien |
|---|---|
| champ `@Inject` | 79 |
| paramètre d'une autre fourniture | 76 |
| constructeur `@Inject` | 39 |
| multibinding `Set` / `Map` | 8 |
| `Provider<T>` ou `Lazy<T>` | 4 |
| méthode de `@Component` | 2 |

Le champ `@Inject` est la forme la plus fréquente, et les enveloppes qu'on cite toujours
en premier ne pèsent que quatre cas.

**Mais la mesure a révélé deux formes d'écriture que mes fixtures ignoraient**, et qui
expliquent les 62 fournitures au type illisible :

- **Signature sur plusieurs lignes** (`DelegateModule.kt` en aligne quatre). Toutes mes
  fixtures tenaient sur une ligne. Ajouté en cas positif.
- **Type implicite venu d'un appel** (`fun provideFirebaseAuth() = FirebaseAuth.getInstance()`).
  Sans résolution de type, le détecteur ne peut pas savoir ce qui est fourni : il doit se
  taire. Ajouté en garde, comme faux négatif assumé.

## G7 enrichi : deux de ses six candidats étaient des faux positifs

En classant les six interfaces du corpus, deux se sont révélées hors famille :
`PageIndicatorInterface` et `MarginPageIndicator` prolongent
`ViewPager.OnPageChangeListener`. Leurs méthodes sont appelées par le framework, depuis du
code qu'aucun scan ne lit. Sans garde, G7 en couperait deux sur six à tort.

La garde est ajoutée, plus un cas pour `ScrollViewEventHelper`, dont la méthode n'est
appelée que par ses propres tests : verdict attendu `testOnly`, jamais `unreferenced`,
parce que c'est `testCoRemoval` et pas G7.

## G9 enrichi : le cas réel, et sa mesure

Une piste ouverte du document a été instruite ce tour-ci : sur les **486 classes** que
la vitrine nomme dans une déclaration d'injection, seules **2** réunissent les conditions de
G9. Une est un test dans un source set à part ; l'autre est
`core/ui/.../CustomClickableSpan.kt:12`, et elle est subtile.

Personne ne la construit, mais son propre corps écrit
`getBaseComponent().inject(this)` : elle **consomme** la déclaration qui la nomme. La
classe et sa déclaration se tiennent mutuellement en vie, et le couple entier est mort. Un
détecteur qui verrait `inject(this)` comme un usage laisserait les deux debout.

Le cas est entré dans `G09` des deux côtés : en cas positif (`it.fails`), et en garde qui
vérifie qu'un vrai site de construction, lui, maintient bien la classe en vie.

Cette mesure dit aussi l'ampleur : le trou de G9 est réel mais étroit sur ce corpus. Sa
valeur est ailleurs — c'est lui qui arrête la cascade de G8.

## G10, et ce que `it.fails()` a attrapé

`G10` couvre les sous-types d'une classe scellée. Sa mesure est honnête et vaut d'être
lue avant le reste : **zéro trouvaille sur le corpus de référence**, 108 familles
scellées et pas une branche morte. Les cinq de `FeedScrollState`
(`NavigationEvents.kt:251`) sont toutes utilisées, vérifiées à la main.

Ce qui justifie le fichier, c'est que la forme n'est pas couverte, et seule la **place**
du sous-type décide :

```
object NeverUsed : State()    imbriqué dans le corps   -> jamais candidat
object NeverBuilt : Result()  frère, premier niveau    -> unreferenced, rapporté
object NeverBuilt             ordinaire, sans parent   -> unreferenced, rapporté
```

Le sous-type imbriqué n'est jugé ni par `findUnusedSymbols`, qui ne descend pas sous le
niveau zéro, ni par `findUnusedMembers`, pour qui une classe imbriquée n'est pas un
membre. Or c'est la forme la plus courante en Kotlin.

**Un cas marqué `it.fails()` s'est mis à passer, et c'est exactement à ça que sert le
marqueur.** J'avais supposé, par analogie avec KJ-066, qu'une famille scellée vidée de
toutes ses branches resterait debout comme une coquille. Non : la classe scellée est au
niveau zéro et `sealedClass` est une sorte candidate, donc elle est déjà rapportée. Le
cas a été déplacé dans un bloc « ce qui est déjà couvert, et qu'il ne faut pas casser ».
G10 ne porte donc que sur les **branches**, pas sur la famille.

## G11 est dans un régime à part, et il faut le savoir

Tous les autres fichiers testent un détecteur qui **existe** et qui se trompe ou ne
regarde pas. G11 teste une famille qui n'existe pas du tout : `grep -rn
"buildConfigField\|BuildConfig\." src/` ne rend rien.

Conséquence : ses dix cas de contrat sont **skippés**, pas rouges, via la convention du
harnais KJ (`importOrNull` rend `null`, la suite se skippe). Ils décrivent le contrat du
détecteur à écrire, mais **ils ne prouvent rien aujourd'hui**. Ne pas les compter comme
une couverture.

Un seul cas est rouge, et il est volontairement neutre sur le design : « un détecteur du
dépôt devrait voir `GTM_ENABLED` ». Peu importe lequel accueillera la famille ; ce qui
compte est qu'aucun ne le voit.

Le cas réel est `app/build.gradle.kts:50` —
`buildConfigField("boolean", "GTM_ENABLED", "true")`, dont le nom n'apparaît qu'une seule
fois dans tout le corpus. 34 champs déclarés, 1 mort.

## G12 : l'audit des fixtures a révélé un trou structurel

En vérifiant que mes fixtures reflétaient les formes réelles du corpus (après la leçon des
signatures multilignes de G1), j'ai mesuré la part des déclarations **imbriquées** :

| Sorte | Imbriquées | Part |
|---|---|---|
| `object` | 385 sur 614 | **63 %** |
| `enum` | 120 sur 306 | 39 % |
| `interface` | 150 sur 726 | 21 % |
| `class` | 811 sur 5343 | 15 % |
| **total** | **1466 sur 6989** | **21 %** |

Toutes mes fixtures, dans tous les fichiers, déclaraient au premier niveau. Une déclaration
sur cinq échappait donc à ce que je testais.

Et le trou se différencie par sorte : classes et objects voient leurs **méthodes**
rapportées mais pas la coquille, interfaces et enums ne sont vus par personne. G12 teste
les deux régimes séparément.

**Conséquence pour G4, G7 et G10** : ils raisonnent sur des interfaces ou des branches, et
sont donc plafonnés par ce trou. Ça explique en partie leurs faibles volumes mesurés.

## Correction : ce que G12 vaut vraiment, et un recouvrement entre familles

Même piège que G17 : « 1466 déclarations imbriquées, 21 % » mesure une **couverture**. En
écartant les déclarations annotées et celles qui portent un supertype, il reste 633
imbriquées, dont **cinq** ne sont nommées nulle part ailleurs — 0,8 %.

Et l'une des cinq est déjà couverte, par une autre famille :

```java
enum OrderBy {
}
```

C'est littéralement la coquille que la documentation de KJ-066 décrit, toujours présente
dans le corpus. Mesure faite : `scanEnums` la rend dans `emptied` quand elle est
**imbriquée**, et `findUnusedSymbols` la rend quand elle est au **premier niveau**. Les
deux formes sont couvertes. G12 ne porte donc pas sur les enums vides.

**Leçon pour lire tout le dossier :** les familles se recouvrent. Additionner leurs
ampleurs surestime le total. Chaque chiffre dit « ce que cette famille verrait », pas « ce
que personne ne voit ». Deux tests de `G12` verrouillent ce recouvrement précis.

## Le circuit complet, et la correction qu'il apporte à G13

`Circuit.WhatTheWholeLoopStillMisses.test.ts` est le seul fichier qui n'interroge pas un
détecteur. Il rejoue ce que fait la commande : `collecterUnePasse`, appliquer les coupes,
recommencer, seize rondes au plus. La différence compte.

Un trou mesuré sur un détecteur seul n'est pas forcément un trou pour l'utilisateur : le
circuit peut le refermer à la ronde suivante. Et c'est ce qui est arrivé à G13.

| Forme | Ce que le circuit en fait |
|---|---|
| chaîne de 9 classes | entièrement retirée, en sept rondes |
| chaîne de 20 classes | seize rondes, puis la commande demande un deuxième passage |
| cycle de 12 classes, méthodes non lues | entièrement retiré, en trois rondes |
| cycle de 4 classes, chaque méthode lue | entièrement retiré |
| **cycle de 5 classes, chaque méthode lue** | **intact, aucune ronde** |

Une chaîne se défait par un bout, la première classe n'étant nommée par personne. Un cycle
dont les méthodes ne sont pas lues se défait par le milieu : la famille des membres coupe
les méthodes, ce qui casse le cycle.

Donc la falaise n'est pas où G13 la situait. La limite compte les **déclarations**, membres
compris : une classe portant une méthode en vaut deux, la marche est à cinq classes et non
à neuf. Sur du vrai code, où une classe porte cinq ou six membres, elle est à deux. La
forme qui survit est précise : un cycle d'au moins cinq classes dont chaque membre est lu
par une voisine, et que rien ne nomme du dehors.

G13 garde ses tests, qui restent justes sur ce qu'ils mesurent. C'est sa conclusion sur le
coût pour l'utilisateur qui est corrigée, dans son en-tête et dans le document.

**Ce que le circuit ne rattrape pas.** G2, G4 et G12 y survivent entiers : aucune ronde n'y
touche. Ce sont les trous dont le coût se mesure en fichiers laissés sur le disque. G12 est
le plus parlant, le circuit vide la classe imbriquée de son seul champ puis laisse la
coquille.

**Deux gardes qui n'existent pas à cet étage, et c'est voulu.** `collecterUnePasse` ne
transmet pas `truncated` aux familles, donc un fichier seul y passe pour mort. Ce n'est pas
un faux positif : la commande sort avant de l'appeler, sur
`if (data.sourcesTruncated) { incomplet = true; break; }`
(`RemoveEverythingUnused.ts:585`). Le plafond de seize rondes, lui, laisse bien du code sur
une chaîne de vingt, mais la commande le dit, en finissant sur « Stopped after the last
allowed round ». Un test fixe chacun des deux, pour qu'un futur appelant de
`collecterUnePasse` sache ce dont il hérite.

## G13 : la limite des îlots est une falaise

Même méthode que G12 : auditer une dimension que les fixtures n'exploraient pas. Cette
fois, les fichiers Kotlin déclarant **plusieurs** types au premier niveau — 443 sur 3542,
soit 13 %.

La dimension est couverte : `findDeadIslands` rattrape bien les déclarations qui se
tiennent mutuellement en vie, là où `findUnusedSymbols` les laisse en `alive:same-file`.

Mais sa limite ne dégrade pas, elle coupe net :

| Chaîne | Îlots rapportés |
|---|---|
| 8 classes | 1 (huit noms) |
| **9 classes** | **0** |
| 12 classes | 0 |

Un îlot ne devient pas moins mort en grossissant. `G13` demande donc qu'une limite qui
coupe le **dise**, plutôt que de se taire — et documente au passage, par un test qui passe
déjà, que relever `maxIslandSize` à 16 suffit à voir l'îlot de neuf.

## G13 enrichi : la limite voisine qui, elle, est justifiée

`isGeneratedSource` cherche un marqueur de génération dans les 1500 premiers caractères.
Cette limite-là **est** atteinte par le corpus, et c'est tant mieux :

| Fichier | Offset | Ce que c'est |
|---|---|---|
| `PopoverPropertiesBuilder.java:118` | 4897 | avertissement sur **une méthode** |
| `StartupAdAnalyticsHelper.kt:52` | 1841 | « Internal error **generated by** rx stream » |

Sans la fenêtre, le second passerait pour généré et tous ses findings seraient supprimés.
Les deux sont maintenant des gardes dans `G13`.

**La leçon affine celle de G13 lui-même.** La différence entre une limite qui protège et
une limite qui censure n'est pas la taille du chiffre : `isGeneratedSource` borne un
**indice**, qui perd sa valeur en s'éloignant du début du fichier, tandis que
`maxIslandSize` borne un **résultat**, qui reste vrai quelle que soit sa taille. Borner un
indice est légitime ; borner un résultat est un filtre déguisé.

## G14 est le seul trou qui puisse éteindre le détecteur

Tous les autres font manquer une trouvaille. Celui-ci peut faire taire la famille entière.

`withoutUnappliedPlugins` protège contre le fichier de build racine, qui liste les plugins
sans les appliquer. Son filtre lit `apply false`, pas `.apply(false)` — la forme d'appel du
Kotlin DSL, qui est justement celle du projet de référence :

```kotlin
alias(libs.plugins.android.library).apply(false)   // build.gradle.kts:14
```

**Aujourd'hui, le coût est cosmétique** : `isLibraryModule` ne change que le texte des
messages, jamais un verdict. La racine est comptée parmi les 45 modules bibliothèque, et
chaque message porte une mention fausse.

**Le danger est latent** : `PUBLISHED_MODULE_RE` passe par le même filtre, et
`publishedModules` écarte le candidat (`F14:published`). Un projet qui écrirait
`alias(libs.plugins.mavenPublish).apply(false)` à sa racine éteindrait tout son détecteur
sans un message pour le dire.

C'est aussi le premier fichier du dossier à mocker `vscode`, puisque `ResourceCorpus`
l'importe.

## G14 enrichi : les filtres d'artefacts sont verrouillés

Même famille de risque que le reste du fichier : ce ne sont pas des trouvailles manquées,
ce sont des protections qui, si elles lâchent, rendent le détecteur **silencieux**.

Mesure sur le corpus, fichiers hors `build/` citant vingt noms pleinement qualifiés ou
plus : `mapping.txt` en cite **52 026**, `usage.txt` 19 081, `seeds.txt` 13 512. Tous
écartés. Le cache JSON de SearchDeadCode (12 516 noms) est hors glob, `.idea/workspace.xml`
est exclu par défaut, et `AndroidManifest.xml` comme `proguard-rules.pro` sont lus à
dessein.

Onze cas verrouillent maintenant ces filtres, plus deux `it.fails` de prudence pour des
formes absentes de ce corpus : un répertoire `target/` de Maven, un fichier d'exclusion
SpotBugs sans le mot `baseline`.

## G15 : l'audit des enums a trouvé une cinquième entrée morte

Les quatre entrées d'enum rapportées sur le corpus sont justes. Mais il en manque une :
`UriScheme.HTTP` (`host/base/.../uri/UriScheme.kt:4`) est morte et n'est pas rapportée.

Deux lignes la masquent, dans deux modules différents :

```kotlin
Proxy(Proxy.Type.HTTP, InetSocketAddress(proxyServer, PROXY_PORT))
```

`Proxy.Type` est l'enum de `java.net`. Sa constante `HTTP` porte le même nom, la mention
est comptée pour `UriScheme.HTTP`.

**Le témoin qui délimite le trou** : quand l'homonyme est un enum **du corpus**, la
résolution par enum de la v1.42.328 fonctionne et sépare correctement les deux. Le trou ne
concerne que les homonymes venus d'une bibliothèque, ce qu'un test vérifie explicitement
pour éviter qu'un correctif ne casse la résolution existante.

## G16 : le même trou, un étage plus haut

G15 concerne les entrées d'enum, G16 les symboles. Le mécanisme y est plus net :

| Corpus | Verdict de `class Result` du projet |
|---|---|
| seule | `unreferenced`, rapportée |
| + un `Result<String>` de `kotlin.Result` | `alive:main` |
| + `kotlin.Result` **pleinement qualifié** | `alive:main` |
| + `import kotlin.Result` **explicite** | `alive:main` |

Les deux dernières formes ne laissent aucune ambiguïté : le fichier déclare d'où vient son
`Result`, et la mention compte quand même.

**Mesure honnête : zéro trouvaille manquée aujourd'hui.** Les quatre classes du corpus dont
le nom collide avec un type de bibliothèque (`Event`, `Options`, `Size` ×2) sont toutes
vivantes. Mais `Size` montre la configuration à risque : **quatre imports différents**
amènent ce nom simple, et sur 99 mentions le détecteur ne peut pas les attribuer.

Les gardes vérifient la contrepartie, qui est la plus coûteuse à casser : un import
**nommé** de `com.x.Result` depuis un autre paquet désigne bien la classe du projet.

## G17 : le troisième étage, et le plus large

G15 traite les entrées d'enum, G16 les symboles, G17 les **membres**. C'est là que le
motif coûte le plus cher :

| | |
|---|---|
| méthodes membres déclarées | 22 044 |
| **noms partagés par 2 classes ou plus** | **13 075, soit 59 %** |
| trouvailles du détecteur | 211, dont **2 en `unreferenced`** |

`inject` compte 824 déclarations, `setUp` 354, `onBusEvent` 288. Les 209 autres trouvailles
sont `selfOnly` ou `testOnly` — des voies qui raisonnent sur l'origine de la mention, pas
sur son nom, et qui fonctionnent donc très bien.

**Ce qui distingue G17 de G15** : pour les enums, un homonyme du corpus est correctement
résolu ; ici, **même un homonyme parfaitement lisible masque**. `OtherBuilder.build()` est
déclaré dans le corpus et appelé sur une instance d'`OtherBuilder`, et pourtant
`Builder.build()` disparaît.

Les gardes comptent plus que les cas positifs : couper un membre appelé quelque part casse
la compilation. C'est le seul endroit du dossier où une erreur se voit immédiatement.

## Correction : ce que G17 vaut vraiment

J'avais écrit « 59 % des membres hors d'atteinte » sans dire ce que ça rapporte. Le
pourcentage mesure une **couverture**, pas un gain, et la différence est d'un facteur
soixante.

Une première estimation comptait comme morte toute méthode jamais nommée ailleurs :
31,6 % de mortalité, **4134 membres** extrapolés. Ses premiers exemples étaient
`providePersistence` et `provideAdKitDownloaderRepository` — des fournitures Dagger
**vivantes**, appelées par du code généré qui n'écrit jamais leur nom.

En écartant les méthodes annotées, les `override` et les rappels de cycle de vie :
**1,68 %**, soit **environ 63 membres**. G17 se place donc au niveau de G1 (46 fournitures
mesurées), pas au centuple.

« Jamais nommée » n'est pas « morte ». La leçon est verrouillée par une garde de `G17` :
une fourniture Dagger ne doit jamais être rapportée par la famille des membres.

## G19 : un second territoire pour la famille des ressources

Troisième piste ouverte du document, instruite ce tour-ci. La famille des ressources
connaît `res/` et rien d'autre. `assets/` est le second endroit où un projet Android range
des fichiers.

**C'est structurel, pas une garde trop large.** `FileResourceIndex` reconnaît un chemin par
une expression qui exige `res/<sorte>/` (`FileResourceIndex.ts:34`). Un chemin d'asset rend
`undefined` et n'entre jamais dans l'index. Un test le fixe directement, sur
`parseResourcePath`, sans passer par le détecteur.

**La mesure a demandé une correction, la même que d'habitude.** Une première sonde, qui
cherchait le nom des assets dans le code seulement, en a annoncé 83 morts sur 123. Un asset
en nomme souvent un autre : `assets/css/fonts.css` nomme à lui seul les 60 polices `.otf`
du dossier voisin. En comptant les assets comme des citants, il en reste 8, dont 3
décidables et 33 Ko sûrs.

**La règle qui rend le cas décidable est réutilisable.** `DynamicAdAnimationHelper-51`
nomme douze des treize fichiers de `lottie/dynamicAd/` en littéral complet. Le dossier
prouve ainsi son propre mode d'accès : douze frères cités en toutes lettres, donc l'accès
n'est pas construit, donc le treizième est mort. Partout où un dossier est lu par
littéraux, ses absents sont jugeables.

**Les gardes portent toutes sur le chemin construit.** `"fonts/" + value + ".otf"` et
`am.open("devAssets/" + path)` éteignent leur répertoire entier. La famille sait déjà faire
cela pour `res/`, sous le nom de `dynamicallyLookedUpKinds`. Le trou n'est pas de ne pas
savoir se taire, c'est de ne pas savoir regarder.

Les six gardes passent dès maintenant, avec un canari de `res/raw/` qui prouve que l'appel
juge bien le corpus.


## G20 : un filtre qui écarte avant de compter

Quatrième et dernière piste ouverte du document, instruite ce tour-ci. Elle demandait si
les Fragments et les Activities, nommés par le manifeste plutôt que par un layout,
relevaient du même trou que les vues. La réponse déplace la question.

**Le manifeste n'y est pour rien.** Une `Activity` posée seule, sans manifeste dans le
corpus, sort déjà en `F7:Activity`. Le filtre des supertypes de framework précède tout
comptage de mentions ; le manifeste ne fait qu'ajouter une mention à un verdict déjà rendu.
Deux tests le fixent par écrit, en comparant les deux verdicts.

**Et les deux populations de la piste sont vides.** 57 composants déclarés dans les 54
manifestes, aucun que rien d'autre ne nomme. 29 classes qui prolongent un `Fragment`, idem.

**Le trou est ailleurs.** Sur les 290 déclarations que F7 écarte, quatre ne sont ni
construites par du code ni nommées par un XML. Relues à la main, trois tiennent :
`OverlayView`, `FormArrowView` et `StickyRecyclerHeadersDecoration`. Une vue personnalisée
n'a que deux voies d'instanciation, `new X(...)` ou une balise XML que l'inflateur lit par
réflexion. Quand le corpus ne porte ni l'une ni l'autre, la convention invisible que F7
redoute n'existe pas.

**Ce qui sépare G20 de ses voisins**, et c'est la raison pour laquelle il fallait un fichier
à part : G8 parle d'une vue nommée par un layout **mort**, G9 de la garde qui ne se relâche
pas une fois ce layout parti, G20 d'une vue qu'**aucun** layout n'a jamais nommée. Seul le
dernier se voit sans rien supprimer d'abord.

**Sept gardes, toutes vertes, avec canari.** Balise de layout, site de construction, règle
de conservation, fichier de styles, Fragment, Activity, corpus tronqué. Les deux gardes
Fragment et Activity sont les plus importantes : elles disent où la relâche doit s'arrêter.

**Une observation qui vaut pour tout le dossier.** Les quatre fichiers
`StickyRecyclerHeaders*` forment un îlot mort de manuel, et `findDeadIslands` ne les reçoit
jamais, parce que F7 les a écartés un par un en amont. Un filtre trop large prive une
famille en aval de son gibier. C'est la seconde fois que le dossier rencontre cette forme,
après la limite des îlots qui cachait des cycles.


## G21 : un dossier entier, et deux gardes qui l'ignorent chacune pour sa raison

Le cas de code mort le plus large que ce dossier ait mesuré, et le seul qui se compte en
fichiers plutôt qu'en déclarations.

```
app/.../module/live/weather/utils/     9 fichiers, ~29 Ko
```

La bibliothèque StickyRecyclerHeaders, recopiée telle quelle. Vérifié un par un : aucun des
neuf noms n'apparaît ailleurs, ni en Kotlin, ni en Java, ni en XML. Sur les vrais fichiers,
le circuit complet fait **0 ronde, 0 coupe**, et `findDeadIslands` rend **0 îlot**, y
compris à la limite 64.

**Première cause, la nouvelle : un membre écarté sert d'ancre.** Deux des neuf prolongent
`RecyclerView`, donc F7 les écarte. Écartées, elles cessent d'être candidates de l'îlot mais
elles **nomment toujours** les sept autres. La famille des îlots voit donc un citant
extérieur vivant, et le groupe n'est pas fermé.

| Corpus | Îlots, limite 8 | Îlots, limite 64 |
|---|---|---|
| les neuf ensemble | 0 | 0 |
| les sept sans les ancres | 0 | 1 îlot de dix noms |

**Seconde cause, connue : la taille.** Dix noms, pour une limite à huit. C'est G13.

Chacune suffirait à cacher le dossier, donc les corriger séparément ne donnerait rien. Une
sentinelle fixe la ligne qui résume tout : `HeaderViewCache` passe de `alive:main` à
`unreferenced` selon que les deux ancres sont là ou non. La vie des sept tient entièrement à
deux déclarations que personne n'a jugées.

**L'erreur de catégorie, formulée.** Une déclaration écartée par un filtre n'est pas
*prouvée vivante*, elle est *non jugée*. La traiter comme une preuve de vie pour les autres
familles est l'erreur.

**Deux gardes que les tests ont corrigées en cours de route.** J'avais écrit que nommer un
membre depuis l'extérieur sauvait le groupe : faux, cela sauve ce membre, le reste peut
rester un îlot plus petit et c'est juste. Puis que n'importe quel appelant suffisait : faux
aussi, un appelant mort rejoint l'îlot au lieu de le sauver. Les deux assertions sont
maintenant écrites dans le sens que la mesure donne.


## G22 : le même défaut, un filtre plus haut, et la règle qui s'en dégage

G21 tenait au filtre des supertypes. G22 montre que le filtre n'y est pour rien : le même
malentendu se reproduit avec **F5, celui des annotations**.

**Il a été trouvé en cherchant la bonne maille.** L'union-find sur les 7875 déclarations ne
donne rien, les noms communs relient tout le corpus en une seule composante. Le dossier,
lui, marche.

| Mesure | Résultat |
|---|---|
| dossiers portant au moins une déclaration | 1098 |
| dossiers dont aucun nom n'est cité du dehors | 42 |
| dont `src/debug/`, et ce sont des `@Preview` Compose | 40 |
| dont `src/main` | **2** |

Les 40 de debug sont correctement épargnés, `@Preview` sortant en `F5:@Preview`. C'est la
garde la plus exposée du trou, et un test la fixe. Les deux vrais sont G21 et G22.

**Le cas :** un dossier d'aides à la numérotation de pages, trois fichiers. Deux portent
`@ScopeActivity` sur une classe package-private à constructeur `@Inject`, donc `F5` les
écarte ; la troisième sort `alive:main` parce que les deux premières la nomment. Aucun des
trois noms n'apparaît hors du dossier. `findUnusedSymbols` ne rend rien, `findDeadIslands`
rend 0 îlot même à la limite 64, le circuit ne fait aucune ronde.

**La règle, maintenant qu'on la voit deux fois.** Un filtre dit « je ne sais pas », pas
« elle vit ». Une déclaration écartée devrait cesser de compter comme une preuve de vie pour
ses voisines. G21 et G22 sont le même défaut à deux étages du même détecteur, et c'est ce
qui en fait une règle plutôt qu'un cas.

**Ampleur combinée :** douze fichiers, environ 35 Ko, deux dossiers entiers que rien ne
rapporte. Sur 1098 dossiers ce sont les deux seuls, donc la correction ne risque pas grand
chose ; mais elle ouvre les deux seules poches de code mort à l'échelle du dossier que le
corpus contient.


## G23 : la frontière de la règle, et un gap qui ne se récolte pas

G21 et G22 disaient qu'une déclaration écartée par un filtre n'est pas une preuve de vie.
G23 répond à la question suivante, « est-ce vrai partout ? », et la réponse borne la règle.

| Famille sondée | Effet d'ancre ? |
|---|---|
| entrées d'enum | non, une entrée lue laisse ses voisines être rapportées |
| ressources | non, la ronde 2 défait l'ancre une fois le layout parti |
| **membres** | **oui**, mais sans instance mesurable dans le corpus |

Le mécanisme chez les membres est certain : `Holder.helper` sort `unreferenced` seul, et
`selfOnly` dès qu'un membre `@Inject` l'appelle. Le même fichier, le même voisin, la seule
différence étant une déclaration que le détecteur ne juge pas.

**Pourquoi aucune instance, et pourquoi c'est la bonne nouvelle.** Sur les 1119 membres que
M6 écarte, 89 % portent une annotation qui est un **vrai point d'entrée** : `@Inject` 560,
`@VisibleForTesting` 163, `@Subscribe` 159, `@JavascriptInterface` 15, `@TypeConverter` 4.
Leur corps s'exécute, donc les appels qu'il contient sont de vrais appels et l'ancre est
légitime. Seuls les marqueurs de type ou de fil (`@Nullable` 58, `@NonNull` 32, `@UiThread`
23, `@ContainerPosition` 16) ne disent rien sur qui appelle.

**L'ampleur n'est pas mesurée, et le fichier le dit.** Blanchir les corps M6 et relancer
donne 62 bascules, ou 9 en se restreignant aux marqueurs. Les trois premières relues à la
main sont des artefacts : `explainMembers` n'expose que la ligne d'un membre, pas son
étendue, donc le blanchiment avale le code voisin.
`TextViewUtils.textViewIsTargetOfAlphaAnimation` ressort comme mort alors que
`PapyrusViewUtils.java:107` l'appelle. Le nombre honnête est : inconnu, probablement très
petit.

**À quoi sert ce fichier, alors.** À borner la règle avant qu'on la corrige. Le jour où G21
et G22 seront réglés, la tentation sera d'appliquer la même relâche aux membres. Les cinq
gardes disent pour quelles annotations ce serait faux, les quatre cas positifs pour
lesquelles ce serait juste. C'est un filet de régression, pas une récolte. Le motif de garde
vient du corpus : `PageBecameAvailableHelper.java:61`, où `onBusEvent` porte `@Subscribe` et
est le seul appelant de `isFirstOfEditionPage()` dans tout le projet. Relâcher là
supprimerait du code qui tourne.


## G24 : les deux plus grosses poches, enfin regardées

Sur les 7875 déclarations du corpus, `alive` en compte 4493 et les filtres se partagent le
reste : **F1 1627**, **F3 748**, F5 438, F7 290. Les deux premières n'avaient jamais été
examinées, et le dossier passait son temps sur F7, quatre fois plus petite.

**F1 : pas un trou, vérifié.** Les 1627 déclarations `private` de premier niveau ne sont pas
perdues, elles sont déléguées au balayage. `sweepFile` les rapporte. Un test le fixe, pour
qu'on n'ait pas à refaire la vérification.

**F3 : un trou net.** Il écarte une déclaration dont le nom simple est porté par plusieurs
déclarations de premier niveau. Parmi ses 362 noms, **39 n'ont qu'une seule copie visible**,
toutes les autres étant `private`. Or un `private` de premier niveau en Kotlin est visible
dans son fichier et nulle part ailleurs : il ne crée aucune ambiguïté. Six composables privés
nommés `CloseButton`, chacun dans son fichier, n'empêchent personne de savoir de quoi parle
`import ...login.CloseButton`.

**Zéro trouvaille, et le fichier le dit.** Simulation faite : renommer les homonymes privés
et relancer ne fait passer aucune des 39 en `unreferenced`. Ce que la correction enlève, ce
sont 39 **angles morts permanents** : le jour où la dernière utilisation de `BLUR_RADIUS`
disparaîtra, elle restera F3 et personne ne le dira.

**La frontière, mesurée, et c'est ce qui rend le gap sûr.**

| Corpus | Verdict | Juste ? |
|---|---|---|
| public + homonyme privé | `F3` | **non** |
| public + homonyme `internal` | `F3` | oui, `internal` voit tout le module |
| public + homonyme public | `F3` | oui |
| Java public + package-private | `F3` | oui, le paquet le voit |

Le piège est que `private` ne veut pas dire la même chose des deux côtés : en Java, une
classe sans modificateur est visible dans tout son paquet. La garde Java est là pour ça.

**Un `it.fails()` qui s'est signalé tout seul.** J'avais écrit que la copie publique devrait
être rapportée morte quand plus rien ne la nomme : elle l'est déjà, `unmentionedDuplicates`
couvrant le cas où personne ne nomme le nom. Le cas est devenu une sentinelle, et le trou
s'est resserré sur ce qu'il est vraiment : quand quelqu'un nomme, et que l'import dit lequel.


## G25 : le trou s'est refermé pendant que je l'écrivais

Le gap le plus étroit du dossier, et celui où les `it.fails()` ont le plus servi.

L'asymétrie était réelle : deux copies de `BLUR_RADIUS`, et selon le paquet que le lecteur
importe, la copie `com.a` sort `unreferenced` ou `F3:duplicate-name`. Mais **deux des trois
cas positifs ont passé du premier coup**. J'avais écrit que la copie non importée n'était pas
rapportée : faux, elle l'est déjà dans les deux sens. Qu'une mention du même paquet ne
résolvait pas : faux aussi.

Il reste **un** cas positif : la copie que la mention désigne reste `F3` au lieu de sortir
`alive:main`. Comme pour G24, ce n'est pas une récolte, c'est un angle mort en moins.

**Le chiffre de 25 ne tient pas, et c'est l'autre moitié du résultat.** La règle simulée
donnait 748 déclarations F3 sur 362 noms, 165 noms entièrement résolus, et 25 copies sans
aucune mention attribuée. Les deux premières relues à la main étaient des artefacts, et la
troisième est pire qu'un artefact. D'où trois gardes, toutes vertes :

| Piège | Ce qui se passerait sans la garde |
|---|---|
| jumeaux de variante | `BaseActivity` existe en debug, release et staging ; attribuer l'unique import à une copie tue les deux autres, et deux variantes de compilation sur trois |
| mentions du propre fichier | `VersionRange` est construit par le `until` du même fichier ; ne compter que les mentions venues d'ailleurs le déclare mort |
| mentions hors code | 76 des 362 noms sont nommés par un XML, un `.pro` ou un Gradle, où il n'y a ni import ni paquet |

Le premier est le plus grave, et c'est une découverte du tour : `topLevelNameCounts` compte
les jumeaux de variante comme des homonymes. Une classe parfaitement non ambiguë dans chaque
variante n'est jamais jugée.


## G26 : trois source sets ne font pas trois classes

Android compile un type de build à la fois : `debug`, `release` et `staging` s'excluent. Une
classe déclarée dans les trois est **une** classe en trois versions. Le détecteur les compte
comme trois homonymes et les écarte toutes les trois.

**Six familles, dix-huit déclarations** dans le corpus : `ShortcutHelper`, `BaseActivity`,
et les paires `LogBindingModule` / `LogProvideModule` présentes dans deux modules. Une seule,
`ShortcutHelper`, cesserait complètement d'être un homonyme après fusion ; les `Log*Module`
resteraient ambigus entre `app` et `host/app`, à juste titre.

**Le cas**: `ShortcutHelper` est appelé une fois, depuis `StartupActivity`, avec un
import unique, dans le même paquet et le même module que ses trois déclarations. Aucune
ambiguïté à lever, et pourtant les trois sortent en `F3`. Une sentinelle le dit d'une ligne :
la variante `debug` passe de `alive:main` à `F3` quand ses deux sœurs entrent dans le corpus.

**Zéro trouvaille, encore.** `ShortcutHelper` est vivant. Trois déclarations passeraient de
« jamais jugée » à « jugée vivante ».

| Corpus | Verdict | Juste ? |
|---|---|---|
| trois variantes, même module et paquet | `F3` | **non** |
| deux modules, même paquet | `F3` | oui |
| `main` + `debug`, même paquet | `F3` | oui, `main` compile avec tous |
| même variante, paquets différents | `F3` | oui |

La garde `main` est la plus importante : un source set `main` n'est exclusif de rien. Et la
dernière garde protège du pire, supprimer la version `release` parce que l'import a été
attribué à la version `debug` casserait deux builds sur trois.

**Le constat qui se dégage des trois derniers gaps.** G24, G25 et G26 rapportent chacun zéro
trouvaille et seulement des angles morts. Sur ce corpus, le détecteur ne rate presque plus de
code mort : il refuse de se prononcer sur certaines déclarations. C'est une bonne nouvelle
pour la justesse, et cela dit où porter l'effort ensuite.


## G27 : le plus gros déblocage du dossier

Le recensement des déclarations jamais jugées désigne **F8, 93 déclarations**, presque toutes
des interfaces. Et c'est la troisième rencontre avec la même erreur de catégorie, cette fois
écrite dans le filtre lui-même.

F8 dit qu'« un parent dont le sous-type appartient à un cadre est lui-même atteint par ce
cadre ». Le motif d'origine est réel, une classe scellée dont les variantes portent
`@SerializedName` est fabriquée par la bibliothèque JSON. Une garde le protège.

**Trois défauts, mesurés :**

1. **La caution vient d'une déclaration non jugée.** L'implémentation sort en `F5:@...`, donc
   personne ne sait si elle vit, et cette ignorance vaut certificat de vie pour son parent.
2. **Le filtre gagne sur le comptage.** `rejectionReason` s'applique avant les mentions
   (`unusedSymbols.ts:1709-1711`). Ajouter un vrai consommateur du type ne change rien : une
   sentinelle compare les deux appels et ne voit bouger que le nombre de mentions.
3. **Il plafonne G4 et G7.** Si l'implémentation porte la moindre annotation non bénigne, le
   parent est F8, et les deux trous déjà écrits ne peuvent plus se prononcer.

N'importe quelle annotation suffit, un test le vérifie sur quatre d'entre elles :
`@Serializable`, `@Keep`, `@Singleton`, `@SerializedName`.

**Zéro suppression, 93 déblocages.** Quatrième gap de suite sans récolte, et le plus gros en
volume. Les gardes protègent les deux fabrications invisibles qui justifient le filtre, la
sérialisation JSON et `@Parcelize`.


## G28 : le recensement est complet, et il désigne un outil plutôt qu'un trou

F6 était le dernier filtre non mesuré. Il est **légitime** : 56 déclarations, `Serializable`
34 et `Parcelable` 22, et aucune que les autres fichiers de production ignorent. Une
sous-classe d'une classe sérialisable l'est aussi, donc la marche de huit ancêtres est
justifiée. Le recensement de `unusedSymbols` est donc terminé.

| Sortie | Nombre | Statut |
|---|---|---|
| `alive` | 4493 | un verdict |
| F1 `private` | 1627 | délégué au balayage, **G24** |
| F3 `duplicate-name` | 748 | trois sur-largeurs, **G24**, **G25**, **G26** |
| F5 annotation | 438 | ancre ses voisins, **G22** |
| F7 supertype | 290 | **G20**, **G21** |
| F8 sous-type annoté | 93 | **G27** |
| F12 ignore | 74 | intention d'auteur, hors sujet |
| F6 réflectif | 56 | légitime |
| `unreferenced` + `testOnly` | 49 | un verdict |

**Une sonde a encore menti, et le fichier le raconte.** Elle annonçait « 27 sur 56 par un
ancêtre, sans clause directe », ce qui aurait été un défaut de parseur. Elle ne lisait que
deux lignes, et `ViewSpacing` porte son `: Serializable` huit lignes plus bas, après ses
paramètres. Trois cas relus à la main, tous directs.

**Ce qui manque n'est pas un trou, c'est un outil.** `explainSymbols` rend un seul `outcome`,
et le filtre écrase le verdict du comptage (`unusedSymbols.ts:1709-1711`). On ne sait donc
jamais si une déclaration écartée **est** vivante ou seulement **non jugée**. Chaque gap de
G20 à G27 a demandé une simulation pour répondre, et trois de ces simulations ont rendu des
chiffres faux qu'il a fallu relire à la main.

Les trois cas positifs demandent donc un champ `wouldBe`, ou au minimum `selfInFile` pour le
recalculer.

**Onze tests de recensement, un par filtre**, sur son motif réel : F1, F3, F4, F5, F6
(×2), F7, F8, F10, F11, F12. Une modification du jeu de filtres se signalera là. Et la garde
centrale dit que doubler le verdict est un changement de **rapport**, pas de décision :
aucune des sept déclarations écartées testées ne doit se mettre à être supprimée.


## G29 : le plus gros écart du dossier, et il est entre deux familles

Le recensement de `unusedMembers` commence, et son premier résultat dépasse tout ce que les
vingt-huit gaps précédents ont mesuré.

**Deux membres rapportés sur 18 128.** `alive` 5550, M2 `override` 4965, **M4 conteneur
4823**, M3 `java-supertyped` 1240, M6 1119, `selfOnly` 230, `unreferenced` **2**. Les trois
premiers filtres avalent 61 % des membres.

**L'écart.** `@ScopeApplication` et `@ScopeActivity` sont des portées Dagger déclarées dans
le projet (`app/common/.../ScopeApplication.java:12`,
`host/base/.../ScopeApplication.kt:8`). KJ-070 a appris à `unusedSymbols` à les découvrir
par leur `@Scope`. `unusedMembers` ne l'a jamais reçu : sa liste bénigne
(`unusedMembers.ts:136`) contient `Singleton` et `Reusable` en dur, avec le commentaire
« les portées personnalisées restent étrangères : ensemble inconnaissable ». Il ne l'est plus
depuis KJ-070.

Trois sentinelles montrent l'écart sur **le même corpus** : `unusedSymbols` rend
`alive:main`, `unusedMembers` rend `M4:@ScopeApplication`, et il écarte jusqu'à la méthode
qui **est** appelée. Une quatrième vérifie que la découverte côté symboles dépend bien du
fichier qui déclare la portée, donc que c'est une découverte et non un cas codé en dur.

**1679 membres** pour ce seul motif. Plus `@UnstableApi` 394, un marqueur de stabilité qui ne
dit rien de qui appelle (`MediaEngineSelector.kt:59`), et `F6:Serializable` / `F6:Parcelable`
385, où la bibliothèque fabrique l'objet et lit ses champs sans appeler ses méthodes.

**La frontière est nette et les gardes la tiennent.** Un `@Module` (435) voit ses fournitures
appelées par le code généré ; un `Fragment`, une `View`, une `Activity` (1059) voient leurs
méthodes de cycle de vie appelées par le cadre. Un conteneur **fabriqué** n'est pas un
conteneur **appelé**. Deux gardes de plus bornent la relâche : une annotation que le corpus
ne déclare pas reste étrangère, et une annotation déclarée sans `@Scope` n'est pas une portée.


## G30 : le plus gros filtre du projet, et une vraie récolte

M2, `@Override`, écarte **4965 membres**, plus du quart de tous ceux examinés. Son argument
tient quand le supertype vit hors du corpus. Quand toute la chaîne est dedans, il n'y a plus
rien à deviner.

| M2 | Nombre |
|---|---|
| total | 4965 |
| tous les supertypes du conteneur dans le corpus | **1498** |
| au moins un supertype dehors | 1666 |
| clause non lisible par la sonde | 1801 |

Sur les 650 noms distincts de ces 1498, 38 n'ont pas plus d'occurrences que de déclarations,
donc aucun appel. Après affinage : 9 fournitures Dagger, 7 appelées par un test seulement, et
**22 jamais appelées**. Trois paires vérifiées à la main, dont
`SystemInfoService.getCurrentMemoryUsage` et `CacheService.evictFromCaches`.

Ce sont des **paires** : la méthode d'interface et sa surcharge meurent ensemble. Un test le
montre au passage, la méthode d'interface n'apparaît même pas dans le rapport de
`explainMembers` — les membres d'une interface ne sont pas des candidats. La paire est
invisible des deux côtés, ce qui explique qu'aucune famille ne la voie.

**La mesure a réclamé sa propre garde.** La sonde ne regardait que le supertype direct.
`EllipsizingTextView` étend `FontTextView`, dans le corpus, qui étend `TextView`, qui ne l'est
pas ; ses surcharges sont appelées par le cadre pendant la mise en page, et la sonde les
annonçait mortes. La règle doit remonter toute la chaîne, comme `frameworkAncestor` le fait
pour F7. Deux des vingt-deux tombent, les autres tiennent.

**Premier gap depuis G23 avec une vraie récolte.** Les cinq gardes couvrent le supertype
direct hors corpus, la chaîne qui sort au deuxième étage, la fourniture Dagger surchargée, la
surcharge appelée par un test, et le corpus tronqué.


## G31 : une garde large, mesurée, et gardée

M3 écarte tout membre d'une classe **Java** portant un supertype, parce que `@Override` est
optionnel en Java. 1238 membres. Le code assume le compromis et demande le chiffre sur lequel
le juger (`unusedMembers.ts:458-462`).

| Étape | Membres |
|---|---|
| `M3:java-supertyped` | 1238 |
| chaîne de supertypes entièrement dans le corpus | 184 |
| et nom déclaré par aucun supertype | 170 |
| moins ceux qu'un XML nomme | −19 |
| moins ceux que le code nomme ailleurs | −149 |
| **restent** | **2** |

**M3 coûte deux membres**, et c'est le résultat le plus utile du gap : une garde large qu'on
a mesurée et qu'on garde. Les deux sont `CacheServiceImpl.setCacheEnabled` (statique, hors
interface, jamais nommée) et `AnalyticsEditionModelImpl.UNDEFINED_MODEL`. La même classe
avait déjà livré `evictFromCaches` à G30 : deux membres morts, deux filtres, un fichier.

**Deux gardes réclamées par l'affinage lui-même.** Dix-neuf des cent-soixante-dix sont des
champs publics de modèles de vue, nommés par un layout en `@{viewModel.key}` et jamais par du
code — ma première mesure les annonçait morts. Et comme en G30, la règle doit remonter toute
la chaîne : un supertype hors corpus peut déclarer la méthode sans qu'on puisse le lire.

**Le recensement de `unusedMembers` est clos** : M2 (G30), M4 (G29), M6 (G23), M3 (ici).


## G32 : la même idée, un troisième endroit

Recensement de `findUnusedResources` : **1106 entrées**, **15 rapportées** (anim 9, layout 5,
menu 1). La famille n'expose aucun `explain`, il a fallu reconstruire le coût de chaque garde
depuis l'extérieur — le manque même que G28 décrit.

**La garde 5** dit qu'un nom défini dans plusieurs modules est un recouvrement, et le
raisonnement est juste : `core/uikit` et `core/login` déclarent tous deux
`drawable/ic_facebook`, et celui qui gagne dépend de l'ordre des modules. Mais sur 75 noms
multi-modules (271 fichiers), **un** n'est cité nulle part : `layout/text_pair`, présent dans
`app/engagement` et `host/app`, mort dans les deux.

La garde devrait se lever quand **aucune** copie n'est nommée. C'est exactement ce que
`unmentionedDuplicates` fait côté symboles (G24) : la même idée, un troisième endroit.

**Une sonde qui a menti d'un facteur vingt-cinq**, et c'est la cinquième du dossier. Son
expression de jetons incluait le point, donc `R.drawable.ic_facebook` sortait comme un seul
jeton et `ic_facebook` n'était jamais produit.

| Sonde | Annoncé | Réel |
|---|---|---|
| assets jamais nommés (G19) | 83 | 8 |
| bascules M6 (G23) | 62 | aucune vérifiable |
| copies F3 sans mention (G25) | 25 | aucune |
| F6 « par ancêtre » (G28) | 27 | 0 |
| noms multi-modules morts (ici) | 25 | 1 |

À chaque fois, relire les trois premiers exemples a suffi. C'est devenu le réflexe le plus
rentable du dossier.


## G33 : la famille la plus serrée des quatre

Recensement de `scanEnums` : **1303 entrées**, **4 trouvailles**. `alive:main` 741, **E1
`walked-as-whole` 540** sur 60 enums, E3 12, E5 4, E2 2.

**Une seule incohérence.** E1 protège un enum qu'on parcourt en entier, et le raisonnement
est solide. Mais `findWalkedEnums` (`unusedEnumEntries.ts:283`) parcourt toutes les sources
sans distinguer les source sets : une marche écrite dans un test protège les entrées en
production, alors que la même famille porte un filtre `E2:test-source-set` pour les enums
*déclarés* dans un test et un verdict `testOnly` ailleurs. Deux sentinelles montrent que le
verdict est identique, mot pour mot, selon que la marche vit en prod ou dans un test.

**Trois enums concernés, zéro récolte, et la raison est la bonne garde.** Six de leurs
entrées ne sont nommées nulle part en production, et pourtant elles vivent : leurs entrées
portent une **clé de charge utile**.

```kotlin
CAROUSEL_POST(MainApiProvider.CAROUSEL_POST_KIND),
```

L'entrée est atteinte par la valeur de `kind`, jamais par son nom. Aucun scan par
identifiant ne peut la voir vivre, et la supprimer casserait le décodage d'une charge utile
du serveur. C'est la garde principale du fichier.

**Deux vérifications supplémentaires, toutes deux à zéro.** La règle `@TypeConverter` est un
balayage au niveau du fichier : quinze fichiers du corpus en portent un, et ils protègent
zéro enum. La sur-largeur existe dans le texte, pas dans les faits.


## G34 : le tour des cinq familles est clos

Recensement de `findDeadIslands`, la dernière. Deux résultats.

**La limite de taille ne mord jamais.** 26003 explications sur le corpus, et `I8:max-size`
n'y apparaît **pas une fois**. Le verdict est identique de la limite 8 à la limite 256 :
quatre îlots, de tailles 4, 3, 3 et 2. La falaise de G13 ne coûte rien ici, et c'est la
seconde correction que G13 reçoit — la première disait que le circuit défait chaînes et
cycles. La limite est un plafond de coût, pas une perte. Un test le montre en petit, et un
second vérifie qu'elle mord bel et bien quand on la descend sous la taille de l'îlot : elle
fonctionne, elle ne sert simplement à rien.

**La découverte de KJ-070 manque ici aussi.** Sur les rejets propres à la famille,
`@ScopeApplication` 189, `@ScopeActivity` 58, `@ScopeFragment` 20, `@ScopeGridGameFragment`
2 : **269 déclarations** écartées par des portées Dagger que le projet déclare lui-même.

| Famille | La découverte KJ-070 | Coût |
|---|---|---|
| `unusedSymbols` | appliquée | — |
| `unusedMembers` | absente | 1679 membres (G29) |
| `deadIslands` | absente | 269 déclarations |

**1948 déclarations** écartées pour une raison qu'une famille du même dépôt sait déjà lever.
C'est de loin le plus gros écart du dossier, et ce n'est pas un trou de raisonnement : c'est
une découverte qui n'a pas traversé.

Les six gardes tiennent la frontière : `@Module`, `@Parcelize`, `@Entity`, une portée que le
corpus ne déclare pas, une annotation déclarée sans `@Scope`, et le corpus tronqué.


## G35 : un fichier qui fait taire une famille entière

Premier recensement des familles secondaires, et la plus grosse récolte depuis G30.

| Famille | Trouvailles | Explications |
|---|---|---|
| `findUnheardEvents` | 5 | — |
| dépendances Gradle | 0 | 275, toutes `alive` |
| clés Remote Config | **0** | 328, dont **95 `unreferenced`** |

La dernière ligne est une contradiction : les deux fonctions du même fichier ne disent pas la
même chose. La cause est un coupe-circuit que l'explication ne modélise pas — un **seul**
fichier du dépôt qui lit `remoteConfig.all` éteint la famille entière, où qu'il se trouve
(`unusedRemoteConfigKeys.ts:197`).

**Deux des trois déclencheurs sont abusifs.** Ils ont la même forme :

```kotlin
override fun getAll(): Map<String, String> =
    RemoteConfigParameter.entries.asSequence().map { it.key }
        .associateWith { remoteConfig.all.getValue(it).asString() }
```

`remoteConfig.all` n'est là qu'une **table de correspondance**, interrogée clé par clé pour
les entrées d'un enum connu. Une clé du XML absente de `RemoteConfigParameter` n'est jamais
retournée : elle n'est pas lue. Le troisième déclencheur, lui, est l'écran d'administration
qui affiche tout, et il reste gardé.

**29 clés distinctes** jamais lues, sur 95 déclarations. Trois relues à la main, toutes
confirmées : `enable_dark_mode`, `section_navigator_enabled` et `external_web_hosts`
n'apparaissent que dans les fichiers de valeurs par défaut.

Les gardes couvrent l'itération (`for ((k, v) in …)`), le `forEach`, l'écran
d'administration, le marqueur d'ignorance et le corpus tronqué. Et une sentinelle fixe le
désaccord lui-même : `explain` continue de juger la clé jamais lue pendant que `find` ne la
rapportera jamais.


## G36 : quand les deux réponses d'une même famille se contredisent

G35 avait trouvé `explain` et `find` en désaccord chez les clés Remote Config. Les six
familles, comparées :

| Famille | `find` | `explain` | |
|---|---|---|---|
| symboles | 48 | 49 | **désaccord de 1** |
| membres | 42 | 42 | accord |
| enums | 4 | 4 | accord |
| îlots | 4 | 4 | accord |
| Remote Config | 0 | 95 | **désaccord** (G35) |
| Gradle | 0 | 0 | accord |

**Le désaccord des symboles est un défaut de `--why`, pas du détecteur.**
`MainActivityV2PreferenceInjectionHolder` (`MainActivityV2.kt:639`) est jugée `unreferenced`
par `explain` alors qu'elle est construite dans son propre fichier (`:152`). `explainSymbols`
teste d'abord si les mentions **hors** du fichier déclarant se réduisent à des déclarations
d'injection ; ici oui, donc la branche KJ-067 conclut et n'atteint jamais `alive:same-file`,
qui vient après.

Trois formes mesurées, une seule diverge, ce qui isole la cause à la **combinaison** d'un
usage dans le fichier et d'une déclaration d'injection ailleurs.

**Pourquoi ça compte plus qu'une trouvaille.** `--why` est l'outil avec lequel ce dossier a
mesuré trente-cinq trous. Une explication qui dit `unreferenced` pour une déclaration que le
détecteur épargne est une explication en laquelle on ne peut pas avoir confiance. Et c'est la
troisième fois : G28 (le filtre avale le verdict), G35 (le coupe-circuit n'est pas modélisé),
G36 (une branche conclut avant l'autre).

Les gardes fixent l'invariant sur les membres, les enums et cinq formes ordinaires de
symboles, pour qu'une dérive s'y signale.


## G37 : deux trouvailles, une seule coupe

Dernières familles secondaires recensées, et deux résultats opposés pour la même forme de
garde.

**`findWriteOnlyKeys` : un coupe-circuit identique à celui de G35, mais gratuit.** Une seule
**lecture** dont la clé n'est pas résoluble éteint toute sa catégorie
(`writeOnlyKeys.ts:219`). Sur le corpus, 147 sites empoisonnent `preferenceKey`, tous venus
de délégués génériques. En retirant les 31 fichiers empoisonnants et en relançant, la famille
rend **toujours une seule trouvaille** : le poison ne cache rien. Même forme qu'en G35,
résultat opposé, et c'est pourquoi il fallait mesurer les deux plutôt que généraliser.

**`findUnheardEvents` : l'invariant violé, une fois.** Les cinq trouvailles sont par site de
publication, ce qui est voulu. Mais deux portent la **même** étendue de suppression : les
deux `post()` de `onScrollStateChanged` (`LiveSlideshowGridFragment.java:149` et `:151`)
proposent chacune de retirer la méthode entière. L'utilisateur voit deux ampoules pour une
seule édition, et appliquer la seconde après la première porte sur un texte qui a changé.

| Famille | Trouvailles | Étendues partagées |
|---|---|---|
| symboles | 48 | 0 |
| membres | 42 | 0 |
| événements | 5 | **1, par deux trouvailles** |

**Le cas positif tourne sur le vrai corpus**, parce que cette famille ne se déclenche pas sur
un corpus minimal : elle a besoin du bus, de ses abonnés et de ses conventions. Le bloc se
skippe si `/Users/kevin/Desktop/work/example` n'est pas là, et il ajoute environ huit
secondes à la suite, qui passe de trois à onze secondes.

**Sixième sonde fautive**, et la plus bête : `findUnheardEvents` rend `{ events }`, pas
`{ findings }`. Ma vérification d'invariant a lu un tableau vide et conclu « aucune violation »
avant que le chiffre de 5, mesuré au tour précédent, ne contredise le zéro.


## G38 : le seul verdict qui modifie du code vivant

`MakeSelfOnlyPrivate` prend les membres au verdict `selfOnly` et propose de les rendre
privés. C'est la seule famille qui **modifie** du code vivant au lieu d'en retirer, donc la
justesse du verdict y compte autrement.

`selfOnly` veut dire « toutes les mentions restantes sont dans la classe qui déclare le
membre ». Le détecteur ne demande pas si ces mentions sont, elles, vivantes. Deux cas :

**Le seul utilisateur est rapporté mort dans le même appel.** `helper` n'est atteint que par
`dead`, que le même appel déclare mort, et la commande proposerait quand même de rendre
`helper` privé. Le détecteur a l'information et ne s'en sert pas. Sur le corpus, zéro cas
(`unreferenced` n'y vaut que 2) : mécanisme réel, récolte nulle, comme en G23.

**Le seul utilisateur est écarté par un filtre.** Quatrième apparition de la même erreur de
catégorie, après G21, G22 et G27. Mesure approchée : **34 sur 169**. La plupart sont des
constantes de `companion object` lues depuis une méthode `@Override` ou `@UnstableApi`, donc
bien vivantes. Ce qui est en cause n'est pas le résultat, c'est la **preuve**.

| Verdict, avec `includeSelfOnly` | Membres |
|---|---|
| `selfOnly` | 169 |
| `testOnly` | 40 |
| `unreferenced` | 2 |

Les gardes fixent la frontière : deux témoins dont un vivant gardent le verdict, un
utilisateur hors de la classe l'annule, un membre déjà privé n'est pas proposé.

**Ce que le tour complet a montré.** Sur onze familles recensées, deux défauts seulement se
répètent : « une déclaration non jugée sert de preuve » cinq fois (G21, G22, G27, G29/G34,
G38), et le désaccord `explain` contre `find` trois fois (G28, G35, G36).


## G39 : un porteur que personne ne lance, et la fin du tour

`RemoveTestOnlyCode` retire les déclarations `testOnly` **avec** les tests qui les nomment.
`testOnly` prouve qu'aucune source de production ne nomme la déclaration et qu'au moins un
test la nomme. Il ne demande pas si ce test est lui-même atteint.

| Porteur | Verdict |
|---|---|
| aucun | `unreferenced` |
| une classe de test | `testOnly` |
| un utilitaire de test, nommé par un test | `testOnly` |
| **un utilitaire de test que rien ne nomme** | **`testOnly`** |

La quatrième ligne est le trou. Une classe `FooTest` est lancée par le coureur sans que
personne la nomme, c'est un point d'entrée. Un `object TestUtils` que pas un test ne nomme
n'est lancé par personne : la déclaration qu'il tient n'est exercée par aucun test. Et
l'utilitaire orphelin n'est pas rapporté non plus, donc la commande retirerait la déclaration
en laissant l'utilitaire nommer un symbole disparu.

**Zéro sur le corpus** : les quinze `testOnly` sont tous tenus par de vraies classes de test.
Cinquième recensement de suite sans récolte, et c'est le résultat.

**Le tour des onze familles est clos.**

| Famille | Gaps |
|---|---|
| `unusedSymbols` | G20, G21, G24, G25, G26, G27, G28 |
| `unusedMembers` | G23, G29, G30, G31, G38 |
| `unusedResources` | G32 |
| `scanEnums` | G33 |
| `deadIslands` | G34 |
| Remote Config | G35 |
| `writeOnlyKeys` et `unheardEvents` | G37 |
| dépendances Gradle | G35, rien à signaler |
| `MakeSelfOnlyPrivate` | G38 |
| `RemoveTestOnlyCode` | G39 |

**Deux défauts seulement se répètent**, et ils portent dix des vingt gaps du second tour :
« une déclaration non jugée sert de preuve » (G21, G22, G27, G29, G34, G38) et « `explain` et
`find` ne disent pas la même chose » (G28, G35, G36).


## G40 : la règle unique derrière six trous

Le recensement clos, deux défauts seulement se répètent. Celui-ci porte six gaps à lui seul,
et ce fichier l'écrit **une fois** puis le met à l'épreuve à chacun de ses sites.

**La règle.** Une déclaration qu'un filtre a écartée n'est pas *prouvée vivante*, elle est
*non jugée*. Elle ne doit pas servir de preuve de vie pour une autre. Un filtre répond « je ne
sais pas » ; le détecteur traite cette absence de savoir comme un certificat et le transmet
aux voisins.

| Site | Le témoin écarté | Coût mesuré |
|---|---|---|
| G21 | un membre F7 ancre ses voisins dans l'îlot | 1 dossier de neuf fichiers |
| G22 | une annotation de portée ancre ses voisins | — |
| G27 | un sous-type annoté cautionne son parent | 93 interfaces |
| G29 | une portée du projet écarte les membres de sa classe | 1679 membres |
| G34 | la même portée efface l'îlot | 269 déclarations |
| G38 | un témoin écarté conclut `selfOnly` | 34 verdicts |

**La forme du test.** Deux appels par site, sur le **même** corpus à une chose près : le
témoin porte, ou non, ce qui le fait écarter. Le premier est vert et montre que le détecteur
sait juger la cible ; le second est le trou. Ce n'est jamais la cible qui change, seulement
son voisin.

Aucune trouvaille de plus. Ce que le fichier apporte, c'est qu'une correction faite quelque
part se vérifie partout en un seul run — ce qu'aucun des six gaps ne peut dire seul.

**Ce que la règle ne dit pas.** Elle porte sur les filtres qui disent « je ne sais pas », pas
sur les annotations qui désignent un vrai point d'entrée. Quatre gardes : `@Module`,
`@Parcelize`, `@Subscribe`, et la borne de KJ-070 (une annotation que le corpus ne déclare
pas reste étrangère).


## G41 : la seconde règle, derrière trois trous

G40 a écrit la première des deux règles du recensement. Voici la seconde.

**La règle.** `explain` et `find` doivent dire la même chose du même corpus. Ce que l'une
juge rapportable, l'autre le rapporte ; ce que l'une épargne, l'autre l'épargne.

Ce n'est pas une élégance : `--why` est l'outil avec lequel ce dossier a mesuré trente-neuf
trous, et trois fois il a fallu s'apercevoir qu'il mentait avant de croire un chiffre.

| Site | Ce que `find` fait | Ce que `explain` dit |
|---|---|---|
| G28 | épargne l'interface, quel que soit le corpus | `F8`, et rien sur ce que le comptage aurait donné |
| G35 | `return []` dès qu'un fichier lit `remoteConfig.all` | continue de juger les 95 clés jamais lues |
| G36 | épargne la classe, son fichier la construit | `unreferenced`, la branche KJ-067 ayant conclu trop tôt |

**La forme du test**, la même qu'en G40 : deux appels par site sur le même corpus à une chose
près, le premier vert. Ce qui change d'un appel à l'autre n'est jamais la cible mais son
contexte, et le détecteur, lui, suit ce changement.

Aucune trouvaille de plus. Ce que le fichier apporte : une correction de l'instrumentation se
vérifie aux trois endroits en un seul run. Les gardes fixent l'accord là où il règne déjà,
sur les membres, les enums et cinq formes ordinaires de symboles.

**Les deux règles sont maintenant écrites** (G40, G41) et couvrent neuf des vingt-deux gaps
du second tour.


# Ce que le détecteur affirme est juste

## Audit des trouvailles actuelles : zéro faux positif

Ce dossier cherche ce que le détecteur rate. Il fallait aussi vérifier ce qu'il affirme :
un faux positif fait supprimer du code vivant.

Six des 33 trouvailles `unreferenced` ont été vérifiées à la main, choisies pour être les
plus suspectes — un `*DO` désérialisable, une interface implémentée, une classe importée
ailleurs. **Aucun faux positif.**

Deux reposent sur la résolution par paquet des homonymes (`Media3ConfigurationDO` et
`Persistence` existent chacune en deux exemplaires, dont un vivant). Et `LocationEvents`
montre la cohérence entre familles : elle est importée par `FetchWeatherTask.java:44`, cet
import est lui-même dans les 45 imports Java morts de KJ-068, et les deux verdicts
s'accordent **parce qu'un import ne compte pas comme un usage**.

Cette règle est maintenant verrouillée par un test dans `G04` : si un import comptait comme
une mention, la classe passerait pour vivante et l'import pour mort, deux verdicts qui se
contredisent sur la même ligne.

**Ce que ça change pour la lecture du dossier :** tous les trous listés sont des faux
négatifs. Le détecteur ne dit pas tout, mais ce qu'il dit est juste.

## Audit du balayage : zéro faux positif, et une garde fine verrouillée

Les 16 déclarations que le balayage rapporte sur le corpus ont été examinées. Le suspect le
plus sérieux était `setTextViewTextGravity` (`SimpleScreenBindings.kt:40`) — nom de fichier
évoquant le data binding, donc potentiellement appelé depuis le XML. Fausse alerte : la
fonction est `private` et sans annotation.

La garde mesurée est plus fine que je ne l'imaginais :

| Déclaration | Sort |
|---|---|
| `fun` privée morte, sans annotation | rapportée |
| `fun @BindingAdapter` morte | épargnée |
| `val` privé `@JvmField` | épargné |
| `fun @Composable` privée morte | **rapportée** |
| `fun @Preview @Composable` privée | épargnée |

`@Composable` ne dit rien sur l'atteignabilité ; `@Preview` dit que l'outillage appelle.
**440 occurrences de `@Preview` dans le corpus** en dépendent.

Six cas verrouillent cette garde dans `G14`, dont la contrepartie : `@Composable` seul ne
doit **pas** protéger, sinon le balayage perdrait une famille entière.

# Pistes instruites puis closes

## Deux pistes instruites et closes ce tour-ci

- **Les `<style>` XML jamais référencés** : déjà couverts, `style` est dans `ALL_KINDS`
  de `unusedResourceKeys.ts:48`.
- **Les règles ProGuard `-keep` nommant une classe disparue** : aucune sur le corpus. Les
  18 trouvées par une première sonde visaient des classes de bibliothèques (okhttp,
  coroutines, facebook), et les deux seules règles nommant une classe du projet
  (`HeightInterface`, `FastDateTimeZoneProvider`) désignent des classes qui existent
  toujours.

## Deux pistes closes, et ce qu'elles apprennent sur les limites

**Les autres limites chiffrées du dépôt ne mordent pas.** Le recensement en a trouvé une
vingtaine ; trois pouvaient coûter des trouvailles :

| Limite | Valeur | Maximum réel du corpus |
|---|---|---|
| `MAX_DOC_LINES` | 20 000 | 3 120 lignes |
| `MAX_WHENS_PER_DOC` | 200 | 13 `when` |
| `MAX_FILES` (Gradle) | 400 | 55 fichiers |

Toutes sont d'un ordre de grandeur au-dessus du réel. C'est précisément ce qui distingue
`maxIslandSize: 8` de G13 : **huit est du même ordre que les données qu'il mesure**, donc
il mord par construction. Une limite de sécurité doit être hors d'atteinte ; sinon elle
devient un filtre silencieux.

**Les déclarations de premier niveau autres que les classes sont couvertes.** Les 394
fichiers Kotlin sans aucune classe (11 %) contiennent fonctions, constantes et extensions.
Sept formes vérifiées, toutes rapportées quand rien ne les nomme : fonction, `val`,
`const val`, extension simple, extension sur un type du projet, propriété d'extension,
receveur générique. Aucun test à écrire.
