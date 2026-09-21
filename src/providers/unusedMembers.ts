import { parse, RawSymbol } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import {
  CONVENTION_FUN_NAMES,
  fileOptsOut,
  UNUSED_DECLARATION,
  suppressesDiagnostic,
  buildLineStarts,
  collectAnnotationTargets,
  matchBrace,
  findMatchingParen,
  sanitizeForUsageScan,
} from '../util/kotlinScan';
import { declarationSpan } from '../util/declarationSpan';
import { isTestSourceSet } from '../util/testPaths';
import { isBuildArtifactPath, isGeneratedSource } from '../util/resourceAllowlists';
import { stripKotlinComments } from '../util/xmlRefs';
import {
  BENIGN_TOPLEVEL_ANNOTATIONS,
  Harvest,
  SymbolSource,
  accessorNames,
  countWord,
  frameworkAncestor,
  harvestMentions,
  isUnder,
  matchesGlob,
  removalExtent,
  blankImportLines,
  stripImportLines,
  scopeAnnotationsOf,
} from './unusedSymbols';

/**
 * KJ-042: class members nothing in the workspace references.
 *
 * The last big tier. KJ-026 already covers PRIVATE members file-locally and
 * KJ-032 covers top-level declarations workspace-wide; this covers what is
 * left: `public`, `internal` and `protected` members at depth >= 1. It is THE
 * noisy detector by nature (a comparable tool reports 506 findings here with a
 * measured 57% false-positive rate), so the bet is inverted: report fewer,
 * report none wrong.
 *
 * The safety comes from the same token bag as KJ-032: ANY mention of the name,
 * anywhere in anything we read, keeps every bearer of that name alive. Member
 * names collide constantly (`create`, `bind`, `reset`), and the bag turns that
 * collision into silence rather than into false positives.
 *
 * ## Two structural limits, stated up front
 *
 * The harvest excludes `build/`, so every GENERATED caller is invisible:
 * Dagger, Room and DataBinding call members from code the bag never reads.
 * Guards M4/M6 (annotations on the class chain or the member) carry the whole
 * safety burden for that, which is why the benign-annotation allowlist is
 * strict.
 *
 * An interface method and its only override die together in silence: the
 * override's declaration is itself a token of the bag, so the interface member
 * always reads as mentioned. False negative, safe direction, accepted.
 *
 * ## What M3 actually costs, measured
 *
 * M3 (Java class with a supertype) reads as the harshest guard here, and it is
 * worth knowing it retains almost nothing on its own. On test/kotlin-lsp-main,
 * 265 sources with 15 supertyped Java files, its bucket held 56 members while
 * it was evaluated FIRST. Moved after M2/M4/M6 — same findings, the guards are
 * disjunctive — the bucket drops to zero: 43 of those members are `@Override`
 * (M2) and 12 sit under a `Serializable` root (M4). Relaxing M3 on that corpus
 * would therefore gain nothing, which is why the relaxation was specified and
 * then not built. Re-measure with `--why` before revisiting.
 *
 * Nested TYPES (`class Outer { class Inner }`) are out of scope: candidate
 * kinds are restricted to fun/composable/val/var.
 */

export type UnusedMemberVerdict = 'unreferenced' | 'testOnly' | 'selfOnly';

export interface UnusedMemberScanInput {
  sources: readonly SymbolSource[];
  testSourceSets: readonly string[];
  /** An incomplete corpus cannot prove absence, so it produces nothing. */
  truncated?: boolean;
  ignoreNames?: readonly string[];
  ignorePaths?: readonly string[];
  publishedModules?: readonly string[];
  includeTestOnly?: boolean;
  includeSelfOnly?: boolean;
  /**
   * Extents of KJ-032 findings (M12): a member of a class already reported
   * whole would triple the noise for a single root cause.
   */
  deadDeclarations?: readonly { path: string; removeStart: number; removeEnd: number }[];
}

export interface UnusedMember {
  name: string;
  kind: string;
  /** Dot-joined enclosing chain, e.g. `DialogHelper` or `Foo.Companion`. */
  container: string;
  verdict: UnusedMemberVerdict;
  path: string;
  line: number;
  character: number;
  /** Whole-declaration extent, or -1 when it could not be delimited. */
  removeStart: number;
  removeEnd: number;
  testMentions: number;
  isDeprecated: boolean;
}

/** One line per raw member, saying what happened to it. For `--why`. */
export interface MemberExplanation {
  name: string;
  container: string;
  path: string;
  line: number;
  outcome: string;
}

const IGNORE_MARKER = 'kotlin-jump:ignore unused-member';

/**
 * Kinds that OWN members. `annotation` is deliberately absent: annotation
 * attributes are matched by named arguments at use sites, a shape this
 * detector does not model, so they are simply never candidates.
 */
const CLASS_LIKE_KINDS = new Set(['class', 'dataClass', 'sealedClass', 'object', 'interface', 'enum']);

const MEMBER_KINDS = new Set(['fun', 'composable', 'val', 'var']);

/**
 * Annotations that do NOT make a member reachable. Same stance as KJ-032:
 * everything else does. `JvmStatic`, `JvmField` and `JvmOverloads` never alter
 * the spelled name, so they are benign; `JvmName` DOES rename the JVM surface
 * and is therefore absent, which makes it foreign, which is the guard (M6).
 */
const BENIGN_MEMBER_ANNOTATIONS = new Set([
  ...BENIGN_TOPLEVEL_ANNOTATIONS,
  'JvmStatic', 'JvmField', 'Override',
  // DI scope annotations: generated Dagger code only ever calls the
  // CONSTRUCTOR of a scoped class (plus @Inject members, which M6 catches on
  // the member itself). Its other members are called by ordinary spelled code
  // the bag reads. Treating @Singleton as foreign silenced a deprecated getter
  // that was genuinely dead. Custom scopes stay foreign: unknowable set.
  'Singleton', 'Reusable',
]);

interface MemberCandidate {
  sym: RawSymbol;
  name: string;
  /**
   * KJ-073 : un ancetre declare ce membre de facon ENGAGEANTE, et retirer la
   * surcharge seule ne compilerait plus.
   */
  boundByContract: boolean;
  /**
   * KJ-076 : ou se trouvent les mentions de code hors de son etendue mais
   * dans sa classe. Ce sont les TEMOINS du verdict `selfOnly`, et il faut
   * savoir qui les porte.
   */
  codeInsideClassAt: number[];
  /** KJ-073 : toute la chaine d ancetres se resout dans le corpus. */
  chainVisible: boolean;
  /**
   * KJ-073 : des declarations de ce nom qui ne sont NI la sienne NI celle d un
   * ancetre. La recolte compte par nom : une soeur qui porte le meme nom rend
   * toute mention inattribuable, et M2 reste la seule reponse honnete.
   *
   * Mesure : sans cette retenue, `restoreIdModel` de
   * `PageExternalAnalyticsIdModelHelper` se voyait vivant par la declaration de
   * `PageAnalyticsIdModelHelper`, et l ilot mort de la premiere disparaissait.
   */
  homonyms: number;
  /** Les supertypes directs des conteneurs, et d ou les resoudre. */
  supersDirects: readonly string[];
  portee: Portee;
  /**
   * KJ-073 : combien d ANCETRES du conteneur declarent un membre de ce nom.
   *
   * Une declaration n est pas un appel. La recolte compte les occurrences du
   * nom dans tout le corpus, et la ligne `fun computeSeek(p: Float): Float` de
   * l interface en est une : sans cet escompte, toute surcharge d une methode
   * declaree ailleurs se voit vivante par sa propre declaration parente.
   * C est la regle de G40, appliquee a la verticale.
   */
  ancestorDecls: number;
  path: string;
  container: string;
  isJava: boolean;
  /** The member's own annotations. */
  annoNames: string[];
  /** A `@Suppress` naming `unused`, on the member or on any enclosing declaration. */
  optsOutUnused: boolean;
  /** Guard that took the whole ENCLOSING out of scope, or null. */
  enclosingRejection: string | null;
  /** Any enclosing declares a supertype (Java inheritance, read late). */
  enclosingSupertyped: boolean;
  /** Any enclosing Java declaration line never reached its `{`. */
  enclosingDeclTruncated: boolean;
  /** Mentions of the name inside the member's own declaration extent. */
  selfInSpan: number;
  /** Mentions anywhere in its file, comments and imports stripped, strings kept. */
  selfInFile: number;
  /** Code-only mentions (strings blanked) outside the member span. */
  codeOutsideSpan: number;
  /** Of those, how many fall inside the enclosing class extent. */
  codeInsideClass: number;
  /** String-literal mentions anywhere in the file. */
  stringMentions: number;
  removeStart: number;
  removeEnd: number;
  memberOffset: number;
  /** Modifiers read from the raw declaration line, belts for parser flags. */
  hasOverrideModifier: boolean;
  hasExternalModifier: boolean;
}

interface EnclosingInfo {
  sym: RawSymbol;
  annoNames: string[];
  /** Carries a `@Suppress` that names `unused`. */
  optsOutUnused: boolean;
  isFunInterface: boolean;
  /** A Java declaration line that never reached its `{`: inheritance unknown. */
  declTruncated: boolean;
  extentStart: number;
  extentEnd: number;
}

/**
 * Every member of the corpus, with its ownership PROVEN rather than assumed.
 *
 * `depth >= 1` does not mean "member": a local in a function body, a member of
 * an `object :` literal and a `val` inside `init {}` all sit at depth >= 1.
 * Ownership is rebuilt with a stack over the symbols in declaration order, and
 * a symbol is a member iff the enclosing on top of the stack is class-like AND
 * the symbol sits exactly one brace deeper. The two conditions are belts for
 * each other.
 */
export function collectMemberCandidates(
  sources: readonly SymbolSource[],
  testSourceSets: readonly string[],
): {
  candidates: MemberCandidate[];
  /** Every named declaration of the corpus, all kinds, all depths. */
  declNameCounts: Map<string, number>;
  /** Class name -> union of its supertypes, for the framework walk. */
  supertypesByName: Map<string, string[]>;
  /** KJ-070: the workspace's own DI scopes, benign like `@Singleton`. */
  scopeAnnotations: Set<string>;
} {
  const scopeAnnotations = scopeAnnotationsOf(sources);
  const candidates: MemberCandidate[] = [];
  const declNameCounts = new Map<string, number>();
  const supertypesByName = new Map<string, string[]>();
  /** Toutes les declarations de type du corpus, par nom NU : les homonymes cohabitent. */
  const typesByName = new Map<string, TypeDecl[]>();

  for (const src of sources) {
    const isJava = src.path.endsWith('.java');
    if (!isJava && !src.path.endsWith('.kt')) continue;
    if (isBuildArtifactPath(src.path)) continue;

    const parsed = isJava ? parseJava(src.path, src.text) : parse(src.path, src.text);

    // Every declared name counts toward the duplicate denominator, because a
    // mention can never be attributed to one bearer.
    // Les proprietaires ouverts a cet instant de la lecture. Cette boucle voit
    // TOUS les types, y compris les interfaces, dont les membres ne seront
    // jamais candidats (pas de corps, donc pas d'etendue, F16). C'est
    // justement leur declaration qu'il faut connaitre pour l'escompte.
    // L'escompte se soustrait de `harvest.main`, qui range les sources de test
    // dans un autre sac. Compter ici une declaration que ce sac n'a jamais vue
    // retirerait une mention inexistante, et inventerait la trouvaille.
    const dansUnTest = isTestSourceSet(src.path, testSourceSets);
    const proprietaires: RawSymbol[] = [];
    const declaresIci = new Map<RawSymbol, TypeDecl>();
    for (const s of parsed.symbols) {
      while (proprietaires.length > 0
        && proprietaires[proprietaires.length - 1].depth >= s.depth) proprietaires.pop();
      if (CLASS_LIKE_KINDS.has(s.kind)) {
        const decl: TypeDecl = {
          name: s.name,
          fqn: parsed.packageName ? `${parsed.packageName}.${s.name}` : s.name,
          paquet: parsed.packageName,
          imports: parsed.imports,
          isInterface: s.kind === 'interface',
          supertypes: (s.supertypes ?? []).map(t => t.replace(/<.*/, '').trim()).filter(Boolean),
          members: new Set<string>(),
          bindingMembers: new Set<string>(),
        };
        declaresIci.set(s, decl);
        const liste = typesByName.get(s.name) ?? [];
        liste.push(decl);
        typesByName.set(s.name, liste);
        proprietaires.push(s);
      } else if (MEMBER_KINDS.has(s.kind) && proprietaires.length > 0 && !dansUnTest) {
        const owner = proprietaires[proprietaires.length - 1];
        const decl = declaresIci.get(owner);
        if (decl) {
          decl.members.add(s.name);
          if (owner.kind === 'interface' || s.isAbstract === true) decl.bindingMembers.add(s.name);
        }
      }

      declNameCounts.set(s.name, (declNameCounts.get(s.name) ?? 0) + 1);
      if (CLASS_LIKE_KINDS.has(s.kind) && (s.supertypes?.length ?? 0) > 0) {
        const bare = s.supertypes!.map(t => t.replace(/<.*/, '').trim()).filter(Boolean);
        const existing = supertypesByName.get(s.name) ?? [];
        for (const b of bare) if (!existing.includes(b)) existing.push(b);
        supertypesByName.set(s.name, existing);
      }
    }

    if (isGeneratedSource(src.text)) continue;                        // F18
    if (isTestSourceSet(src.path, testSourceSets)) continue;          // F2
    if (fileOptsOut(src.text, UNUSED_DECLARATION)) continue;
    if (src.text.includes(IGNORE_MARKER)) continue;

    /** Une seule copie sans commentaires par fichier, et seulement si un symbole mort la demande. */
    let copieSc: string | undefined;
    const sansCommentaires = (): string => (copieSc ??= stripKotlinComments(src.text));
    const clean = sanitizeForUsageScan(src.text);
    const lineStarts = buildLineStarts(clean);
    const lastLine = lineStarts.length - 1;
    const annotations = collectAnnotationTargets(clean);
    const keptText = stripImportLines(stripKotlinComments(src.text));
    const rawLines = src.text.split('\n');

    const annosAt = (sym: RawSymbol): string[] => {
      const lo = lineStarts[sym.line];
      const hi = lo + sym.character;
      return annotations.filter(a => a.target >= lo && a.target <= hi).map(a => a.name);
    };
    // `@Suppress` is in the benign list, which only says it makes nothing
    // reachable. Whether it opts OUT of this detector depends on the
    // diagnostic it names, the check the top level detector does as F12. This
    // one inherited the benign list without the check, so a member written
    // `@Suppress("unused") fun keep()` was deleted by Remove Everything Unused.
    // Arguments are read on the raw text: the sanitizer blanks strings.
    const silenceAt = (sym: RawSymbol): boolean => {
      const lo = lineStarts[sym.line];
      const hi = lo + sym.character;
      return annotations.some(a => a.target >= lo && a.target <= hi
        && (a.name === 'Suppress' || a.name === 'SuppressWarnings') && a.argStart >= 0
        && suppressesDiagnostic(src.text.slice(a.argStart, a.argEnd), UNUSED_DECLARATION));
    };

    const enclosingInfo = (sym: RawSymbol): EnclosingInfo => {
      const nameOffset = lineStarts[sym.line] + sym.character;
      // The class extent: first `{` after the name, skipping a constructor
      // parameter list. Without a body there are no members to own.
      let i = nameOffset;
      let extentStart = -1;
      let extentEnd = -1;
      scan: while (i < clean.length) {
        const ch = clean[i];
        if (ch === '(') {
          const close = findMatchingParen(clean, i);
          if (close === -1) break scan;
          i = close + 1;
          continue;
        }
        if (ch === '{') {
          const close = matchBrace(clean, i);
          if (close !== -1) { extentStart = i; extentEnd = close; }
          break scan;
        }
        if (ch === '\n' && !/[:,\s]$/.test(clean.slice(nameOffset, i).trimEnd())) break scan;
        i++;
      }
      return {
        sym,
        annoNames: annosAt(sym),
        optsOutUnused: silenceAt(sym),
        isFunInterface: /\bfun\s+interface\b/.test(rawLines[sym.line] ?? ''),
        // The Java parser reads supertypes from the DECLARATION LINE only, so
        // a line that never reaches its `{` may carry an `implements` clause
        // nobody has seen. "No supertype" cannot be trusted there: a single
        // line break would otherwise disarm M3, the strictest guard of the
        // detector, and hand every member of the class to the candidates.
        declTruncated: isJava && !(rawLines[sym.line] ?? '').includes('{'),
        extentStart,
        extentEnd,
      };
    };

    // The parser emits no symbol for `companion object`, so its members sit
    // one brace DEEPER than a direct member. Their extents make them
    // recognisable without guessing.
    const companionExtents: { start: number; end: number; name: string; optsOutUnused: boolean }[] = [];
    const companionRe = /\bcompanion\s+object\b(?:\s+(\w+))?[^{\n]*\{/g;
    let cm: RegExpExecArray | null;
    while ((cm = companionRe.exec(clean)) !== null) {
      const open = clean.indexOf('{', cm.index);
      const close = open === -1 ? -1 : matchBrace(clean, open);
      if (close === -1) continue;
      // The anonymous companion is not a symbol, so it never sits in the
      // enclosing chain and a `@Suppress("unused")` written on it was never
      // seen: its members went with Remove Everything Unused. Its annotations
      // target the first code character of its header, `companion` or a
      // modifier in front of it, on that same line.
      const headerStart = clean.lastIndexOf('\n', cm.index - 1) + 1;
      const optsOutUnused = annotations.some(a => a.target >= headerStart && a.target <= cm!.index
        && (a.name === 'Suppress' || a.name === 'SuppressWarnings') && a.argStart >= 0
        && suppressesDiagnostic(src.text.slice(a.argStart, a.argEnd), UNUSED_DECLARATION));
      companionExtents.push({ start: open, end: close, name: cm[1] ?? 'Companion', optsOutUnused });
    }

    // Hoisted out of the symbol loop: it depends on the FILE, not on the
    // member. Rebuilt once per symbol it was, which on a 6300 file corpus is
    // tens of thousands of full file rebuilds for one value per file.
    const cleanNoImports = blankImportLines(clean);

    const stack: EnclosingInfo[] = [];
    for (const sym of parsed.symbols) {
      while (stack.length > 0 && stack[stack.length - 1].sym.depth >= sym.depth) stack.pop();

      // The synthetic Companion is not an owner here: its members are reached
      // through the enclosing class (see companionExtents below).
      if (CLASS_LIKE_KINDS.has(sym.kind) && !sym.isCompanion) {
        stack.push(enclosingInfo(sym));
        continue;
      }
      if (sym.isCompanion) continue;
      // A member of an `object :` literal implements the literal's supertype
      // contract; its reachability goes through that contract, not its name.
      if (stack.some(e => e.sym.name.startsWith('$anon'))) continue;
      if (!MEMBER_KINDS.has(sym.kind)) continue;
      const enclosing = stack[stack.length - 1];
      if (!enclosing) continue;
      // M1: class-like enclosing AND exactly one brace deeper. A local in a
      // fun body fails the second test. One level deeper still counts when
      // the offset sits inside a companion block, which the parser does not
      // emit as a symbol.
      const symOffset = lineStarts[sym.line] + sym.character;
      let companionName: string | undefined;
      let companionSilence = false;
      if (sym.depth === enclosing.sym.depth + 2) {
        const companion = companionExtents.find(e => symOffset > e.start && symOffset < e.end);
        companionName = companion?.name;
        companionSilence = companion?.optsOutUnused ?? false;
        if (!companionName) continue;
      } else if (sym.depth !== enclosing.sym.depth + 1) {
        continue;
      }
      if (sym.isPrivate) continue;                                    // KJ-026's territory
      if (sym.isPrimaryCtorParam) continue;                           // M7: KJ-025's territory

      const chain = [...stack];
      const enclosingRejection = rejectEnclosingChain(chain, scopeAnnotations);
      const enclosingSupertyped = chain.some(e => (e.sym.supertypes?.length ?? 0) > 0);
      const enclosingDeclTruncated = chain.some(e => e.declTruncated);

      const nameOffset = symOffset;
      const span = declarationSpan(clean, lineStarts, {
        kind: sym.kind === 'fun' || sym.kind === 'composable' ? 'fun' : 'prop',
        name: sym.name,
        line: sym.line,
        nameOffset,
        lastLine,
      });
      if (!span) continue;                                            // F16

      const selfInSpan = countWord(clean.slice(span.scanStart, span.scanEnd), sym.name);
      const selfInFile = countWord(keptText, sym.name);
      const cleanTotal = countWord(cleanNoImports, sym.name);

      // Positions of code mentions outside the member's own span, to decide
      // selfOnly: are they all inside the enclosing class?
      let codeOutsideSpan = 0;
      let codeInsideClass = 0;
      // KJ-076 : les POSITIONS, pas seulement leur compte. `selfOnly` declenche
      // une transformation, et il faut pouvoir dire QUEL membre porte chaque
      // mention pour savoir si ce membre est, lui, vivant.
      const codeInsideClassAt: number[] = [];
      const wordRe = new RegExp(`(?<![A-Za-z0-9_])${sym.name}(?![A-Za-z0-9_])`, 'g');
      let m: RegExpExecArray | null;
      while ((m = wordRe.exec(cleanNoImports)) !== null) {
        if (m.index >= span.scanStart && m.index < span.scanEnd) continue;
        codeOutsideSpan++;
        if (enclosing.extentStart !== -1
          && m.index > enclosing.extentStart && m.index < enclosing.extentEnd) {
          codeInsideClass++;
          codeInsideClassAt.push(m.index);
        }
      }

      candidates.push({
        sym,
        name: sym.name,
        path: src.path,
        container: chain.map(e => e.sym.name).join('.') + (companionName ? `.${companionName}` : ''),
        isJava,
        annoNames: annosAt(sym),
        optsOutUnused: silenceAt(sym) || companionSilence || chain.some(e => e.optsOutUnused),
        enclosingRejection,
        enclosingSupertyped,
        enclosingDeclTruncated,
        selfInSpan,
        selfInFile,
        codeOutsideSpan,
        codeInsideClass,
        codeInsideClassAt,
        // A string mention anywhere in the file (reflection by name, a log
        // that spells it) disqualifies selfOnly and keeps the member alive.
        stringMentions: selfInFile - cleanTotal,
        ...removalExtent(src.text, clean, lineStarts, lastLine, sym, span, sansCommentaires),
        memberOffset: nameOffset,
        // KJ-073 : remplis apres la boucle, quand tous les types sont connus.
        ancestorDecls: 0,
        boundByContract: false,
        chainVisible: false,
        homonyms: 0,
        supersDirects: chain.flatMap(e => declaresIci.get(e.sym)?.supertypes ?? []),
        portee: { paquet: parsed.packageName, imports: parsed.imports },
        // The inline-body parse path can drop flags, so the raw line is the
        // belt, exactly as KJ-026 does with its MODIFIER_GUARD_RE.
        hasOverrideModifier: /\boverride\b/.test(rawLines[sym.line] ?? ''),
        // MODIFIER position only: a Java parameter named `external`
        // (`totalSpace(final boolean external)`) is not a native method.
        hasExternalModifier: /(?:^|\s)external\s+(?:\w+\s+)*(?:fun|val|var)\b/.test(rawLines[sym.line] ?? ''),
      });
    }
  }

  // L'escompte se calcule quand tous les types sont connus : un ancetre peut
  // etre declare dans un fichier lu apres.
  // La resolution passe par les IMPORTS du fichier, pas par le nom nu : un
  // homonyme de bibliotheque ferait passer une chaine etrangere pour visible.
  for (const c of candidates) {
    const ancetres = chaineResolue(c.supersDirects, c.portee, typesByName);
    if (ancetres === null) continue;
    c.chainVisible = true;
    c.ancestorDecls = ancetres.filter(t => t.members.has(c.name)).length;
    c.boundByContract = ancetres.some(t => t.bindingMembers.has(c.name));
    c.homonyms = Math.max(0, (declNameCounts.get(c.name) ?? 1) - 1 - c.ancestorDecls);
  }

  return { candidates, declNameCounts, supertypesByName, scopeAnnotations };
}

/** Guard that takes the whole enclosing chain out of scope, or null (M4/M5). */

/** A name the mention harvest can actually look for. */
const BARE_IDENTIFIER_RE = /^[A-Za-z_]\w*$/;

/**
 * KJ-070 traverse ici.
 *
 * `BENIGN_MEMBER_ANNOTATIONS` code `Singleton` et `Reusable` en dur, avec le
 * raisonnement exact qui vaut pour toute portée : « le code généré par Dagger
 * n'appelle jamais que le CONSTRUCTEUR d'une classe à portée ; ses autres
 * membres sont appelés par du code ordinaire que le sac lit. » Le commentaire
 * ajoutait que les portées personnalisées restaient étrangères, l'ensemble
 * étant inconnaissable. Il ne l'est plus depuis que `scopeAnnotationsOf` lit
 * les annotations du workspace qui portent `@Scope`.
 *
 * Sur le projet de référence, `@ScopeApplication` et `@ScopeActivity`
 * écartaient à eux seuls 1679 membres, pour une raison que l'autre famille
 * savait déjà lever.
 */
function rejectEnclosingChain(
  chain: readonly EnclosingInfo[],
  scopeAnnotations: ReadonlySet<string>,
): string | null {
  for (const e of chain) {
    if (e.isFunInterface) return 'M5:sam-interface';
    const foreign = e.annoNames.find(
      a => !BENIGN_MEMBER_ANNOTATIONS.has(a) && !scopeAnnotations.has(a));
    if (foreign) return `M4:@${foreign}`;
  }
  return null;
}

/**
 * M3, evaluated LATE. A Java method implementing an interface has no textual
 * marker (`@Override` is optional), so any supertype at all makes every member
 * a potential unmarked implementation. Only supertype-free Java classes (utils,
 * constants) stay in scope, which is where the real dead code hides.
 *
 * Read AFTER M2/M4/M6 on purpose. Evaluated first, it swallowed their labels:
 * on the reference corpus its bucket read 56 members, of which roughly thirty
 * were `@Override` (M2) and ten `@NonNull` getters (M6). The bucket now counts
 * what M3 alone retains, which is the number this trade-off has to be judged on.
 * No finding changes either way — the guards are disjunctive.
 */
function javaInheritanceReason(c: MemberCandidate): string | null {
  if (!c.isJava) return null;
  // A declaration line that never reached its `{` may hide the very clause
  // M3 looks for, so an unread inheritance counts as inheritance.
  if (c.enclosingDeclTruncated) return 'M3:java-decl-truncated';
  if (!c.enclosingSupertyped) return null;

  // KJ-077 : M3 dit « ce membre implemente peut-etre une interface sans le
  // dire ». Quand TOUTE la chaine d ancetres est resolue ici et qu AUCUN
  // d eux ne declare ce nom, il n y a pas d implementation non marquee
  // possible : le membre est un membre ordinaire de sa classe.
  //
  // Mesure sur le projet de reference : 1238 membres en M3, 184 dont la chaine
  // est entierement visible, 170 dont aucun ancetre ne porte le nom, et deux
  // qui survivent au comptage. `CacheServiceImpl.setCacheEnabled` est `static`,
  // donc aucun supertype ne peut l appeler par polymorphisme.
  //
  // `homonyms` est la meme retenue qu en KJ-073 : une declaration du meme nom
  // ailleurs rend toute mention inattribuable, et M3 reste alors la seule
  // reponse honnete.
  if (c.chainVisible && c.ancestorDecls === 0 && c.homonyms === 0) return null;
  return 'M3:java-supertyped';
}

/**
 * Which guard, if any, takes this member out of scope. One function so the
 * detector and `--why` can never disagree.
 */
function memberRejectionReason(
  c: MemberCandidate,
  input: UnusedMemberScanInput,
  supertypesByName: ReadonlyMap<string, string[]>,
  deadByPath: ReadonlyMap<string, readonly { removeStart: number; removeEnd: number }[]>,
  scopeAnnotations: ReadonlySet<string>,
): string | null {
  const sym = c.sym;
  if (c.enclosingRejection) return c.enclosingRejection;
  if (c.optsOutUnused) return 'F12:suppress-unused';

  // M2: overrides implement a contract the framework or a caller reaches
  // through the supertype. Kotlin's keyword is reliable; Java's belt is the
  // (optional) @Override annotation, with M3 catching the unmarked rest.
  //
  // KJ-073 le rend CONDITIONNEL : le filtre ne tient que tant qu un ancetre
  // echappe au corpus. Quand toute la chaine est declaree ici, la surcharge
  // redescend dans le comptage ordinaire, et les filtres suivants (M4 cadre,
  // M6 annotation, M8 convention) continuent de la juger.
  const surcharge = sym.isOverride || c.hasOverrideModifier || c.annoNames.includes('Override');
  if (surcharge && (!c.chainVisible || c.homonyms > 0)) return 'M2:override';
  // Et la chaine visible ne suffit pas a rendre la coupe SURE : tant que le
  // contrat parent reste, retirer la surcharge seule ne compile plus. La
  // paire est la vraie trouvaille, et elle demande une coupe liee que la
  // famille ne sait pas encore porter.
  if (surcharge && c.boundByContract) return 'M11:bound-by-contract';

  // M6 AVANT M4, et l'ordre porte du sens depuis KJ-075. Les deux ecartent le
  // membre, donc aucune trouvaille ne change ici : c'est l'ETIQUETTE qui
  // compte, et la famille des ilots la lit. Elle absorbe desormais les F7,
  // qui ne sont pas des declarations prouvees vivantes ; un membre que sa
  // PROPRE annotation protege ne doit pas etre absorbe avec eux.
  //
  // Mesure : `@Inject lateinit var breakingNewsController` de
  // Un champ injecte de la classe `Application` sortait en `M4:F7:Application`
  // parce que sa classe
  // etend `Application`. Absorbe dans le bassin des ilots, ce champ que le
  // code genere de Dagger ECRIT devenait un ilot mort.
  const foreign = c.annoNames.find(
    a => !BENIGN_MEMBER_ANNOTATIONS.has(a) && !scopeAnnotations.has(a));
  if (foreign) return `M6:@${foreign}`;

  const framework = frameworkAncestor(
    supertypesFor(c, supertypesByName), supertypesByName);
  if (framework) return `M4:${framework}`;

  const inherited = javaInheritanceReason(c);
  if (inherited) return inherited;

  if (sym.isExpect || sym.isActual) return 'F4:kmp';
  // A backtick name is not an identifier, and the harvest looks for
  // identifiers: `w.\`a ghost\`()` at a call site is invisible to it. Probed
  // on a two file corpus, a CALLED backtick member came back `unreferenced`,
  // and its quick fix deletes live code.
  if (!BARE_IDENTIFIER_RE.test(c.name)) return 'M10:backtick-name';
  if (sym.isOperator) return 'M8:operator';
  if (CONVENTION_FUN_NAMES.has(c.name)) return 'M8:convention';
  if (/^component\d+$/.test(c.name)) return 'M8:destructuring';
  if (c.name === 'main' || c.name === 'serialVersionUID') return 'M8:entry-point';
  if (c.name.startsWith('_')) return 'M8:underscore';
  if (c.hasExternalModifier) return 'M9:external';

  if ((input.ignorePaths ?? []).some(p => matchesGlob(c.path, p))) return 'F13:ignored-path';
  if ((input.publishedModules ?? []).some(d => isUnder(c.path, d))) return 'F14:published';
  if ((input.ignoreNames ?? []).some(p => matchesGlob(c.name, p))) return 'F17:ignored-name';

  // M12: the class is already reported whole by KJ-032. One finding per root
  // cause; its Refactor Preview removes the members with the class.
  const dead = deadByPath.get(c.path);
  if (dead?.some(d => c.memberOffset >= d.removeStart && c.memberOffset < d.removeEnd)) {
    return 'M12:dead-class';
  }
  return null;
}

/** Une declaration de type du corpus, avec de quoi resoudre ce qu elle nomme. */
interface TypeDecl {
  name: string;
  fqn: string;
  paquet: string;
  imports: readonly string[];
  isInterface: boolean;
  supertypes: readonly string[];
  members: Set<string>;
  /**
   * Les membres dont la declaration ENGAGE : un membre d interface, ou un
   * `abstract`. Une sous classe qui retire sa surcharge d un tel membre ne
   * compile plus. Mesure : retirer `FileServiceImpl.createTempFile` seul, en
   * laissant `FileService.createTempFile(): File?`, fait echouer
   * la compilation du module qui la declare.
   *
   * Un membre d interface AVEC corps par defaut y entre aussi. Distinguer les
   * deux demanderait de lire le corps, et se tromper du mauvais cote casse le
   * build : ici, trop retenir ne coute qu une trouvaille.
   */
  bindingMembers: Set<string>;
}

/** D ou part une resolution : un fichier, avec son paquet et ses imports. */
interface Portee {
  paquet: string;
  imports: readonly string[];
}

/**
 * Le type que ce nom NU designe depuis cette portee, ou null s il est etranger
 * au corpus, ou undefined si plusieurs homonymes se disputent le nom.
 *
 * L import fait foi, et c est tout l interet. Une classe de service
 * etend `FirebaseMessagingService` de Firebase, et le corpus declare SA PROPRE
 * `interface FirebaseMessagingService`
 * sous un autre paquet. Resolue par nom
 * nu, la chaine paraissait visible, `onNewToken` et `onRegistered` cessaient
 * d etre gardees, et cinq ilots morts apparaissaient sur des rappels que
 * Firebase appelle. Les notifications push seraient parties avec.
 */
function resoudreType(
  bare: string,
  depuis: Portee,
  typesByName: ReadonlyMap<string, TypeDecl[]>,
): TypeDecl | null | undefined {
  const importe = depuis.imports.find(i => i === bare || i.endsWith(`.${bare}`));
  const candidats = typesByName.get(bare) ?? [];
  if (importe !== undefined) {
    const exact = candidats.filter(t => t.fqn === importe);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return undefined;
    // Importe d ailleurs : le corpus ne declare pas CE type la.
    return null;
  }
  const memePaquet = candidats.filter(t => t.paquet === depuis.paquet);
  if (memePaquet.length === 1) return memePaquet[0];
  if (memePaquet.length > 1) return undefined;
  if (candidats.length === 0) return null;
  if (candidats.length > 1) return undefined;
  return candidats[0];
}

/**
 * La chaine d ancetres, resolue par import, en partant de cette portee.
 *
 * Rend null des qu un maillon est etranger ou ambigu : une chaine qu on ne
 * sait pas suivre n est pas une chaine visible.
 */
function chaineResolue(
  supertypes: readonly string[],
  depuis: Portee,
  typesByName: ReadonlyMap<string, TypeDecl[]>,
): TypeDecl[] | null {
  const out: TypeDecl[] = [];
  const vus = new Set<string>();
  let frontier: { bare: string; depuis: Portee }[] =
    supertypes.map(t => t.replace(/<.*/, '').trim()).filter(Boolean).map(b => ({ bare: b, depuis }));

  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const next: { bare: string; depuis: Portee }[] = [];
    for (const { bare, depuis: portee } of frontier) {
      if (bare === 'Any' || bare === 'Object') continue;
      const decl = resoudreType(bare, portee, typesByName);
      if (decl === null || decl === undefined) return null;
      if (vus.has(decl.fqn)) continue;
      vus.add(decl.fqn);
      out.push(decl);
      for (const parent of decl.supertypes) next.push({ bare: parent, depuis: decl });
    }
    frontier = next;
  }
  // Plus profond que huit etages n est pas une chaine prouvee.
  return frontier.length === 0 ? out : null;
}

/** The supertype chain the framework walk starts from: the enclosing classes'. */
function supertypesFor(
  c: MemberCandidate,
  supertypesByName: ReadonlyMap<string, string[]>,
): string[] {
  const out: string[] = [];
  for (const part of c.container.split('.')) {
    for (const s of supertypesByName.get(part) ?? []) out.push(s);
  }
  return out;
}

/**
 * KJ-076 : au moins un temoin de `selfOnly` est porte par un membre VIVANT.
 *
 * `selfOnly` veut dire « toutes les mentions restantes sont dans la classe qui
 * declare le membre », et c est le seul verdict qui declenche une
 * TRANSFORMATION : `MakeSelfOnlyPrivate` propose de passer le membre en
 * `private`. La justesse y compte autrement que pour une suppression.
 *
 * Le detecteur ne demandait pas si ces mentions etaient, elles, vivantes. Deux
 * facons de ne pas l etre, et c est la quatrieme apparition de la meme erreur
 * de categorie apres G21, G22 et G27 :
 *
 *   - le porteur est rapporte MORT par le meme appel : le temoin part avec lui ;
 *   - le porteur est ECARTE par un filtre : personne ne l a juge, et une
 *     declaration non jugee ne prouve rien.
 *
 * Mesure approchee sur le projet de reference : 34 des 169 `selfOnly`. Aucune
 * ne devient morte ; ce qui change, c est la transformation qu on ne propose
 * plus a tort.
 *
 * Prudence assumee : une mention qu on ne sait rattacher a AUCUN membre (un
 * initialiseur de propriete, un bloc `init`) compte comme un temoin valable.
 * Ne pas savoir n autorise pas a conclure, dans un sens comme dans l autre.
 */
function temoinVivant(
  c: MemberCandidate,
  parFichier: ReadonlyMap<string, readonly MemberCandidate[]>,
  ecartes: ReadonlySet<MemberCandidate>,
  mortsProbables: ReadonlySet<MemberCandidate>,
): boolean {
  const voisins = parFichier.get(c.path) ?? [];
  for (const at of c.codeInsideClassAt) {
    const porteur = voisins.find(
      v => v !== c && v.removeStart >= 0 && at >= v.removeStart && at < v.removeEnd);
    if (porteur === undefined) return true;              // inattribuable : on ne conclut pas
    if (!ecartes.has(porteur) && !mortsProbables.has(porteur)) return true;
  }
  return false;
}

export function findUnusedMembers(input: UnusedMemberScanInput): UnusedMember[] {
  if (input.truncated) return [];                                     // contract rule 2

  const { candidates, declNameCounts, supertypesByName, scopeAnnotations } =
    collectMemberCandidates(input.sources, input.testSourceSets);
  if (candidates.length === 0) return [];

  const deadByPath = new Map<string, { removeStart: number; removeEnd: number }[]>();
  for (const d of input.deadDeclarations ?? []) {
    if (d.removeStart < 0) continue;
    const list = deadByPath.get(d.path) ?? [];
    list.push(d);
    deadByPath.set(d.path, list);
  }

  const kept = candidates.filter(c =>
    memberRejectionReason(c, input, supertypesByName, deadByPath, scopeAnnotations) === null);
  if (kept.length === 0) return [];

  const wanted = new Set<string>();
  for (const c of kept) {
    wanted.add(c.name);
    if (c.sym.kind === 'val' || c.sym.kind === 'var') {
      for (const a of accessorNames(c.name)) wanted.add(a);
    }
  }
  const harvest = harvestMentions(input.sources, wanted, input.testSourceSets);
  const bareXml = harvestBareXmlMentions(input.sources, kept);
  const bareKotlin = harvestBareKotlinMentions(input.sources, kept);
  const unmentioned = unmentionedDuplicateMembers(kept, declNameCounts, harvest);

  // KJ-076 : de quoi savoir qui porte un temoin de `selfOnly`, et ce que ce
  // porteur vaut. `mortsProbables` est calcule AVANT la boucle des verdicts
  // sur la seule regle qui ne depend pas d'elle : plus aucune mention hors de
  // sa propre declaration. C'est exactement ce que la boucle appellera
  // `unreferenced` ou `testOnly`.
  const gardes = new Set(kept);
  const ecartes = new Set(candidates.filter(c => !gardes.has(c)));
  const parFichier = new Map<string, MemberCandidate[]>();
  for (const c of candidates) {
    const l = parFichier.get(c.path) ?? [];
    l.push(c);
    parFichier.set(c.path, l);
  }
  const mortsProbables = new Set<MemberCandidate>();
  for (const c of kept) {
    if (harvest.aliased.has(c.name)) continue;
    const dehors = unmentioned.has(c.name)
      ? 0 : mentionsOf(harvest.main, c, bareXml, bareKotlin) - c.selfInFile - c.ancestorDecls;
    const dedans = unmentioned.has(c.name) ? 0 : c.selfInFile - c.selfInSpan;
    if (dehors === 0 && dedans <= 0) mortsProbables.add(c);
  }

  const out: UnusedMember[] = [];
  for (const c of kept) {
    if (harvest.aliased.has(c.name)) continue;                        // H10

    const mainMentions = mentionsOf(harvest.main, c, bareXml, bareKotlin);
      // `ancestorDecls` : la declaration parente d'une surcharge n'est pas un
    // appel. Sans elle, toute surcharge d'un contrat visible se prouve vivante
    // par sa propre declaration d'interface.
    const mainElsewhere = unmentioned.has(c.name) ? 0
      : mainMentions - c.selfInFile - c.ancestorDecls;
    if (mainElsewhere !== 0) continue;

    let verdict: UnusedMemberVerdict;
    // A twin declared in the same file is not a use: the group check already
    // proved the corpus names this symbol only where it is declared.
    const residual = unmentioned.has(c.name) ? 0 : c.selfInFile - c.selfInSpan;
    if (residual > 0) {
      // Used elsewhere in its own file. selfOnly only when every residual code
      // mention sits inside the enclosing class AND none hides in a string
      // (a `getMethod("x")` next door is reflection, not over-exposure).
      // A test that names the member is a use `private` would break, and the
      // compiler only says so when the test sources are built, which an
      // `assembleDebug` never does. Measured on a real project: sixteen
      // members went private and `:core:utils` and `:variant:consent` stopped
      // compiling their tests with
      //   Cannot access 'val EMAIL_FORBIDDEN_CHARS': it is private in ...
      const usedByTests = mentionsOf(harvest.test, c) > 0;
      const selfOnly = c.stringMentions === 0
        && !usedByTests
        && c.codeOutsideSpan > 0
        && c.codeOutsideSpan === c.codeInsideClass
        && temoinVivant(c, parFichier, ecartes, mortsProbables);
      if (!selfOnly) continue;
      if (input.includeSelfOnly === false) continue;
      verdict = 'selfOnly';
    } else {
      const testMentions = mentionsOf(harvest.test, c);
      verdict = testMentions > 0 ? 'testOnly' : 'unreferenced';
      if (verdict === 'testOnly' && input.includeTestOnly === false) continue;
    }

    out.push({
      name: c.name,
      kind: c.sym.kind,
      container: c.container,
      verdict,
      path: c.path,
      line: c.sym.line,
      character: c.sym.character,
      removeStart: c.removeStart,
      removeEnd: c.removeEnd,
      testMentions: verdict === 'testOnly' ? mentionsOf(harvest.test, c) : 0,
      isDeprecated: c.sym.isDeprecated === true,
    });
  }

  return out.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

/**
 * H9 reversed: a member FUN named `getX`/`setX` is reachable as property `x`
 * from data binding. That access lives in XML ONLY: Kotlin or Java code
 * calling the function always spells `getX`, so a bare `x` in a .kt or .java
 * file is a variable, never a call. Counting code-side bare mentions silenced
 * a real finding (a deprecated getter whose bare name matched an unrelated
 * local elsewhere), so the bare form is checked against XML sources alone.
 */
function bareAccessorTarget(c: MemberCandidate): string | undefined {
  if (c.sym.kind !== 'fun') return undefined;
  const m = /^(?:get|set)([A-Z]\w*)$/.exec(c.name);
  if (!m) return undefined;
  return m[1][0].toLowerCase() + m[1].slice(1);
}

/**
 * Every bare name a KOTLIN call site can use to reach this member.
 *
 * A Java `isX()`/`setX()` pair becomes one Kotlin property named `isX`, not
 * `x`, so the setter is written `f.isX = v` and never `f.x = v`. Counting only
 * `x` reported `setBar` as unreferenced on a file whose sole write was
 * `f.isBar = true`.
 *
 * The `isX` key is added for every Java `setX` without checking that its class
 * really declares `isX()`: the candidate list holds no siblings to check
 * against, and an extra key can only silence a finding, never invent one.
 */
function bareKotlinTargets(c: MemberCandidate): string[] {
  if (c.sym.kind !== 'fun') return [];
  const m = /^(get|set)([A-Z]\w*)$/.exec(c.name);
  if (!m) return [];
  const property = m[2][0].toLowerCase() + m[2].slice(1);
  return m[1] === 'set' ? [property, `is${m[2]}`] : [property];
}

function mentionsOf(
  bag: Map<string, number>,
  c: MemberCandidate,
  bareXml?: ReadonlyMap<string, number>,
  bareKotlin?: ReadonlyMap<string, number>,
): number {
  let n = bag.get(c.name) ?? 0;
  if (c.sym.kind === 'val' || c.sym.kind === 'var') {
    for (const a of accessorNames(c.name)) n += bag.get(a) ?? 0;      // H9
  }
  const bare = bareAccessorTarget(c);
  if (bare && bareXml) n += bareXml.get(bare) ?? 0;                   // H9 reversed, XML only
  if (bareKotlin && c.isJava) {                                       // H9 reversed, Kotlin
    for (const target of bareKotlinTargets(c)) n += bareKotlin.get(target) ?? 0;
  }
  return n;
}

/** Bare accessor names counted over the XML sources alone (H9 reversed). */
function harvestBareXmlMentions(
  sources: readonly SymbolSource[],
  candidates: readonly MemberCandidate[],
): Map<string, number> {
  const wanted = new Set<string>();
  for (const c of candidates) {
    const bare = bareAccessorTarget(c);
    if (bare) wanted.add(bare);
  }
  if (wanted.size === 0) return new Map();
  const xml = sources.filter(s => s.path.endsWith('.xml'));
  return harvestMentions(xml, wanted, []).main;
}

/**
 * H9 reversed, second half. The XML-only restriction above holds for a KOTLIN
 * getter: Kotlin and Java callers both spell `getX`, and a bare `x` elsewhere
 * is an unrelated variable — that is the regression it was written for.
 *
 * It does NOT hold for a JAVA getter. Kotlin synthesises a property from it,
 * so `metadata.includedProjects` is the ONLY way to spell
 * `getIncludedProjects()` at a Kotlin call site. Found on test/kotlin-lsp-main:
 * IdeaProjectMapper.kt:39 reads ProjectMetadata.java:30 that way. Without this
 * every Java getter read as a property from Kotlin is a false positive, and
 * M3 is the only thing that has been hiding it — on classes with a supertype.
 */
function harvestBareKotlinMentions(
  sources: readonly SymbolSource[],
  candidates: readonly MemberCandidate[],
): Map<string, number> {
  const wanted = new Set<string>();
  for (const c of candidates) {
    if (!c.isJava) continue;                       // Kotlin keeps the XML-only rule
    for (const target of bareKotlinTargets(c)) wanted.add(target);
  }
  if (wanted.size === 0) return new Map();         // a Kotlin-only workspace pays nothing
  const kt = sources.filter(s => s.path.endsWith('.kt') || s.path.endsWith('.kts'));
  return harvestMentions(kt, wanted, []).main;
}

/**
 * KJ-036 generalised to members: duplicated names the corpus mentions ONLY at
 * their declaration sites. The completeness condition uses the GLOBAL
 * declaration count (all kinds, all depths, both parsers): one override, one
 * local or one top-level homonym outside the group makes it incomplete, and
 * the rule stays silent. That is automatic, not a special case.
 */
function unmentionedDuplicateMembers(
  candidates: readonly MemberCandidate[],
  declNameCounts: ReadonlyMap<string, number>,
  harvest: Harvest,
): Set<string> {
  const byName = new Map<string, MemberCandidate[]>();
  for (const c of candidates) {
    if ((declNameCounts.get(c.name) ?? 0) <= 1) continue;
    const list = byName.get(c.name) ?? [];
    list.push(c);
    byName.set(c.name, list);
  }

  const out = new Set<string>();
  for (const [name, group] of byName) {
    if (group.length !== declNameCounts.get(name)) continue;
    if (harvest.aliased.has(name)) continue;
    // M13: a second mention of the name inside a member's OWN span is a call
    // to another bearer (or self-recursion). Found live on a real workspace:
    // a ViewModel's `exportReport` delegating to a logger's `exportReport()`
    // inside its body, and subtracting it as "self" reported the CALLED one.
    if (group.some(c => c.selfInSpan !== 1)) continue;

    let mentions = harvest.main.get(name) ?? 0;
    if (group.some(c => c.sym.kind === 'val' || c.sym.kind === 'var')) {
      for (const a of accessorNames(name)) mentions += harvest.main.get(a) ?? 0;
    }
    // Count each FILE once: two bearers of the name declared in the same file
    // each see the other's name token in their own `selfInFile`, so summing
    // per candidate counted that file twice and the group read as mentioned.
    // Two dead overloads in one class were therefore never reported, while
    // the same two split across files were. Same fix as the top level rule.
    const byFile = new Map<string, MemberCandidate[]>();
    for (const c of group) {
      const inFile = byFile.get(c.path) ?? [];
      inFile.push(c);
      byFile.set(c.path, inFile);
    }
    let self = 0;
    let outsideOwnSpan = 0;
    for (const inFile of byFile.values()) {
      const fileMentions = inFile[0].selfInFile;
      const owned = inFile.reduce((n, c) => n + c.selfInSpan, 0);
      self += fileMentions;
      outsideOwnSpan += fileMentions - owned;
    }
    if (mentions - self === 0 && outsideOwnSpan === 0) out.add(name);
  }
  return out;
}

export function explainMembers(input: UnusedMemberScanInput): MemberExplanation[] {
  const { candidates, declNameCounts, supertypesByName, scopeAnnotations } =
    collectMemberCandidates(input.sources, input.testSourceSets);

  const deadByPath = new Map<string, { removeStart: number; removeEnd: number }[]>();
  for (const d of input.deadDeclarations ?? []) {
    if (d.removeStart < 0) continue;
    const list = deadByPath.get(d.path) ?? [];
    list.push(d);
    deadByPath.set(d.path, list);
  }

  const wanted = new Set<string>();
  for (const c of candidates) {
    wanted.add(c.name);
    if (c.sym.kind === 'val' || c.sym.kind === 'var') {
      for (const a of accessorNames(c.name)) wanted.add(a);
    }
  }
  const harvest = harvestMentions(input.sources, wanted, input.testSourceSets);
  const bareXml = harvestBareXmlMentions(input.sources, candidates);
  const bareKotlin = harvestBareKotlinMentions(input.sources, candidates);
  const unmentioned = unmentionedDuplicateMembers(
    candidates.filter(c =>
      memberRejectionReason(c, input, supertypesByName, deadByPath, scopeAnnotations) === null),
    declNameCounts, harvest);

  return candidates.map(c => {
    const rejected = memberRejectionReason(c, input, supertypesByName, deadByPath, scopeAnnotations);
    let outcome: string;
    if (rejected) outcome = rejected;
    else if (harvest.aliased.has(c.name)) outcome = 'H10:aliased-import';
    else if (!unmentioned.has(c.name)
             && mentionsOf(harvest.main, c, bareXml, bareKotlin)
                - c.selfInFile - c.ancestorDecls !== 0) {
      outcome = 'alive:main';
    } else if (!unmentioned.has(c.name) && c.selfInFile - c.selfInSpan > 0) {
      const selfOnly = c.stringMentions === 0 && c.codeOutsideSpan > 0
        && c.codeOutsideSpan === c.codeInsideClass;
      outcome = selfOnly ? 'selfOnly' : 'alive:same-file';
    } else {
      outcome = mentionsOf(harvest.test, c) > 0 ? 'testOnly' : 'unreferenced';
    }
    return { name: c.name, container: c.container, path: c.path, line: c.sym.line, outcome };
  });
}

const KIND_LABEL: Record<string, string> = {
  fun: 'Method', composable: 'Composable', val: 'Property', var: 'Property',
};

export function messageFor(m: UnusedMember): string {
  const label = KIND_LABEL[m.kind] ?? 'Member';
  switch (m.verdict) {
    case 'testOnly':
      return `${label} '${m.container}.${m.name}' is used only from tests (${m.testMentions} reference${m.testMentions > 1 ? 's' : ''})`;
    case 'selfOnly':
      return `${label} '${m.container}.${m.name}' is only used inside its own class and could be private`;
    default:
      return `${label} '${m.container}.${m.name}' is never referenced anywhere in this workspace`;
  }
}

export function deleteTitleFor(m: UnusedMember): string {
  return `Delete unreferenced member ${m.name}`;
}

export function makePrivateTitleFor(m: UnusedMember): string {
  return `Make ${m.name} private`;
}
