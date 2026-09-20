import { parse } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import {
  buildLineStarts,
  collectAnnotationTargets,
  depthZeroColon,
  findMatchingParen,
  matchBrace,
  offsetToPos,
  sanitizeForUsageScan,
  splitParamSegments,
} from '../util/kotlinScan';
import { COMMENCE_UNE_SUITE_RE } from './unusedSymbols';
import { isTestSourceSet } from '../util/testPaths';
import { isBuildArtifactPath } from '../util/resourceAllowlists';

/**
 * KJ-038: events posted on a bus that nothing subscribes to.
 *
 * Unlike the rest of the family this does not report dead weight, it reports a
 * MISSING BEHAVIOUR: someone wrote the trigger and the receiver went away. That
 * changes the stakes. Deleting an unreferenced class is caught by the compiler;
 * deleting a `post` is caught by nobody, and shows up at runtime on a user's
 * device. So this detector is held to a higher bar than KJ-032, not an equal
 * one, and the two places that shows are stated where they apply.
 *
 * ## The one rule that decides correctness
 *
 * Claiming "nobody listens to X" is a claim about the SET of subscriptions. A
 * bus is a global dispatcher: a `@Subscribe` in any file hears a `post` from
 * any other, so there is no locality to exploit. A subscription we cannot read
 * is therefore a hole in the proof, not a detail:
 *
 *   ANY subscription whose event type we cannot extract poisons the WHOLE
 *   scan. Zero findings, and the unreadable subscription is reported instead.
 *
 * Counting it as some arbitrary type invents a fact. Not counting it
 * manufactures a false positive. Silence is the only honest option, and it has
 * to be VISIBLE, which is why `unreadable` is part of the result rather than a
 * silent early return.
 *
 * The symmetric half matters just as much: an unresolved POST poisons nothing.
 * Posts only ever create candidates, so dropping one can only lose a finding.
 * On a real 6410 file workspace ~30 posts go through a variable or a factory;
 * treating those as holes in the proof would ship zero findings forever.
 *
 *   What touches the subscription set poisons globally.
 *   What touches the post set drops locally.
 *
 * ## Why nothing here hardcodes a bus library
 *
 * The bus receivers are LEARNED from `.register(` / `.unregister(` call sites,
 * so Otto, greenrobot EventBus and a house-built bus all work, and
 * `handler.post(…)` never does, because nobody writes `handler.register(this)`.
 */

export interface EventSource {
  path: string;
  text: string;
}

export interface UnheardEventScanInput {
  sources: readonly EventSource[];
  testSourceSets: readonly string[];
  /** An incomplete corpus cannot prove absence, so it produces nothing. */
  truncated?: boolean;
  /** Event type names never reported, by simple name. */
  ignoreNames?: readonly string[];
  /**
   * Types the user declares subscribed. The escape hatch for an unreadable
   * subscription: the claim becomes theirs rather than ours.
   */
  assumeSubscribed?: readonly string[];
}

export type UnheardVerdict = 'unheard' | 'testOnlySubscriber' | 'heardOnlyBySubtype';

export interface UnheardEvent {
  /** Simple name, what the message shows. */
  name: string;
  /** Fully qualified name, what the subtraction actually reasoned about. */
  fqn: string;
  verdict: UnheardVerdict;
  path: string;
  /** 0-based position of the `post` token. */
  line: number;
  character: number;
  /** Whole-statement extent, or -1 when removing it is not obviously safe. */
  removeStart: number;
  removeEnd: number;
  /**
   * Why the fix gave up, present exactly when `removeStart` is -1 AND no
   * rewrite is offered. A review of the refused posts shows it on the label,
   * so a human can weigh what the detector would not.
   */
  withheld?: string;
  /**
   * KJ-069: the post was the sole content of a `finally` whose `try` has no
   * catch, so the cut is a REPLACEMENT, not a deletion: `try { A } finally {
   * post }` becomes `A`, de indented one level. Deleting the range would take
   * the try body with it, so these travel in their own fields and
   * `removeStart` stays -1: a consumer that only knows how to delete does
   * nothing rather than something wrong.
   */
  rewriteStart?: number;
  rewriteEnd?: number;
  rewriteText?: string;
}

/** A subscription whose event type we could not read. */
export interface UnreadableSubscription {
  path: string;
  line: number;
  character: number;
}

export interface UnheardEventScan {
  events: UnheardEvent[];
  /**
   * Non-empty means the scan proved NOTHING and `events` is empty. Callers
   * must surface this: a silent zero would read as "all clear".
   */
  unreadable: UnreadableSubscription[];
  /**
   * Direction 2: subscriptions whose event type nothing ever posts. Empty
   * whenever `unboundedPosts` is not, for the mirror of the direction-1 rule:
   * here the POSTS are the proof, so a post whose delivered type cannot be
   * bounded means no subscription can be proven starved.
   */
  deadSubscriptions: DeadSubscription[];
  /** Post sites whose delivered type could not be bounded to corpus types. */
  unboundedPosts: { path: string; line: number }[];
}

export type DeadSubscriptionVerdict = 'neverPosted' | 'testOnlyPoster';

export interface DeadSubscription {
  /** Simple name of the subscribed event type. */
  name: string;
  fqn: string;
  verdict: DeadSubscriptionVerdict;
  path: string;
  /** 0-based position of the handler's name token. */
  line: number;
  character: number;
  /** Whole handler extent (annotation included), or -1 when not delimitable. */
  removeStart: number;
  removeEnd: number;
}

/** One line per raw post site, saying what happened to it. For `--why`. */
export interface PostExplanation {
  path: string;
  line: number;
  /** Head of the posted argument as written, or the receiver when unresolved. */
  ref: string;
  /** Guard id that dropped it, or the verdict when it survived. */
  outcome: string;
}

const IGNORE_MARKER = 'kotlin-jump:ignore unheard-event';
const UNBOUNDED_IGNORE_MARKER = 'kotlin-jump:ignore unbounded-post';

/**
 * Supertypes that end an ancestor walk. Anything else that leaves the corpus
 * means we cannot see the whole chain, so a subscription on something further
 * up would be invisible to us (H1).
 */
const TERMINAL_SUPERTYPES = new Set([
  'Any', 'Object', 'Serializable', 'Parcelable', 'Cloneable', 'Comparable',
]);

/** Types a scheduler runs; posting one is thread dispatch, not an event (P5). */
const SCHEDULED_SUPERTYPES = new Set([
  'Runnable', 'Thread', 'TimerTask', 'Callable', 'Future', 'Message',
]);

/**
 * Subscribing to these hears everything, so no event could ever be proven
 * unheard. greenrobot allows `@Subscribe fun onEvent(e: Any)` (C6).
 */
const UNIVERSAL_EVENT_TYPES = new Set(['Any', 'Object']);

/** The cheap gate. A file not naming one of these cannot contribute (phase 0). */
function couldMentionBus(text: string): boolean {
  return text.includes('@Subscribe')
    || text.includes('.post(')
    || text.includes('.register(')
    || text.includes('.unregister(')
    || text.includes('postSticky(')
    || text.includes('StickyEvent(');
}

/**
 * `postDelayed`, `postValue`, `postAtTime` and `postInvalidate` all put a
 * letter where this wants `(`, so they never match. `view.post { }` has no
 * paren either. Three guards for free.
 */
const POST_CALL_RE = /\.\s*post(?:Sticky)?\s*\(/g;

const REGISTER_CALL_RE = /\.\s*(?:un)?register\s*\(/g;

/** `fun name(` in Kotlin, allowing modifiers and a backticked name. */
const KOTLIN_FUN_RE =
  /^\s*(?:(?:public|private|protected|internal|open|override|suspend|final|inline|external)\s+)*fun\s+(?:`[^`]+`|\w+)\s*\(/;

/** `void name(` / `Type name(` in Java, allowing modifiers and generics. */
const JAVA_METHOD_RE =
  /^\s*(?:(?:public|protected|private|final|static|synchronized|abstract|native|default)\s+)*(?:<[^>]*>\s*)?[\w.$<>[\]]+\s+\w+\s*\(/;

interface TypeNode {
  fqn: string;
  simple: string;
  /** Supertypes as written at the declaration, unresolved. */
  superRefs: string[];
  /** Declaring file, so a method lookup can be scoped to it. */
  path: string;
}

interface FileFacts {
  path: string;
  packageName: string;
  imports: string[];
}

interface TypeTable {
  byFqn: Map<string, TypeNode>;
  bySimple: Map<string, string[]>;
  /** Trailing qualified paths (`ScreenEvents.ScreenOpenedEvent`) to fqns. */
  bySuffix: Map<string, string[]>;
  factsByPath: Map<string, FileFacts>;
}

interface PostSite {
  path: string;
  line: number;
  character: number;
  /** Head of the posted argument, as written. */
  ref: string;
  receiver: string;
  /** Offsets of the whole statement, -1 when not obviously safe to remove. */
  removeStart: number;
  removeEnd: number;
  /** Why the extent is -1, when it is. */
  withheld?: string;
  /**
   * The `{` opening the if/else branch this post is the whole content of.
   * The branch rules need the verdicts of the sibling branches' posts, so
   * they run once those are known rather than here.
   */
  branchOpen?: number;
  /**
   * The `{` opening the `finally` this post is the whole content of. Settled
   * in the same second pass, for the same reason: the tests may name the
   * event, and that verdict is not known here.
   */
  finallyOpen?: number;
  isTest: boolean;
}

/**
 * Walks back from a `.` to the start of the receiver expression, crossing
 * newlines and matched parens.
 *
 * `EventBus\n    .getDefault()\n    .post(…)` is a real shape in the wild,
 * and reading a single line would lose the receiver, which then fails P1 and
 * silently drops a true finding.
 */
export function receiverBefore(clean: string, dotIdx: number): string {
  const { start, end } = receiverSpan(clean, dotIdx);
  return clean.slice(start, end).replace(/\s+/g, '');
}

/** Offsets of the receiver expression before the `.` at `dotIdx`. */
function receiverSpan(clean: string, dotIdx: number): { start: number; end: number } {
  let i = dotIdx - 1;
  const skipSpace = () => { while (i >= 0 && /\s/.test(clean[i])) i--; };

  skipSpace();
  const end = i + 1;

  for (;;) {
    if (i < 0) break;
    const ch = clean[i];
    if (ch === ')' || ch === ']') {
      const open = ch === ')' ? '(' : '[';
      let depth = 0;
      while (i >= 0) {
        if (clean[i] === ch) depth++;
        else if (clean[i] === open) { depth--; if (depth === 0) break; }
        i--;
      }
      i--;
      skipSpace();
      continue;
    }
    if (/[\w$]/.test(ch)) {
      while (i >= 0 && /[\w$]/.test(clean[i])) i--;
      skipSpace();
      if (i >= 0 && clean[i] === '.') { i--; skipSpace(); continue; }
      break;
    }
    break;
  }

  // The walk stops on the character BEFORE the receiver, blanks included.
  let start = i + 1;
  while (start < end && /\s/.test(clean[start])) start++;
  return { start, end };
}

/**
 * A receiver shape a bus plausibly has: a name, a dotted path, and no-argument
 * calls along it. `bus`, `eventBus` and `EventBus.getDefault()` pass;
 * `clickStream.throttleFirst(A, B).observeOn(C)` does not.
 *
 * Real workspaces call `.register(` on plenty of things that are not buses:
 * `IdlingRegistry.getInstance()`, RxJava chains, listener registries. Learning
 * those as buses would let their `.post(` sites through P1.
 */
const PLAUSIBLE_RECEIVER_RE = /^[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*(?:\(\))?)*$/;

/**
 * Learns which expressions are buses, from every register call site (phase 1).
 *
 * Nothing here is hardcoded, so Otto, greenrobot and a house-built bus all
 * work, and `handler.post(…)` never does because nobody writes
 * `handler.register(this)`.
 *
 * A bus both registers AND posts, so `postReceivers` intersects the learned set
 * down to expressions that do both. Without it a listener registry that never
 * posts stays in the set forever, waiting to admit an unrelated `.post(`.
 */
export function learnBusReceivers(
  sanitized: readonly { path: string; clean: string }[],
): Set<string> {
  const registered = new Set<string>();
  const posted = new Set<string>();

  const harvest = (clean: string, re: RegExp, into: Set<string>) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) {
      const recv = receiverBefore(clean, m.index).replace(/^this\./, '');
      if (recv && PLAUSIBLE_RECEIVER_RE.test(recv)) into.add(recv);
    }
  };

  for (const { clean } of sanitized) {
    harvest(clean, REGISTER_CALL_RE, registered);
    harvest(clean, POST_CALL_RE, posted);
  }

  const confirmed = new Set([...registered].filter(r => posted.has(r)));

  // `private final Bus bus; … bus = EventBus.getDefault();` then
  // `bus.post(…)`: the alias registers nothing, so the intersection above
  // never sees it. Measured on a real workspace: 34 post sites reached this
  // way. Only an alias assigned FROM an already-confirmed bus is learned, so
  // this cannot widen the set to something that is not one.
  const aliases = new Set<string>();
  for (const recv of confirmed) {
    const assignment = new RegExp(
      `(?:^|[^\\w.])([A-Za-z_]\\w*)\\s*=\\s*${recv.replace(/[.()]/g, '\\$&')}`, 'g');
    for (const { clean } of sanitized) {
      assignment.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = assignment.exec(clean)) !== null) aliases.add(m[1]);
    }
  }

  return new Set([...confirmed, ...aliases]);
}

/**
 * A file that declares both a `post` and a `register` member, or declares the
 * subscription annotation itself, IS the bus. Otto's own `Bus.java` posts a
 * `new DeadEvent(this, event)`, which would otherwise read as an orphan (P6).
 *
 * Detected structurally so a vendored copy under any path is covered.
 */
function isBusImplementation(text: string): boolean {
  const declaresAnnotation = /(?:annotation\s+class|@interface)\s+Subscribe\b/.test(text);
  const declaresPost = /\b(?:fun|void|public\s+void)\s+post\s*\(/.test(text);
  const declaresRegister = /\b(?:fun|void|public\s+void)\s+register\s*\(/.test(text);
  return declaresAnnotation || (declaresPost && declaresRegister);
}

/**
 * Builds the type graph. Inheritance edges come ONLY from `supertypes`, and
 * qualified names ONLY from the nesting stack, which is what keeps the two
 * apart: `object ScreenEvents { class ScreenOpenedEvent }` yields no edge at all,
 * because `extractSupertypes` reads only after a depth-0 `:` on the
 * declaration line. Trying to tell containers from hierarchies with a textual
 * rule would break Java (no parens ever) and Kotlin interfaces.
 */
export function buildTypeTable(sources: readonly EventSource[]): TypeTable {
  const table: TypeTable = {
    byFqn: new Map(),
    bySimple: new Map(),
    bySuffix: new Map(),
    factsByPath: new Map(),
  };

  // An alias target is a source reference, so it can only be resolved once
  // every declaration is known. Collected here, applied in a second pass.
  const pendingAliases: { simple: string; fqn: string; target: string; path: string }[] = [];

  for (const src of sources) {
    const isJava = src.path.endsWith('.java');
    if (!isJava && !src.path.endsWith('.kt')) continue;
    if (isBuildArtifactPath(src.path)) continue;

    const parsed = isJava ? parseJava(src.path, src.text) : parse(src.path, src.text);
    table.factsByPath.set(src.path, {
      path: src.path,
      packageName: parsed.packageName ?? '',
      imports: parsed.imports ?? [],
    });

    // Rebuild the nesting stack from `depth`, in declaration order.
    const stack: string[] = [];
    const stackKinds: string[] = [];
    for (const sym of parsed.symbols) {
      if (sym.kind === 'fun' || sym.kind === 'composable'
        || sym.kind === 'val' || sym.kind === 'var') continue;
      stack.length = sym.depth;
      stackKinds.length = sym.depth;
      stack[sym.depth] = sym.name;
      stackKinds[sym.depth] = sym.kind;

      const pkg = parsed.packageName ? `${parsed.packageName}.` : '';
      const nested = stack.slice(0, sym.depth + 1).join('.');
      const fqn = pkg + nested;

      if (sym.kind === 'typealias') {
        // The parser reports an alias target in its own field, not as a supertype.
        const target = (sym as { aliasTarget?: string }).aliasTarget;
        if (target) pendingAliases.push({ simple: sym.name, fqn, target: bareName(target), path: src.path });
        continue;
      }

      const superRefs = (sym.supertypes ?? []).map(bareName).filter(Boolean);
      // An enum ENTRY is an instance of its enum, and the parser gives it no
      // supertype of its own. Without this edge, `post(Mode.ALLOW)` would not
      // be heard by `@Subscribe fun on(e: Mode)`, which is a false positive on
      // a shape that appears 15 times on one real workspace.
      if (sym.kind === 'enum' && sym.depth > 0 && stackKinds[sym.depth - 1] === 'enum') {
        superRefs.push(stack[sym.depth - 1]);
      }
      const node: TypeNode = { fqn, simple: sym.name, superRefs, path: src.path };
      // Build variants declare the same fqn twice; union the supertypes, since
      // more ancestors can only make the type easier to hear (H5).
      const existing = table.byFqn.get(fqn);
      if (existing) {
        for (const s of node.superRefs) {
          if (!existing.superRefs.includes(s)) existing.superRefs.push(s);
        }
      } else {
        table.byFqn.set(fqn, node);
      }

      index(table.bySimple, sym.name, fqn);
      // Every trailing path, so `ScreenEvents.ScreenOpenedEvent` resolves too.
      const parts = nested.split('.');
      for (let i = 1; i < parts.length; i++) {
        index(table.bySuffix, parts.slice(i).join('.'), fqn);
      }
      if (parts.length > 1) index(table.bySuffix, nested, fqn);
    }
  }

  // H2: an alias resolves to whatever its target resolves to, so a
  // `@Subscribe fun on(e: PageOpened)` and a `post(ScreenEvents.Opened())` land
  // on the same fqn. Without this the pair reads as a guaranteed false orphan.
  for (const alias of pendingAliases) {
    for (const target of resolveRef(table, alias.path, alias.target)) {
      index(table.bySimple, alias.simple, target);
      index(table.bySuffix, alias.simple, target);
      index(table.bySuffix, alias.fqn, target);
    }
  }

  return table;
}

function index(map: Map<string, string[]>, key: string, fqn: string): void {
  const list = map.get(key) ?? [];
  if (!list.includes(fqn)) list.push(fqn);
  map.set(key, list);
}

/** Drops generics and nullability so `Foo<Bar>?` reads as `Foo`. */
function bareName(ref: string): string {
  return ref.replace(/<.*/s, '').replace(/[?\s]/g, '').trim();
}

/**
 * Resolves a reference as written into the types it could name.
 *
 * The asymmetry between the two callers is the guard against homonyms: a POST
 * resolving to more than one type is dropped (P8), while a SUBSCRIPTION
 * resolving to more than one counts for all of them. Both directions lose
 * recall; neither can invent a finding. This is the exact bug that makes
 * another tool confuse two same-named event classes from two packages.
 */
export function resolveRef(table: TypeTable, path: string, ref: string): string[] {
  const facts = table.factsByPath.get(path);
  const head = ref.split('.')[0];

  if (facts) {
    for (const imp of facts.imports) {
      if (imp.endsWith('.*')) continue;
      const last = imp.split('.').pop();
      if (last === head) {
        const rest = ref.slice(head.length);
        const candidate = imp + rest;
        if (table.byFqn.has(candidate)) return [candidate];
      }
      if (imp.endsWith(`.${ref}`) && table.byFqn.has(imp)) return [imp];
    }
    if (facts.packageName) {
      const samePackage = `${facts.packageName}.${ref}`;
      if (table.byFqn.has(samePackage)) return [samePackage];
    }
    for (const imp of facts.imports) {
      if (!imp.endsWith('.*')) continue;
      const candidate = `${imp.slice(0, -2)}.${ref}`;
      if (table.byFqn.has(candidate)) return [candidate];
    }
  }

  if (table.byFqn.has(ref)) return [ref];
  const bySuffix = table.bySuffix.get(ref);
  if (bySuffix) return [...bySuffix];
  const bySimple = table.bySimple.get(ref);
  if (bySimple) return [...bySimple];

  // `post(Mode.ALLOW)` posts an instance of the ENUM, and `post(Thing.INSTANCE)`
  // is how Java names a Kotlin `object`. Neither last segment is a type, so the
  // lookups above all miss and the site is dropped: 16 real post sites lost
  // this way on one workspace.
  //
  // Only a SCREAMING_CASE segment or the literal `INSTANCE` triggers this.
  // Falling back on any trailing segment would resolve `Container.Nested` to
  // its container when the nested class is simply unknown, and a container is
  // not a supertype of what it holds.
  const lastDot = ref.lastIndexOf('.');
  if (lastDot > 0) {
    const last = ref.slice(lastDot + 1);
    if (last === 'INSTANCE' || /^[A-Z][A-Z0-9_]*$/.test(last)) {
      return resolveRef(table, path, ref.slice(0, lastDot));
    }
  }
  return [];
}

/**
 * Every type a post of `fqn` would be delivered to: itself plus its transitive
 * supertypes. Otto flattens the hierarchy including interfaces, and
 * `extractJavaSupertypes` already returns `extends` and `implements` in one
 * flat list, which is exactly that semantics.
 *
 * Same shape as `frameworkAncestor` in unusedSymbols: bounded frontier walk
 * with a seen set, so a cycle produced by a regex misparse cannot hang.
 * Returns null when the chain leaves the corpus (H1): we cannot then rule out
 * a subscription further up that we never read.
 */
export function ancestorClosure(table: TypeTable, fqn: string): Set<string> | null {
  const seen = new Set<string>([fqn]);
  let frontier = [fqn];

  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const current of frontier) {
      const node = table.byFqn.get(current);
      if (!node) continue;
      for (const ref of node.superRefs) {
        if (TERMINAL_SUPERTYPES.has(ref)) continue;
        const targets = resolveRefLoose(table, ref);
        if (targets.length === 0) return null;  // H1: the chain left the corpus
        for (const t of targets) {
          if (!seen.has(t)) { seen.add(t); next.push(t); }
        }
      }
    }
    frontier = next;
  }
  return seen;
}

/** Supertype resolution has no declaring file to lean on, so name only. */
function resolveRefLoose(table: TypeTable, ref: string): string[] {
  if (table.byFqn.has(ref)) return [ref];
  return [...(table.bySuffix.get(ref) ?? table.bySimple.get(ref) ?? [])];
}

interface SubscriptionSite {
  path: string;
  line: number;
  character: number;
  /** The type as written at the parameter. */
  ref: string;
  resolved: string[];
  isTest: boolean;
  removeStart: number;
  removeEnd: number;
}

interface SubscriptionScan {
  /** fqns subscribed from production code. */
  main: Set<string>;
  /** fqns subscribed only from a test source set. */
  test: Set<string>;
  unreadable: UnreadableSubscription[];
  /** True when at least one readable `@Subscribe` exists anywhere (C2). */
  anySubscription: boolean;
  /** A subscription on `Any`/`Object` hears everything (C6). */
  universal: boolean;
  /** Every readable subscription, for direction 2. */
  sites: SubscriptionSite[];
}

/**
 * Reads every `@Subscribe` and the event type of its single parameter.
 *
 * `collectAnnotationTargets` reports the offset of the code the annotation
 * applies to regardless of newlines, so `@Subscribe\n  fun on(…)` and
 * `@Subscribe fun on(…)` are the same case here. Another tool requires a
 * newline and therefore misses every inline subscription, which turns real
 * listeners into fabricated orphans. Getting this for free is the single
 * biggest correctness win available.
 */
export function collectSubscriptions(
  files: readonly { path: string; clean: string; raw: string; isTest: boolean }[],
  table: TypeTable,
): SubscriptionScan {
  const out: SubscriptionScan = {
    main: new Set(), test: new Set(), unreadable: [], anySubscription: false, universal: false,
    sites: [],
  };

  for (const file of files) {
    const isJava = file.path.endsWith('.java');
    let lineStarts: number[] | undefined;
    const posOf = (offset: number) => {
      lineStarts ??= buildLineStarts(file.clean);
      return offsetToPos(lineStarts, offset);
    };

    // `getStickyEvent(SessionEvent::class.java)` reads a `postSticky` back
    // without any @Subscribe: that is a subscription too.
    const stickyRe = /\b(?:get|remove)StickyEvent\s*\(\s*([A-Za-z_][\w.]*?)\s*(?:::class(?:\.java)?|\.class)\s*\)/g;
    let sm: RegExpExecArray | null;
    while ((sm = stickyRe.exec(file.clean)) !== null) {
      out.anySubscription = true;
      const bag = file.isTest ? out.test : out.main;
      for (const t of resolveRef(table, file.path, sm[1])) bag.add(t);
    }

    for (const anno of collectAnnotationTargets(file.clean)) {
      if (anno.name !== 'Subscribe') continue;

      const ref = subscriptionParamType(file.clean, file.raw, anno.target, isJava);
      if (ref === null) {
        const pos = posOf(anno.target);
        out.unreadable.push({ path: file.path, line: pos.line, character: pos.character });
        continue;
      }

      out.anySubscription = true;
      if (UNIVERSAL_EVENT_TYPES.has(ref)) { out.universal = true; continue; }

      // An ambiguous subscription counts for EVERY candidate: generous on
      // purpose, since over-hearing only loses findings.
      const targets = resolveRef(table, file.path, ref);
      const bag = file.isTest ? out.test : out.main;
      for (const t of targets) bag.add(t);

      const pos = posOf(anno.target);
      out.sites.push({
        path: file.path,
        line: pos.line,
        character: pos.character,
        ref,
        resolved: targets,
        isTest: file.isTest,
        ...handlerExtent(file.raw, file.clean, anno.target),
      });
    }
  }

  return out;
}

/**
 * The whole handler's extent, annotation line included, so removing a starved
 * subscriber leaves no orphan `@Subscribe` behind. -1 when not delimitable:
 * the verdict stands, the fix gives up, as everywhere in the family.
 */
/**
 * The doc comment glued above, taken with the handler it describes.
 *
 * Left behind, it attaches itself to whatever declaration comes next and
 * documents that one instead: the reader finds "what this handler did" above a
 * function that never was one. Every other family has taken the doc comment
 * with the cut for a long time.
 *
 * The whole block or nothing, line by line, and only lines that are comment.
 * A line of code carrying a trailing block comment ends on the same two
 * characters, and a walk that trusted that alone would climb from it to the
 * nearest comment opener anywhere above.
 */
function debutAvecDoc(raw: string, start: number): number {
  const lignes = raw.split('\n');
  const numero = raw.slice(0, start).split('\n').length - 1;
  const t = (i: number): string => (lignes[i] ?? '').trim();
  const l = numero - 1;
  if (l < 0 || !t(l).endsWith('*/') || !(t(l).startsWith('/*') || t(l).startsWith('*'))) return start;
  let k = l;
  while (k >= 0) {
    if (t(k).startsWith('/*')) break;
    if (!t(k).startsWith('*')) return start;
    k--;
  }
  if (k < 0) return start;
  let offset = 0;
  for (let i = 0; i < k; i++) offset += lignes[i].length + 1;
  return offset;
}

function handlerExtent(
  raw: string,
  clean: string,
  target: number,
): { removeStart: number; removeEnd: number } {
  // Back up to the start of the annotation's line.
  let start = raw.lastIndexOf('\n', Math.max(target - 1, 0));
  // The annotation may sit on its own line above the target.
  // `@org.greenrobot.eventbus.Subscribe` is the same annotation, qualified.
  let annoLine = -1;
  const annoRe = /@(?:[\w.]+\.)?Subscribe\b/g;
  let am: RegExpExecArray | null;
  // Cherchee dans le CODE, pas dans le brut. Une mention de `@Subscribe` posee
  // ENTRE l'annotation et la fonction, dans un commentaire ou une chaine, est
  // plus proche de la cible que la vraie : la remontee s'arretait sur elle et
  // laissait l'annotation dans le fichier, ce que cette fonction existe
  // precisement pour eviter. La copie blanchie garde les offsets et perd les
  // fausses. Mesure sur le projet de reference : 3 des 298 occurrences de
  // `@Subscribe` sont hors code.
  while ((am = annoRe.exec(clean)) !== null && am.index < target) annoLine = am.index;
  if (annoLine !== -1) {
    const annoLineStart = raw.lastIndexOf('\n', annoLine);
    if (annoLineStart !== -1 && annoLineStart < start) start = annoLineStart;
    if (annoLineStart === -1) start = -1;
  }
  start = start + 1;
  start = debutAvecDoc(raw, start);

  const bodyOpen = clean.indexOf('{', target);
  if (bodyOpen === -1) return { removeStart: -1, removeEnd: -1 };
  const bodyClose = matchBrace(clean, bodyOpen);
  if (bodyClose === -1) return { removeStart: -1, removeEnd: -1 };
  const lineEnd = raw.indexOf('\n', bodyClose);
  return { removeStart: start, removeEnd: lineEnd === -1 ? raw.length : lineEnd + 1 };
}

/** The event type of a `@Subscribe` method, or null when unreadable (C3). */
function subscriptionParamType(
  clean: string,
  raw: string,
  target: number,
  isJava: boolean,
): string | null {
  const after = clean.slice(target, target + 400);
  const header = isJava ? JAVA_METHOD_RE.exec(after) : KOTLIN_FUN_RE.exec(after);
  if (!header) return null;

  const openIdx = target + header[0].length - 1;
  const closeIdx = findMatchingParen(clean, openIdx);
  if (closeIdx === -1) return null;

  const segments = splitParamSegments(clean, openIdx + 1, closeIdx, raw);
  // A bus delivers to exactly one parameter. Anything else is not a shape we
  // understand, and guessing would be inventing.
  if (segments.length !== 1) return null;
  const seg = segments[0];

  if (!isJava) {
    const colon = depthZeroColon(clean, seg);
    if (colon === -1) return null;
    const type = bareName(raw.slice(colon + 1, seg.end));
    return type || null;
  }

  // Java: `@NonNull final PreloadStartedEvent event`. Missing this shape would
  // poison the whole scan on a very ordinary declaration.
  const text = raw.slice(seg.start, seg.end)
    .replace(/@\w+(?:\([^)]*\))?/g, ' ')
    .replace(/\bfinal\b/g, ' ')
    .trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const type = bareName(words[words.length - 2]);
  return type || null;
}

/** Every bus post site we can attribute to a declared type (phase 4). */
function collectPosts(
  files: readonly { path: string; clean: string; raw: string; isTest: boolean }[],
  table: TypeTable,
  busReceivers: ReadonlySet<string>,
  explain: PostExplanation[] | undefined,
): Map<string, PostSite[]> {
  const byFqn = new Map<string, PostSite[]>();

  for (const file of files) {
    if (isBusImplementation(file.raw)) {                              // P6
      note(explain, file.path, 0, '', 'P6:bus-implementation');
      continue;
    }
    const lineStarts = buildLineStarts(file.clean);

    POST_CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = POST_CALL_RE.exec(file.clean)) !== null) {
      const pos = offsetToPos(lineStarts, m.index);
      const receiver = receiverBefore(file.clean, m.index).replace(/^this\./, '');

      if (!busReceivers.has(receiver)) {                              // P1
        note(explain, file.path, pos.line, receiver, 'P1:not-a-bus');
        continue;
      }

      const openIdx = m.index + m[0].length - 1;
      const closeIdx = findMatchingParen(file.clean, openIdx);
      if (closeIdx === -1) {                                          // P2
        note(explain, file.path, pos.line, receiver, 'P2:unbalanced');
        continue;
      }

      const segments = splitParamSegments(file.clean, openIdx + 1, closeIdx, file.raw);
      if (segments.length === 0) {
        note(explain, file.path, pos.line, receiver, 'P2:no-argument');
        continue;
      }

      let ref = postedRef(file.raw, segments[0]);
      if (!ref) {
        // The head is a plain name: a local built just above is readable, a
        // factory or a builder is not.
        const varName = /^([a-z_]\w*)$/.exec(file.raw.slice(segments[0].start, segments[0].end).trim());
        ref = varName ? localAssignedType(file.clean, file.raw, varName[1], m.index) : '';
      }
      if (!ref) {                                                     // P4
        note(explain, file.path, pos.line, receiver, 'P4:unresolved');
        continue;
      }

      const targets = resolveRef(table, file.path, ref);
      if (targets.length === 0) {                                     // P4
        note(explain, file.path, pos.line, ref, 'P4:not-declared');
        continue;
      }
      if (targets.length > 1) {                                       // P8
        note(explain, file.path, pos.line, ref, 'P8:ambiguous-name');
        continue;
      }

      const fqn = targets[0];
      const closure = ancestorClosure(table, fqn);
      if (closure === null) {                                         // H1
        note(explain, file.path, pos.line, ref, 'H1:ancestor-outside-corpus');
        continue;
      }
      if ([...closure].some(f => SCHEDULED_SUPERTYPES.has(simpleOf(f)))) {   // P5
        note(explain, file.path, pos.line, ref, 'P5:scheduled-type');
        continue;
      }

      const extent = statementExtent(file.raw, file.clean, lineStarts, m.index, openIdx, closeIdx);
      const site: PostSite = {
        path: file.path,
        line: pos.line,
        character: pos.character + 1,
        ref,
        receiver,
        removeStart: extent.start,
        removeEnd: extent.end,
        withheld: extent.withheld,
        branchOpen: extent.branchOpen,
        finallyOpen: extent.finallyOpen,
        isTest: file.isTest,
      };
      const list = byFqn.get(fqn) ?? [];
      list.push(site);
      byFqn.set(fqn, list);
    }
  }

  return byFqn;
}

function simpleOf(fqn: string): string {
  return fqn.split('.').pop() ?? fqn;
}

function note(
  explain: PostExplanation[] | undefined,
  path: string, line: number, ref: string, outcome: string,
): void {
  explain?.push({ path, line, ref, outcome });
}

/**
 * The head of the posted argument, or '' when it is not a name we can attribute.
 *
 * The form with no parentheses is the trap: `bus.post(Pause)` where
 * `object Pause : Parent()` is a real declaration. Requiring `(` after the name
 * misses it, and it misses in the FALSE NEGATIVE direction, which no audit of
 * the findings can reveal.
 */
export function postedRef(raw: string, seg: { start: number; end: number }): string {
  const text = raw.slice(seg.start, seg.end).trim().replace(/^new\s+/, '');
  const head = /^([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)\s*(\(|$)/.exec(text);
  if (!head) return '';
  const ref = head[1].replace(/\s+/g, '');
  // A lowercase head is a variable, a parameter or a factory call: the type is
  // simply not written here, which is P4 rather than an error.
  return /^[A-Z]/.test(simpleOf(ref)) ? ref : '';
}

/** How far back a local assignment is still considered the same statement. */
const LOCAL_ASSIGNMENT_WINDOW = 1200;

/**
 * The type of a local variable assigned from a constructor just above the post.
 *
 * `val event = FooEvent(a, b)` followed by `bus.post(event)` is the single most
 * common shape among posts whose head is not a type: 70 sites on one real
 * workspace, roughly a fifth of all bus posts. Reading none of them is a plain
 * loss of recall.
 *
 * Two things keep it honest. Only a direct constructor call counts, never a
 * factory or a builder, whose return type is not written here. And if the
 * window holds TWO different constructors assigned to the same name, the
 * variable was reassigned and we cannot say which one reaches the post, so the
 * site is dropped exactly as before.
 */
export function localAssignedType(clean: string, raw: string, varName: string, postIdx: number): string {
  const from = Math.max(0, postIdx - LOCAL_ASSIGNMENT_WINDOW);
  const window = clean.slice(from, postIdx);
  const re = new RegExp(`\\b${varName}\\s*=\\s*(?:new\\s+)?([A-Z][\\w.]*)\\s*\\(`, 'g');

  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) found.add(raw.slice(from + m.index, from + m.index + m[0].length)
    .replace(/^.*?=\s*(?:new\s+)?/, '').replace(/\s*\($/, ''));

  return found.size === 1 ? [...found][0] : '';
}

type BlockKind = 'if' | 'else' | 'while' | 'for' | 'do' | 'try' | 'catch' | 'finally' | 'when' | 'arrow';

/**
 * The CONTROL FLOW construct whose body the `{` at `braceIdx` opens, or
 * undefined when it opens a body proper: a function, a class, a lambda.
 *
 * The difference decides whether emptying the block is visible. A function
 * left with an empty body becomes a declaration the next scan reports; an
 * `if` or `else` branch left empty is reported by nothing at all, compiles,
 * and takes the locals it consumed down with it.
 *
 * Reads backwards from the index it is given, so a caller can also hand it
 * the position right after a `)` or an `else` and ask whether a BRACELESS
 * body would start there.
 */
function blockKind(clean: string, braceIdx: number): BlockKind | undefined {
  let k = braceIdx - 1;
  while (k >= 0 && /\s/.test(clean[k])) k--;
  if (k >= 1 && clean[k] === '>' && clean[k - 1] === '-') return 'arrow';  // `when` branch
  if (clean[k] === ')') {
    const j = openingParenOf(clean, k);
    if (j <= 0) return undefined;
    let m = j - 1;
    while (m >= 0 && /\s/.test(clean[m])) m--;
    const word = wordEndingAt(clean, m);
    return word === 'if' || word === 'while' || word === 'for' || word === 'catch' || word === 'when'
      ? word : undefined;
  }
  const word = wordEndingAt(clean, k);
  return word === 'else' || word === 'try' || word === 'finally' || word === 'do' ? word : undefined;
}

/** The identifier ending at `k` inclusive, '' when `k` is not on one. */
function wordEndingAt(clean: string, k: number): string {
  let s = k;
  while (s >= 0 && /\w/.test(clean[s])) s--;
  return clean.slice(s + 1, k + 1);
}

/** The identifier starting at `i`, '' when `i` is not on one. */
function wordStartingAt(clean: string, i: number): string {
  if (!/[A-Za-z_]/.test(clean[i] ?? '')) return '';
  let e = i;
  while (e < clean.length && /\w/.test(clean[e])) e++;
  return clean.slice(i, e);
}

/** The `(` matching the `)` at `closeIdx`, or -1. */
function openingParenOf(clean: string, closeIdx: number): number {
  let depth = 0;
  for (let j = closeIdx; j >= 0; j--) {
    if (clean[j] === ')') depth++;
    else if (clean[j] === '(') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

/** The `{` matching the `}` at `closeIdx`, or -1. */
function openingBraceOf(clean: string, closeIdx: number): number {
  let depth = 0;
  for (let j = closeIdx; j >= 0; j--) {
    if (clean[j] === '}') depth++;
    else if (clean[j] === '{') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

/** The control-flow block a span is the whole body of. */
interface Enclosure {
  kind: BlockKind;
  /** False for `if (x)\n    stmt`, where the span IS the body. */
  braced: boolean;
  /** The `{` opening the block, -1 when braceless. */
  open: number;
}

/**
 * The block whose entire content is `clean[start, end)`, or undefined when
 * something else shares it.
 *
 * Braced: `{` right before, `}` right after, opened by a control-flow
 * keyword. Braceless: the span sits right after a `)` or an `else`, so
 *
 *   if (flag)
 *       bus.post(Event())
 *
 * would leave `if (flag)` followed by the NEXT statement, which becomes the
 * body: it compiles and changes behaviour, and nothing catches it. For an
 * `else`, a `when` branch or a `for`, it is a plain syntax error.
 */
function soleContentOf(clean: string, start: number, end: number): Enclosure | undefined {
  let before = start - 1;
  while (before >= 0 && /\s/.test(clean[before])) before--;
  let after = end;
  while (after < clean.length && /\s/.test(clean[after])) after++;
  if (clean[before] === '{' && clean[after] === '}') {
    const kind = blockKind(clean, before);
    if (kind) return { kind, braced: true, open: before };
  }
  const braceless = blockKind(clean, before + 1);
  return braceless ? { kind: braceless, braced: false, open: -1 } : undefined;
}

/** The refusal a human reads for a post alone in a block. */
function withheldFor(alone: Enclosure): string {
  if (!alone.braced) return 'sole content of a braceless branch';
  switch (alone.kind) {
    case 'while': case 'for': case 'do': return `sole content of a ${alone.kind} loop`;
    case 'try': case 'catch': case 'finally': return `sole content of a ${alone.kind} block`;
    case 'when': case 'arrow': return 'sole content of a when branch';
    default: return 'sole content of a branch';
  }
}

/** What `statementExtent` decided, and why when it gave up. */
interface Extent {
  start: number;
  end: number;
  withheld?: string;
  /** Set when the post is alone in an if/else branch: see `applyBranchRules`. */
  branchOpen?: number;
  /** Set when the post is alone in a `finally`: see `applyFinallyRules`. */
  finallyOpen?: number;
  /** The text replacing the extent, for a lifted try body (KJ-069). */
  rewriteText?: string;
}

const refused = (withheld: string): Extent => ({ start: -1, end: -1, withheld });

/**
 * The plain whole-line extent of a post statement, no guard applied: from
 * the start of the line holding the receiver to the end of the line holding
 * the closing paren. What a review of the refused posts can offer a human,
 * next to the reason `statementExtent` gave for holding it back.
 */
export function unprovenPostExtent(
  raw: string,
  clean: string,
  lineStarts: readonly number[],
  postIdx: number,
  openIdx: number,
  closeIdx: number,
): { start: number; end: number } {
  const first = offsetToPos(lineStarts as number[], receiverSpan(clean, postIdx).start).line;
  const last = offsetToPos(lineStarts as number[], closeIdx).line;
  return {
    start: lineStarts[first],
    end: last + 1 < lineStarts.length ? lineStarts[last + 1] : raw.length,
  };
}

/**
 * The whole statement holding the post, or -1 when removing it would leave
 * something behind. Same discipline as `removalExtent` in unusedSymbols: the
 * fix is allowed to give up while the verdict still stands (X1, X2), and it
 * says why.
 *
 * A post alone in an if/else branch is not settled here. Whether the branch
 * or its whole chain can go with it depends on what the sibling branches
 * post, which is only known once every verdict is: `applyBranchRules`.
 */
function statementExtent(
  raw: string,
  clean: string,
  lineStarts: readonly number[],
  postIdx: number,
  openIdx: number,
  closeIdx: number,
): Extent {
  const plain = unprovenPostExtent(raw, clean, lineStarts, postIdx, openIdx, closeIdx);

  // The post has to be the entire statement. `if (x) bus.post(…)`,
  // `.also { bus.post(…) }` and a chained call all leave a dangling head.
  const receiverStart = receiverSpan(clean, postIdx).start;
  if (clean.slice(plain.start, receiverStart).trim() !== '') return refused('a head before the post');

  const after = clean.slice(closeIdx + 1, plain.end).trim();
  if (after !== '' && after !== ';') return refused('a tail after the post');

  // An argument that calls something has a side effect we would be deleting.
  // Sliced from AFTER the post's own paren, which would otherwise read as the
  // outer call of a nested pair and make every post unremovable.
  const arg = clean.slice(openIdx + 1, closeIdx);
  const nested = /\w\s*\([^)]*?([A-Za-z_$][\w$]*)\s*\(/.exec(arg);
  if (nested) return refused(`argument calls ${nested[1]}(), which may have a side effect`);

  // The post may be the whole CONTENT OF ITS BLOCK. Removing it then leaves
  // `} else if (cond) {\n}` behind: it compiles, so nothing catches it, and
  // the locals the statement consumed go dead with it. Seen on
  // /workspace/exampleapp in DeepLinkIntentController, where the
  // cut left an empty branch and an unused `deepLinkUrl`.
  const alone = soleContentOf(clean, plain.start, plain.end);
  if (alone) {
    const withheld = withheldFor(alone);
    if (alone.braced && (alone.kind === 'if' || alone.kind === 'else')) {
      return { start: -1, end: -1, withheld, branchOpen: alone.open };
    }
    if (alone.braced && alone.kind === 'finally') {
      return { start: -1, end: -1, withheld, finallyOpen: alone.open };
    }
    return refused(withheld);
  }

  return plain;
}

interface IfBranch {
  kind: 'if' | 'else';
  /** The condition as written, '' for a final `else`. */
  cond: string;
  open: number;
  close: number;
}

interface IfChain {
  /** Offset of the head `if`. */
  head: number;
  branches: IfBranch[];
}

/**
 * The if / else if / else chain one branch belongs to, or undefined when the
 * chain is not the plain braced shape: every branch `(cond) {…}` or
 * `else {…}`, nothing braceless. Walks back from the branch to the head
 * `if`, then reads the whole chain forward from there.
 */
function ifChainAround(clean: string, branchOpen: number): IfChain | undefined {
  let open = branchOpen;
  let head = -1;
  // Bounded: a chain longer than this was not written by hand.
  for (let guard = 0; guard < 64 && head === -1; guard++) {
    let k = open - 1;
    while (k >= 0 && /\s/.test(clean[k])) k--;
    if (clean[k] === ')') {
      const paren = openingParenOf(clean, k);
      if (paren <= 0) return undefined;
      k = paren - 1;
      while (k >= 0 && /\s/.test(clean[k])) k--;
      if (wordEndingAt(clean, k) !== 'if') return undefined;
      const ifStart = k - 1;
      k = ifStart - 1;
      while (k >= 0 && /\s/.test(clean[k])) k--;
      if (wordEndingAt(clean, k) !== 'else') { head = ifStart; break; }
    } else if (wordEndingAt(clean, k) !== 'else') {
      return undefined;
    }
    // Before an `else`: the `}` closing the previous branch.
    k -= 4;
    while (k >= 0 && /\s/.test(clean[k])) k--;
    if (clean[k] !== '}') return undefined;
    open = openingBraceOf(clean, k);
    if (open === -1) return undefined;
  }
  if (head === -1) return undefined;
  const chain = ifChainFrom(clean, head);
  return chain?.branches.some(b => b.open === branchOpen) ? chain : undefined;
}

function ifChainFrom(clean: string, head: number): IfChain | undefined {
  const branches: IfBranch[] = [];
  const skip = (i: number) => { while (i < clean.length && /\s/.test(clean[i])) i++; return i; };
  const wordAt = (i: number) => wordStartingAt(clean, i);
  let pos = head;
  for (;;) {
    if (wordAt(pos) !== 'if') return undefined;
    let i = skip(pos + 2);
    if (clean[i] !== '(') return undefined;
    const condClose = findMatchingParen(clean, i);
    if (condClose === -1) return undefined;
    const cond = clean.slice(i + 1, condClose);
    i = skip(condClose + 1);
    if (clean[i] !== '{') return undefined;
    const close = matchBrace(clean, i);
    if (close === -1) return undefined;
    branches.push({ kind: 'if', cond, open: i, close });
    i = skip(close + 1);
    if (wordAt(i) !== 'else') return { head, branches };
    i = skip(i + 4);
    if (wordAt(i) === 'if') { pos = i; continue; }
    if (clean[i] !== '{') return undefined;
    const elseClose = matchBrace(clean, i);
    if (elseClose === -1) return undefined;
    branches.push({ kind: 'else', cond: '', open: i, close: elseClose });
    return { head, branches };
  }
}

/**
 * What makes a condition unsafe to drop, or undefined when it is pure.
 *
 * Evaluating the condition is the one thing a removed branch still did. A
 * call in it may have had a side effect, an assignment certainly had, and a
 * trailing lambda is a call without parens. A `(` after a name, a `)` or a
 * `>` reads as a call, so `a > (b)` is refused too: that loses a removal and
 * invents nothing.
 */
function impurityOf(cond: string): string | undefined {
  const named = /([A-Za-z_$][\w$]*)\s*\(/.exec(cond);
  if (named) return `calls ${named[1]}()`;
  if (/[)\]>]\s*\(/.test(cond)) return 'contains a call';
  if (cond.includes('{')) return 'contains a lambda';
  if (/(^|[^=!<>])=(?!=)/.test(cond) || /\+\+|--/.test(cond)) return 'assigns';
  return undefined;
}

/**
 * True when the chain is a statement of its own: nothing before its `if` is
 * waiting for a value.
 *
 * Kotlin ends a statement with a newline, so the token before can be a `)`,
 * a name or a literal as well as a `}` or a `;`. What cannot precede a
 * statement is an operator or an opener left open on the line above, or a
 * `return`/`throw` whose value the chain is:
 *
 *   fun f() =
 *       if (…) { post } else { post }
 *
 * The head LINE is clean, and removing the chain leaves `fun f() =` dangling.
 * That is a compile error rather than a silent change, so this only saves a
 * human a broken build; it still costs nothing to refuse.
 */
function startsAStatement(clean: string, head: number): boolean {
  let k = head - 1;
  while (k >= 0 && /\s/.test(clean[k])) k--;
  if (k < 0) return true;
  const ch = clean[k];
  // Java's `case X:` starts a statement; Kotlin's `?:` waits for its right side.
  if (ch === ':') return clean[k - 1] !== '?';
  if (/[=(\[,.&|+\-*/%^<>]/.test(ch)) return false;
  const word = wordEndingAt(clean, k);
  return word !== 'return' && word !== 'throw' && word !== 'else';
}

/**
 * The whole chain, head line through the line of the final `}`, or the
 * reason it cannot go as a unit.
 */
function wholeChainExtent(
  raw: string,
  clean: string,
  lineStarts: readonly number[],
  chain: IfChain,
): Extent {
  const end = chain.branches[chain.branches.length - 1].close;
  const headLine = offsetToPos(lineStarts as number[], chain.head).line;
  const lineEnd = lineEndAfter(raw, lineStarts, end);
  const tail = clean.slice(end + 1, lineEnd).trim();
  // `val x = if (…)` is an expression, and a `}.also {` a continuation.
  if (clean.slice(lineStarts[headLine], chain.head).trim() !== '' || (tail !== '' && tail !== ';')) {
    return refused('sole content of a branch whose chain shares a line with other code');
  }
  const extent = { start: lineStarts[headLine], end: lineEnd };
  // The chain alone in an outer branch would leave THAT one empty; as a
  // braceless body, it would hand the outer `if` the next statement.
  if (soleContentOf(clean, extent.start, extent.end)) {
    return refused('sole content of a branch whose chain is itself alone in a branch');
  }
  if (!startsAStatement(clean, chain.head)) {
    return refused('sole content of a branch whose chain is not a statement of its own');
  }
  return extent;
}

/**
 * From right after the `}` closing the previous branch to right after the
 * last one's, so `\t} else if (c) {\n\t\tpost\n\t}\n` leaves `\t}\n`; or the
 * reason the last branch cannot go alone.
 */
function trailingBranchExtent(
  raw: string,
  clean: string,
  lineStarts: readonly number[],
  chain: IfChain,
): Extent {
  const last = chain.branches[chain.branches.length - 1];
  const previous = chain.branches[chain.branches.length - 2];
  const tail = clean.slice(last.close + 1, lineEndAfter(raw, lineStarts, last.close)).trim();
  if (tail !== '' && tail !== ';') {
    return refused('sole content of a trailing branch that shares its last line with other code');
  }
  // An `else` after a chain that already ends in one belongs to an outer
  // `if` whose BRACELESS body the chain is:
  //
  //   if (outer)
  //       if (a) { foo() } else { post }
  //   else
  //       bar()
  //
  // Dropping the inner `else` compiles, and both kotlinc and javac then bind
  // the outer `else` to `if (a)`: `bar()` ran when `!outer`, it would run when
  // `outer && !a`, and nothing at all when `!outer`. A `when` branch followed
  // by `else ->` is the same token. Without that `else`, the emptied chain is
  // still the whole body and nothing rebinds, so the branch may go. Kotlin
  // also allows a `;` before `else` (`if (a) b; else c`), so a `;` after the
  // chain's `}` is skipped like blank space: without this the separator hid
  // the `else` and the trailing branch went, rebinding it all the same.
  let next = last.close + 1;
  while (next < clean.length && /[\s;]/.test(clean[next])) next++;
  if (wordStartingAt(clean, next) === 'else') {
    return refused('sole content of a trailing branch whose chain is the braceless body of an outer branch');
  }
  if (!startsAStatement(clean, chain.head)) {
    return refused('sole content of a trailing branch whose chain is not a statement of its own');
  }
  return { start: previous.close + 1, end: last.close + 1 };
}

/** Offset just past the newline ending the line that holds `offset`. */
function lineEndAfter(raw: string, lineStarts: readonly number[], offset: number): number {
  const line = offsetToPos(lineStarts as number[], offset).line;
  return line + 1 < lineStarts.length ? lineStarts[line + 1] : raw.length;
}

/** A `try` statement read backwards from the `{` of its `finally`. */
interface TryStatement {
  /** Offset of the `t` of `try`. */
  tryWord: number;
  tryOpen: number;
  tryClose: number;
  /** The catch clauses between the try body and the finally, in source order. */
  catches: { open: number; close: number }[];
  finallyOpen: number;
  finallyClose: number;
  /** Java `try (Closeable c = …)`: the resources close on the way out. */
  withResources: boolean;
}

/**
 * The `try` the `finally` at `finallyOpen` belongs to, or undefined.
 *
 * Read backwards, clause by clause, the way `ifChainAround` reads a chain:
 * the word `finally`, then the `}` of the block before it, and so on until a
 * `try` is reached. Sixteen clauses is far past any real statement and stops
 * a malformed file from walking the whole buffer.
 */
function tryStatementAround(clean: string, finallyOpen: number): TryStatement | undefined {
  let k = finallyOpen - 1;
  while (k >= 0 && /\s/.test(clean[k])) k--;
  if (wordEndingAt(clean, k) !== 'finally') return undefined;
  k -= 'finally'.length;
  while (k >= 0 && /\s/.test(clean[k])) k--;
  if (clean[k] !== '}') return undefined;

  const finallyClose = matchBrace(clean, finallyOpen);
  if (finallyClose < 0) return undefined;
  const catches: { open: number; close: number }[] = [];

  for (let garde = 0; garde < 16; garde++) {
    const close = k;
    const open = openingBraceOf(clean, close);
    if (open < 0) return undefined;
    let m = open - 1;
    while (m >= 0 && /\s/.test(clean[m])) m--;

    if (clean[m] === ')') {
      const j = openingParenOf(clean, m);
      if (j < 0) return undefined;
      let w = j - 1;
      while (w >= 0 && /\s/.test(clean[w])) w--;
      const mot = wordEndingAt(clean, w);
      if (mot === 'try') {
        return { tryWord: w - 2, tryOpen: open, tryClose: close, catches: catches.reverse(), finallyOpen, finallyClose, withResources: true };
      }
      if (mot !== 'catch') return undefined;
      catches.push({ open, close });
      let p = w - 'catch'.length;
      while (p >= 0 && /\s/.test(clean[p])) p--;
      if (clean[p] !== '}') return undefined;
      k = p;
      continue;
    }

    if (wordEndingAt(clean, m) !== 'try') return undefined;
    return { tryWord: m - 2, tryOpen: open, tryClose: close, catches: catches.reverse(), finallyOpen, finallyClose, withResources: false };
  }
  return undefined;
}

/** The innermost block holding `offset`, braces balanced backwards. */
function enclosingBlockOf(clean: string, offset: number): { open: number; close: number } | undefined {
  let depth = 0;
  for (let i = offset - 1; i >= 0; i--) {
    if (clean[i] === '}') depth++;
    else if (clean[i] === '{') {
      if (depth === 0) {
        const close = matchBrace(clean, i);
        return close < 0 ? undefined : { open: i, close };
      }
      depth--;
    }
  }
  return undefined;
}

/**
 * The names a span declares at its own level, braces and parens excluded.
 *
 * Over approximates on purpose: `return x;` reads as a declaration of `x`,
 * and a name collected for nothing only makes the lift refuse. The lift is
 * the only caller, and refusing is its safe direction.
 */
function namesDeclaredAtTopLevel(span: string): string[] {
  let depth = 0;
  let plat = '';
  for (const ch of span) {
    if (ch === '{' || ch === '(' || ch === '[') { depth++; plat += ' '; continue; }
    if (ch === '}' || ch === ')' || ch === ']') { depth = Math.max(0, depth - 1); plat += ' '; continue; }
    plat += depth === 0 ? ch : (ch === '\n' ? '\n' : ' ');
  }
  const noms = new Set<string>();
  for (const m of plat.matchAll(/\b(?:val|var)\s+([A-Za-z_]\w*)/g)) noms.add(m[1]);
  for (const m of plat.matchAll(/(?:^|[;{}])\s*(?:final\s+)?[A-Za-z_][\w.]*(?:<[^>;{}]*>)?(?:\[\])*\s+([a-z_]\w*)\s*[=;]/gm)) noms.add(m[1]);
  return [...noms];
}

/**
 * KJ-069: what to do with a post that is the whole content of a `finally`.
 *
 * Two shapes, and everything else is withheld with its reason.
 *
 *   1. The try has catch clauses. The `finally { … }` tail goes and the
 *      try/catch stays whole: the same shape as a trailing if branch.
 *   2. The try has no catch. `try { A } finally { post }` IS `A` once the post
 *      goes, so the body is lifted one indentation level and the wrapper
 *      disappears. Anything that makes the identity doubtful refuses: a try
 *      with resources (the close would go), a try that is an EXPRESSION
 *      (`val x = try { … }`), a brace written any way but one clause per line,
 *      a raw string in the body (de indenting changes what it holds), a
 *      continuation binding to the `}`, and a local the enclosing block
 *      already names, which would be a conflicting declaration after the lift.
 */
function finallyExtent(
  raw: string,
  clean: string,
  lineStarts: readonly number[],
  t: TryStatement,
): Extent {
  const refuse = (pourquoi: string) => refused(`sole content of a finally block ${pourquoi}`);

  if (t.catches.length > 0) {
    const tail = clean.slice(t.finallyClose + 1, lineEndAfter(raw, lineStarts, t.finallyClose)).trim();
    if (tail !== '' && tail !== ';') return refuse('that shares its last line with other code');
    return { start: t.catches[t.catches.length - 1].close + 1, end: t.finallyClose + 1 };
  }

  if (t.withResources) return refuse('of a try with resources');
  if (!startsAStatement(clean, t.tryWord)) return refuse('of a try that is not a statement of its own');

  const lignes = raw.split('\n');
  const ligneDe = (offset: number) => offsetToPos(lineStarts as number[], offset).line;
  const ligneTry = ligneDe(t.tryWord);
  const ligneFinally = ligneDe(t.tryClose);
  const ligneFin = ligneDe(t.finallyClose);
  if ((lignes[ligneTry] ?? '').trim() !== 'try {') return refuse('written other than one clause per line');
  if ((lignes[ligneFinally] ?? '').trim() !== '} finally {') return refuse('written other than one clause per line');
  if ((lignes[ligneFin] ?? '').trim().replace(/;$/, '') !== '}') return refuse('written other than one clause per line');

  const suite = (lignes.slice(ligneFin + 1).find(l => l.trim() !== '') ?? '').trim();
  if (COMMENCE_UNE_SUITE_RE.test(suite)) return refuse('followed by a line that would bind to its body');

  const corps = lignes.slice(ligneTry + 1, ligneFinally);
  if (corps.every(l => l.trim() === '')) return refuse('whose try body is empty');
  if (corps.some(l => l.includes('"""'))) return refuse('whose try body holds a raw string');

  const retraitTry = /^[ \t]*/.exec(lignes[ligneTry] ?? '')![0];
  const premiere = corps.find(l => l.trim() !== '')!;
  const retraitCorps = /^[ \t]*/.exec(premiere)![0];
  if (!retraitCorps.startsWith(retraitTry) || retraitCorps.length === retraitTry.length) {
    return refuse('whose try body could not be de indented');
  }
  const unite = retraitCorps;
  if (corps.some(l => l.trim() !== '' && !l.startsWith(unite))) {
    return refuse('whose try body could not be de indented');
  }

  // Une locale du corps que le bloc englobant nomme deja : apres la remontee
  // c est une declaration en conflit, en Kotlin comme en Java.
  const englobant = enclosingBlockOf(clean, t.tryWord);
  if (!englobant) return refuse('whose enclosing block could not be read');
  const dehors = clean.slice(englobant.open + 1, t.tryWord) + '\n'
    + clean.slice(t.finallyClose + 1, englobant.close);
  for (const nom of namesDeclaredAtTopLevel(clean.slice(t.tryOpen + 1, t.tryClose))) {
    if (new RegExp(`\\b${nom}\\b`).test(dehors)) {
      return refuse(`whose try body declares ${nom}, which the enclosing block already names`);
    }
  }

  const remonte = corps
    .map(l => (l.trim() === '' ? '' : retraitTry + l.slice(unite.length)))
    .join('\n') + '\n';
  return {
    start: lineStarts[ligneTry],
    end: lineEndAfter(raw, lineStarts, t.finallyClose),
    rewriteText: remonte,
  };
}

/**
 * Rule 3: a post alone in a `finally` takes the block, or the whole wrapper.
 *
 * Runs beside `applyBranchRules` and for the same reason: the shape is known
 * here, the verdict is not. A lift travels in `rewriteStart/rewriteEnd/
 * rewriteText` and leaves `removeStart` at -1, so a consumer that only knows
 * how to delete a range does nothing rather than delete a live try body.
 */
function applyFinallyRules(
  entries: readonly { event: UnheardEvent; site: PostSite }[],
  files: readonly { path: string; clean: string; raw: string }[],
): void {
  const fileByPath = new Map(files.map(f => [f.path, f]));
  for (const { event, site } of entries) {
    if (site.finallyOpen === undefined) continue;
    const file = fileByPath.get(site.path);
    if (!file) continue;
    const lineStarts = buildLineStarts(file.clean);
    const t = tryStatementAround(file.clean, site.finallyOpen);
    if (!t) {
      event.withheld = 'sole content of a finally block whose try could not be read';
      continue;
    }
    const extent = finallyExtent(file.raw, file.clean, lineStarts, t);
    if (extent.withheld !== undefined) {
      event.withheld = extent.withheld;
      continue;
    }
    delete event.withheld;
    if (extent.rewriteText === undefined) {
      event.removeStart = extent.start;
      event.removeEnd = extent.end;
      continue;
    }
    event.rewriteStart = extent.start;
    event.rewriteEnd = extent.end;
    event.rewriteText = extent.rewriteText;
  }
}

/**
 * Rules 1 and 2: a post alone in its if/else branch goes with MORE than
 * itself, so that nothing is left empty.
 *
 *   1. Every branch of the chain is one post of an event this scan reports,
 *      with the same verdict, and every condition is pure: the whole chain
 *      goes, head line through closing line, and every site in it gets the
 *      IDENTICAL extent so a consumer's overlap pass collapses them. A scroll
 *      callback posting `Scrolling(true)` in one branch and `Scrolling(false)`
 *      in the other: what the human left was the empty override.
 *   2. Otherwise, the post is alone in the LAST branch and that condition is
 *      pure: the branch alone goes, `} else if (c) {…}` leaving `}`. A middle
 *      branch cannot, dropping it hands its cases to the branch after it.
 *      Nor can the last one when an outer `else` follows the chain, since
 *      that `else` would rebind to the inner `if`: `trailingBranchExtent`.
 *
 * Both need the sibling posts' verdicts, hence a pass over the built findings
 * rather than a line in `statementExtent`. One verdict across the chain
 * matters because consumers act per verdict: the sweep removes `unheard`
 * only, and a chain cut must not take a `testOnlySubscriber` post with it.
 */
function applyBranchRules(
  entries: readonly { event: UnheardEvent; site: PostSite }[],
  files: readonly { path: string; clean: string; raw: string }[],
): void {
  const fileByPath = new Map(files.map(f => [f.path, f]));
  const byPath = new Map<string, { event: UnheardEvent; open: number }[]>();
  for (const { event, site } of entries) {
    if (site.branchOpen === undefined) continue;
    const list = byPath.get(site.path) ?? [];
    list.push({ event, open: site.branchOpen });
    byPath.set(site.path, list);
  }

  for (const [path, list] of byPath) {
    const file = fileByPath.get(path);
    if (!file) continue;
    const lineStarts = buildLineStarts(file.clean);
    const postAlone = (open: number, verdict: UnheardVerdict) =>
      list.some(e => e.open === open && e.event.verdict === verdict);
    const settle = (event: UnheardEvent, extent: Extent) => {
      if (extent.withheld !== undefined) {
        event.withheld = extent.withheld;
        return;
      }
      event.removeStart = extent.start;
      event.removeEnd = extent.end;
      delete event.withheld;
    };

    for (const { event, open } of list) {
      const chain = ifChainAround(file.clean, open);
      if (!chain) {
        event.withheld = 'sole content of a branch whose chain could not be read';
        continue;
      }
      const idx = chain.branches.findIndex(b => b.open === open);
      const allPosts = chain.branches.every(b => postAlone(b.open, event.verdict));
      const impure = chain.branches.map(b => impurityOf(b.cond)).find(x => x !== undefined);

      if (allPosts && impure === undefined) {
        settle(event, wholeChainExtent(file.raw, file.clean, lineStarts, chain));
        continue;
      }

      if (idx === chain.branches.length - 1 && idx > 0) {
        const own = impurityOf(chain.branches[idx].cond);
        if (own !== undefined) {
          event.withheld = `sole content of a trailing branch whose condition ${own}`;
          continue;
        }
        settle(event, trailingBranchExtent(file.raw, file.clean, lineStarts, chain));
        continue;
      }

      event.withheld = allPosts
        ? `sole content of a branch whose chain has a condition that ${impure}`
        : 'sole content of a branch whose chain does other things';
    }
  }
}


interface DeliveredTypes {
  /** fqns a production post can deliver. */
  main: Set<string>;
  /** fqns only a test post delivers. */
  test: Set<string>;
  /** Sites whose delivered type could not be bounded to corpus types. */
  unbounded: { path: string; line: number }[];
}

/**
 * Direction 2 inverts the burden of proof. In direction 1 an unresolved post
 * only loses a candidate; here the posts ARE the evidence, so every post on a
 * learned bus must have its delivered type BOUNDED to corpus types, or nothing
 * can be proven starved. Three resolution steps, in order:
 *
 *   1. the argument's own head (`post(FooEvent())`, `post(Pause)`)
 *   2. a local built just above (`val event = FooEvent(); post(event)`),
 *      including several constructors for one name: the union is a bound
 *   3. a call's RETURN TYPE (`post(factory.createEvent(...))`): every
 *      declaration of that method name in the corpus must have a resolvable
 *      declared return type, and the union of those types is the bound
 *
 * Anything else is unbounded and poisons direction 2 globally, reported as
 * such rather than silently.
 */
function collectDeliveredTypes(
  files: readonly { path: string; clean: string; raw: string; isTest: boolean }[],
  table: TypeTable,
  busReceivers: ReadonlySet<string>,
  cleanByPath: ReadonlyMap<string, string>,
): DeliveredTypes {
  const out: DeliveredTypes = { main: new Set(), test: new Set(), unbounded: [] };

  for (const file of files) {
    if (isBusImplementation(file.raw)) continue;                      // P6
    const lineStarts = buildLineStarts(file.clean);

    POST_CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = POST_CALL_RE.exec(file.clean)) !== null) {
      const receiver = receiverBefore(file.clean, m.index).replace(/^this\./, '');
      if (!busReceivers.has(receiver)) continue;                      // P1

      const openIdx = m.index + m[0].length - 1;
      const closeIdx = findMatchingParen(file.clean, openIdx);
      const pos = offsetToPos(lineStarts, m.index);
      if (closeIdx === -1) {
        out.unbounded.push({ path: file.path, line: pos.line });
        continue;
      }
      const segments = splitParamSegments(file.clean, openIdx + 1, closeIdx, file.raw);
      if (segments.length === 0) {
        out.unbounded.push({ path: file.path, line: pos.line });
        continue;
      }

      const refs = deliveredRefsOf(file, segments[0], m.index, table, cleanByPath);
      if (refs === null) {
        // `// kotlin-jump:ignore unbounded-post` on or above the line: the
        // user asserts this post's delivery set does not matter, and the
        // claim becomes theirs. A test-side unbounded post never poisons the
        // production claim either way.
        const lineStart = lineStarts[pos.line];
        const prev = pos.line > 0 ? file.raw.slice(lineStarts[pos.line - 1], lineStart) : '';
        const own = file.raw.slice(lineStart, m.index);
        if (prev.includes(UNBOUNDED_IGNORE_MARKER) || own.includes(UNBOUNDED_IGNORE_MARKER)) continue;
        if (!file.isTest) out.unbounded.push({ path: file.path, line: pos.line });
        continue;
      }
      const bag = file.isTest ? out.test : out.main;
      for (const ref of refs) {
        const targets = resolveRef(table, file.path, ref);
        if (targets.length === 0) {
          // A bound that names a type outside the corpus cannot be walked, so
          // it is no bound at all.
          out.unbounded.push({ path: file.path, line: pos.line });
        } else {
          // Delivery is generous on ambiguity: every candidate satisfies.
          for (const t of targets) bag.add(t);
        }
      }
    }
  }
  return out;
}

/** The refs a post argument can deliver, or null when unbounded. */
function deliveredRefsOf(
  file: { path: string; clean: string; raw: string },
  seg: { start: number; end: number },
  postIdx: number,
  table: TypeTable,
  cleanByPath: ReadonlyMap<string, string>,
): string[] | null {
  const head = postedRef(file.raw, seg);
  if (head) return [head];

  const argText = file.raw.slice(seg.start, seg.end).trim();

  // `post(it)` inside `expr?.let { ... }`: the delivered type is the type of
  // the receiver expression before the `let`.
  if (argText === 'it') {
    const before = file.clean.slice(Math.max(0, postIdx - 400), postIdx);
    const letCall = /([A-Za-z_][\w.()]*(?:\([^()]*\))?)\s*\??\.let\s*\{[^{}]*$/.exec(before);
    if (letCall) return resolveCallChain(letCall[1], file, table, cleanByPath);
    return null;
  }

  // A plain variable: constructor assignments just above form the bound, and
  // an assignment from a call chain resolves like a direct call would.
  const varName = /^([a-z_]\w*)$/.exec(argText);
  if (varName) {
    const assigned = localAssignedTypes(file, varName[1], postIdx, table, cleanByPath);
    if (assigned !== null) return assigned;
    // Smart cast: `when (x) { is TriggerPayload -> ... post(x) }` bounds `x`
    // to the branch's type. The nearest `is T ->` between the matching
    // `when (x)` and the post is the branch the post sits in.
    const before = file.clean.slice(Math.max(0, postIdx - LOCAL_ASSIGNMENT_WINDOW), postIdx);
    if (new RegExp(`when\\s*\\(\\s*(?:val\\s+)?${varName[1]}\\b`).test(before)) {
      const casts = [...before.matchAll(/\bis\s+([A-Z][\w.]*)\s*->/g)];
      if (casts.length > 0) return [bareName(casts[casts.length - 1][1])];
    }
    return null;
  }

  return resolveCallChain(argText, file, table, cleanByPath);
}

/**
 * The refs a `when` expression's arms deliver, or null when any arm is not a
 * bare boundable reference or constructor. `else -> return` delivers nothing
 * and is fine; `else -> compute()` is a hole in the bound.
 */
function whenArmRefs(whenText: string): string[] | null {
  const out: string[] = [];
  const armRe = /->\s*([^\n;{]+)/g;
  let m: RegExpExecArray | null;
  while ((m = armRe.exec(whenText)) !== null) {
    const value = m[1].trim();
    if (value === 'return' || value.startsWith('return ') || value === 'continue' || value === 'break') continue;
    const ref = /^(?:new\s+)?([A-Z][\w.]*)\s*(?:\(|$)/.exec(value);
    if (!ref) return null;
    if (!out.includes(ref[1])) out.push(ref[1]);
  }
  return out;
}

/**
 * The delivered types of a call expression, or null when unbounded.
 *
 * Three shapes, all resolved through the DECLARED RETURN TYPE of the final
 * method, looked up in the first receiver's own type:
 *
 *   factory.createEvent(...)     receiver is a variable: its declared type
 *                                 names the file holding `createEvent`
 *   Type.newThing(...)           static factory: the receiver IS the type
 *   builder.withX(...).build()   a chain: builders return their product from
 *                                 their own class, so the LAST method is
 *                                 looked up in the FIRST receiver's type
 *
 * A corpus-wide lookup by method name was measured first and collapsed on
 * common names (`build`, `create`): 63 of 63 posts unbounded. Scoping to the
 * receiver's type is what makes direction 2 provable at all.
 */
function resolveCallChain(
  argText: string,
  file: { path: string; clean: string },
  table: TypeTable,
  cleanByPath: ReadonlyMap<string, string>,
): string[] | null {
  if (!argText.endsWith(')')) return null;

  // Walk back over the final balanced argument list to find the last method.
  let depth = 0;
  let i = argText.length - 1;
  for (; i >= 0; i--) {
    const ch = argText[i];
    if (ch === ')') depth++;
    else if (ch === '(') { depth--; if (depth === 0) break; }
  }
  if (i <= 0) return null;
  const beforeParen = argText.slice(0, i).trimEnd();
  const lastMethod = /([A-Za-z_]\w*)$/.exec(beforeParen)?.[1];
  if (!lastMethod || !/^[a-z_]/.test(lastMethod)) return null;

  const firstSegment = /^(?:new\s+)?([A-Za-z_]\w*)/.exec(argText)?.[1];
  if (!firstSegment) return null;

  let scopePaths: string[];
  if (firstSegment === lastMethod) {
    // A function-typed parameter (`buildEvent: () -> T`) invoked in
    // place: the declared return type IS the bound. `() -> Any` bounds
    // nothing, which is the honest answer for it.
    const lambdaTyped = new RegExp(
      `\\b${lastMethod}\\s*:\\s*\\([^)]*\\)\\s*->\\s*([A-Z][\\w.]*)`).exec(file.clean);
    if (lambdaTyped) {
      const t = bareName(lambdaTyped[1]);
      return t === 'Any' || t === 'Object' ? null : [t];
    }
    // Bare call `createIntent(...)`: same file.
    scopePaths = [file.path];
  } else if (/^[A-Z]/.test(firstSegment)) {
    // Static factory: the receiver is the type itself.
    const targets = resolveRef(table, file.path, firstSegment);
    scopePaths = targets.map(t => table.byFqn.get(t)?.path)
      .filter((x): x is string => x !== undefined);
  } else {
    const receiverType = declaredTypeOf(file.clean, firstSegment);
    if (!receiverType) return null;
    const targets = resolveRef(table, file.path, receiverType);
    scopePaths = targets.map(t => table.byFqn.get(t)?.path)
      .filter((x): x is string => x !== undefined);
  }
  if (scopePaths.length === 0) return null;

  const returns: string[] = [];
  for (const path of scopePaths) {
    const clean = cleanByPath.get(path);
    if (!clean) return null;
    const rs = methodReturnTypes(clean, lastMethod, path.endsWith('.java'));
    if (rs === null || rs.length === 0) return null;
    for (const r of rs) if (!returns.includes(r)) returns.push(r);
  }
  return returns;
}

/**
 * The declared type of `name` in this file: a Java field or parameter
 * (`PageOpenedEventFactory pageOpenedEventFactory`), a Kotlin `val x: Type`,
 * or a Kotlin `val x = Type(...)`.
 */
function declaredTypeOf(clean: string, name: string): string | undefined {
  const kotlinTyped = new RegExp(`\\bva[lr]\\s+${name}\\s*:\\s*([A-Z][\\w.]*)`);
  const kotlinCtor = new RegExp(`\\bva[lr]\\s+${name}\\s*=\\s*([A-Z][\\w.]*)\\s*\\(`);
  const kotlinParam = new RegExp(`\\b${name}\\s*:\\s*([A-Z][\\w.]*)`);
  const javaDecl = new RegExp(`\\b([A-Z][\\w.]*)\\s+${name}\\b`);
  for (const re of [kotlinTyped, kotlinCtor, kotlinParam, javaDecl]) {
    const m = re.exec(clean);
    if (m) return bareName(m[1]);
  }
  return undefined;
}

/**
 * Declared return types of `method` within one file, or null when a
 * declaration exists whose return cannot be read. Several overloads union.
 */
function methodReturnTypes(clean: string, method: string, isJava: boolean): string[] | null {
  const out: string[] = [];
  if (isJava) {
    const re = new RegExp(`([A-Z][\\w.<>\\[\\]]*)\\s+${method}\\s*\\(`, 'g');
    let m: RegExpExecArray | null;
    let found = false;
    while ((m = re.exec(clean)) !== null) {
      found = true;
      const t = bareName(m[1]);
      if (!out.includes(t)) out.push(t);
    }
    return found ? out : null;
  }
  const re = new RegExp(`\\bfun\\s+(?:<[^>]*>\\s*)?${method}\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(clean)) !== null) {
    found = true;
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingParen(clean, openIdx);
    if (closeIdx === -1) return null;
    const after = clean.slice(closeIdx + 1, closeIdx + 160);
    const typed = /^\s*:\s*([A-Z][\w.]*)/.exec(after);
    if (typed) { const t = bareName(typed[1]); if (!out.includes(t)) out.push(t); continue; }
    const exprCtor = /^\s*=\s*([A-Z][\w.]*)\s*\(/.exec(after);
    if (exprCtor) { const t = bareName(exprCtor[1]); if (!out.includes(t)) out.push(t); continue; }
    return null;   // block body or untyped expression: the return is unwritten
  }
  return found ? out : null;
}

/**
 * The types a local variable can hold at the post, or null when unbounded.
 *
 * Several constructor assignments union (a `when` writing two constructors
 * delivers one of the two). An assignment from a call chain resolves through
 * `resolveCallChain`; any assignment neither shape can bound voids the whole
 * bound.
 */
function localAssignedTypes(
  file: { path: string; clean: string; raw: string },
  varName: string,
  postIdx: number,
  table: TypeTable,
  cleanByPath: ReadonlyMap<string, string>,
): string[] | null {
  const from = Math.max(0, postIdx - LOCAL_ASSIGNMENT_WINDOW);
  const window = file.clean.slice(from, postIdx);
  const assignRe = new RegExp(`\\b${varName}\\s*=\\s*`, 'g');

  const types: string[] = [];
  let m: RegExpExecArray | null;
  let assignments = 0;
  while ((m = assignRe.exec(window)) !== null) {
    assignments++;
    const rhsStart = from + m.index + m[0].length;
    // The RHS runs to the end of the statement: a `;`, or a newline that does
    // not continue a chain. A `when` expression runs to its matched brace.
    let end = rhsStart;
    if (/^when\b/.test(file.clean.slice(rhsStart, rhsStart + 6))) {
      const open = file.clean.indexOf('{', rhsStart);
      const close = open === -1 ? -1 : matchBrace(file.clean, open);
      if (close === -1) return null;
      end = close + 1;
    } else {
      let depth = 0;
      while (end < file.clean.length) {
        const ch = file.clean[end];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ';' && depth === 0) break;
        else if (ch === '\n' && depth === 0) {
          const rest = file.clean.slice(end + 1, end + 40).trimStart();
          if (!rest.startsWith('.')) break;
        }
        end++;
      }
    }
    const rhs = file.raw.slice(rhsStart, end).trim();

    const ctor = /^(?:new\s+)?([A-Z][\w.]*)\s*\($/.exec(rhs.replace(/\(.*$/s, '('));
    if (ctor) {
      if (!types.includes(ctor[1])) types.push(ctor[1]);
      continue;
    }
    // `val event = Parent.ObjectVariant`, `= Enum.ENTRY`, `= Type.EMPTY`: a
    // bare qualified reference. resolveRef already reads an object, an enum
    // entry and a SCREAMING constant back to its type.
    const bareRef = /^([A-Z][\w.]*)$/.exec(rhs);
    if (bareRef) {
      if (!types.includes(bareRef[1])) types.push(bareRef[1]);
      continue;
    }
    // `val event = when (...) { A -> X.P; B -> Y.Q }`: every arrow value must
    // itself be boundable, and the union bounds the variable.
    if (/^when\b/.test(rhs)) {
      const arms = whenArmRefs(rhs);
      if (arms === null) return null;
      for (const t of arms) if (!types.includes(t)) types.push(t);
      continue;
    }
    const chained = resolveCallChain(rhs, file, table, cleanByPath);
    if (chained === null) return null;
    for (const t of chained) if (!types.includes(t)) types.push(t);
  }
  return assignments > 0 ? types : null;
}

export function findUnheardEvents(input: UnheardEventScanInput): UnheardEventScan {
  const empty: UnheardEventScan = { events: [], unreadable: [], deadSubscriptions: [], unboundedPosts: [] };
  if (input.truncated) return empty;                                  // C1

  const files = input.sources
    .filter(s => (s.path.endsWith('.kt') || s.path.endsWith('.java'))
      && !isBuildArtifactPath(s.path)
      && couldMentionBus(s.text))                                     // phase 0
    .map(s => ({
      path: s.path,
      raw: s.text,
      clean: sanitizeForUsageScan(s.text),
      isTest: isTestSourceSet(s.path, input.testSourceSets),
    }));
  if (files.length === 0) return empty;

  const busReceivers = learnBusReceivers(files);
  if (busReceivers.size === 0) return empty;                          // P0

  const table = buildTypeTable(input.sources);
  const subs = collectSubscriptions(files, table);

  // R-COMPLÈTE: a hole in the subscription set is a truncated corpus for this
  // question. Report the hole, prove nothing.
  if (subs.unreadable.length > 0) {
    return { events: [], unreadable: subs.unreadable, deadSubscriptions: [], unboundedPosts: [] };
  }
  if (!subs.anySubscription) return empty;                            // C2
  if (subs.universal) return empty;                                   // C6

  for (const name of input.assumeSubscribed ?? []) {
    for (const fqn of resolveRefLoose(table, name)) subs.main.add(fqn);
  }

  const ignored = new Set(input.ignoreNames ?? []);
  const exemptFiles = new Set(
    input.sources.filter(s => s.text.includes(IGNORE_MARKER)).map(s => s.path),
  );
  const posts = collectPosts(files, table, busReceivers, undefined);

  const descendantsHeard = new Set<string>();
  for (const heard of subs.main) {
    const node = table.byFqn.get(heard);
    if (!node) continue;
    for (const ref of node.superRefs) {
      for (const parent of resolveRefLoose(table, ref)) descendantsHeard.add(parent);
    }
  }

  const entries: { event: UnheardEvent; site: PostSite }[] = [];
  for (const [fqn, sites] of posts) {
    const simple = simpleOf(fqn);
    if (ignored.has(simple)) continue;                                // P10

    const closure = ancestorClosure(table, fqn);
    if (closure === null) continue;
    if ([...closure].some(f => subs.main.has(f))) continue;           // heard

    const verdict: UnheardVerdict =
      [...closure].some(f => subs.test.has(f)) ? 'testOnlySubscriber'
        : descendantsHeard.has(fqn) ? 'heardOnlyBySubtype'
          : 'unheard';

    for (const site of sites) {
      if (site.isTest) continue;                                      // P7
      if (exemptFiles.has(site.path)) continue;                       // P10
      entries.push({
        site,
        event: {
          name: simple,
          fqn,
          verdict,
          path: site.path,
          line: site.line,
          character: site.character,
          removeStart: site.removeStart,
          removeEnd: site.removeEnd,
          ...(site.withheld === undefined ? {} : { withheld: site.withheld }),
        },
      });
    }
  }

  // A post alone in its branch is settled only now that every verdict is.
  applyBranchRules(entries, files);
  // Same pass for a post alone in a `finally`, whose try then has nothing to
  // protect (KJ-069).
  applyFinallyRules(entries, files);
  // A test that names the event may VERIFY the post: `verify { bus.post(E(url, null)) }`
  // on a mocked bus. Removing the post then compiles and fails that test at
  // runtime, which no scan of main code can see. On the reference project
  // `DeepLinkIntentControllerTest` verified the one post of its event that the
  // branch rule removed, and two tests went red while the build stayed green.
  // The human removed those tests with the event; here the post is withheld
  // with its reason, for the review that shows the reader what to tick, and
  // once every post of the event is gone the event is testOnly and its tests
  // are the closure planner's to take.
  const namedByTests = new Map<string, string>();
  for (const s of input.sources) {
    if (!/\.(kt|kts|java)$/.test(s.path) || !isTestSourceSet(s.path, input.testSourceSets)) continue;
    for (const e of entries) {
      const propose = e.event.removeStart >= 0 || e.event.rewriteText !== undefined;
      if (e.event.verdict !== 'unheard' || !propose || namedByTests.has(e.event.fqn)) continue;
      if (!s.text.includes(e.event.name)) continue;
      const clean = sanitizeForUsageScan(s.text).replace(/^[ \t]*import\b[^\n]*/gm, '');
      const word = new RegExp(`\\b${e.event.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (word.test(clean)) namedByTests.set(e.event.fqn, s.path);
    }
  }
  for (const e of entries) {
    const by = namedByTests.get(e.event.fqn);
    const propose = e.event.removeStart >= 0 || e.event.rewriteText !== undefined;
    if (by === undefined || e.event.verdict !== 'unheard' || !propose) continue;
    e.event.removeStart = -1;
    e.event.removeEnd = -1;
    delete e.event.rewriteStart;
    delete e.event.rewriteEnd;
    delete e.event.rewriteText;
    e.event.withheld = `tests name ${e.event.name} (${by.split(/[\\/]/).pop()}) and may verify this post`;
  }
  const events = entries.map(e => e.event);

  events.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);

  // ── Direction 2: subscriptions nothing ever posts ──────────────────────────
  // The lookup scope may live OUTSIDE the prefiltered file set (a factory
  // file mentions no bus), so every source is sanitised lazily on demand.
  const cleanCache = new Map(files.map(f => [f.path, f.clean]));
  const cleanByPath = {
    get(path: string): string | undefined {
      if (!cleanCache.has(path)) {
        const src = input.sources.find(s => s.path === path);
        if (!src) return undefined;
        cleanCache.set(path, sanitizeForUsageScan(src.text));
      }
      return cleanCache.get(path);
    },
  } as ReadonlyMap<string, string>;
  const delivered = collectDeliveredTypes(files, table, busReceivers, cleanByPath);

  const deadSubscriptions: DeadSubscription[] = [];
  if (delivered.unbounded.length === 0) {
    // A post of X reaches subscribers of X and of every ancestor of X: the
    // set of SATISFIED subscription types is the ancestor closure of what is
    // delivered. Null closures (chain leaving the corpus) satisfy everything,
    // since the unknown segment could be any corpus name.
    // The runtime type of a delivery bounded by a DECLARED type can be any
    // subtype of it, so satisfaction closes over the subtree first, then over
    // ancestors. Uniformly applied: for an exact constructor the subtree pass
    // only ever ADDS satisfaction, which loses findings, never invents one.
    const childrenOf = new Map<string, string[]>();
    for (const node of table.byFqn.values()) {
      for (const ref of node.superRefs) {
        for (const parent of resolveRef(table, node.path, ref)) {
          const list = childrenOf.get(parent) ?? [];
          list.push(node.fqn);
          childrenOf.set(parent, list);
        }
      }
    }
    const subtreeOf = (fqn: string): string[] => {
      const seen = new Set<string>([fqn]);
      const stack = [fqn];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const c of childrenOf.get(cur) ?? []) {
          if (!seen.has(c)) { seen.add(c); stack.push(c); }
        }
      }
      return [...seen];
    };
    const satisfied = (bag: ReadonlySet<string>): Set<string> | null => {
      const out = new Set<string>();
      for (const fqn of bag) {
        for (const member of subtreeOf(fqn)) {
          const closure = ancestorClosure(table, member);
          if (closure === null) return null;
          for (const a of closure) out.add(a);
        }
      }
      return out;
    };
    const mainSat = satisfied(delivered.main);
    const testSat = satisfied(delivered.test);

    if (mainSat !== null && testSat !== null) {
      const assumed = new Set<string>();
      for (const name of input.assumeSubscribed ?? []) assumed.add(name);
      for (const site of subs.sites) {
        if (site.isTest) continue;                                    // test infra
        // A DeadEvent subscription is the bus's own catch-all: the bus itself
        // posts it, from a file P6 excludes.
        if (site.ref === 'DeadEvent') continue;
        if (ignored.has(site.ref)) continue;
        if (exemptFiles.has(site.path)) continue;
        // Ambiguity is generous in BOTH directions: one satisfied candidate
        // keeps the subscription alive.
        if (site.resolved.length === 0) continue;
        if (site.resolved.some(f => mainSat.has(f))) continue;
        const verdict: DeadSubscriptionVerdict =
          site.resolved.some(f => testSat.has(f)) ? 'testOnlyPoster' : 'neverPosted';
        deadSubscriptions.push({
          name: site.ref.split('.').pop() ?? site.ref,
          fqn: site.resolved[0],
          verdict,
          path: site.path,
          line: site.line,
          character: site.character,
          removeStart: site.removeStart,
          removeEnd: site.removeEnd,
        });
      }
      deadSubscriptions.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    }
  }

  return {
    events,
    unreadable: [],
    deadSubscriptions,
    unboundedPosts: delivered.unbounded,
  };
}

/** One line per raw post site, for the dry-run harness. */
export function explainUnheardEvents(input: UnheardEventScanInput): {
  posts: PostExplanation[];
  unreadable: UnreadableSubscription[];
  busReceivers: string[];
} {
  const files = input.sources
    .filter(s => (s.path.endsWith('.kt') || s.path.endsWith('.java'))
      && !isBuildArtifactPath(s.path)
      && couldMentionBus(s.text))
    .map(s => ({
      path: s.path,
      raw: s.text,
      clean: sanitizeForUsageScan(s.text),
      isTest: isTestSourceSet(s.path, input.testSourceSets),
    }));

  const busReceivers = learnBusReceivers(files);
  const table = buildTypeTable(input.sources);
  const subs = collectSubscriptions(files, table);
  const explain: PostExplanation[] = [];
  const posts = collectPosts(files, table, busReceivers, explain);

  const scan = findUnheardEvents(input);
  const reported = new Set(scan.events.map(e => `${e.path}:${e.line}`));
  for (const e of scan.events) {
    explain.push({ path: e.path, line: e.line, ref: e.name, outcome: e.verdict });
  }
  // A post that survived every guard and still is not reported was HEARD.
  // Without this line the audit cannot tell "dropped by a fallback guard" from
  // "genuinely has a subscriber", which is the whole question when comparing
  // against another tool's findings.
  for (const [fqn, sites] of posts) {
    for (const site of sites) {
      if (reported.has(`${site.path}:${site.line}`)) continue;
      explain.push({
        path: site.path,
        line: site.line,
        ref: simpleOf(fqn),
        outcome: site.isTest ? 'P7:test-source-set' : 'heard',
      });
    }
  }
  return { posts: explain, unreadable: subs.unreadable, busReceivers: [...busReceivers] };
}

export function messageFor(event: UnheardEvent): string {
  switch (event.verdict) {
    case 'testOnlySubscriber':
      return `Event '${event.name}' is posted here, and only a test subscribes to it`;
    case 'heardOnlyBySubtype':
      return `Event '${event.name}' is posted here, and the only subscriber listens for a subtype of it`;
    default:
      return `Event '${event.name}' is posted here, and nothing in this workspace subscribes to it`;
  }
}

export function removePostTitleFor(event: UnheardEvent): string {
  return `Remove this post of ${event.name}`;
}

export function createSubscriberTitleFor(event: UnheardEvent): string {
  return `Create a @Subscribe handler for ${event.name}`;
}
