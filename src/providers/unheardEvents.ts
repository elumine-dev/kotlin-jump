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
    || text.includes('postSticky(');
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

  return clean.slice(i + 1, end).replace(/\s+/g, '');
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
function handlerExtent(
  raw: string,
  clean: string,
  target: number,
): { removeStart: number; removeEnd: number } {
  // Back up to the start of the annotation's line.
  let start = raw.lastIndexOf('\n', Math.max(target - 1, 0));
  // The annotation may sit on its own line above the target.
  const annoLine = raw.lastIndexOf('@Subscribe', target);
  if (annoLine !== -1) {
    const annoLineStart = raw.lastIndexOf('\n', annoLine);
    if (annoLineStart !== -1 && annoLineStart < start) start = annoLineStart;
    if (annoLineStart === -1) start = -1;
  }
  start = start + 1;

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

/**
 * The whole statement holding the post, or -1 when removing it would leave
 * something behind. Same discipline as `removalExtent` in unusedSymbols: the
 * fix is allowed to give up while the verdict still stands (X1, X2).
 */
function statementExtent(
  raw: string,
  clean: string,
  lineStarts: readonly number[],
  postIdx: number,
  openIdx: number,
  closeIdx: number,
): { start: number; end: number } {
  const line = offsetToPos(lineStarts as number[], postIdx).line;
  const lineStart = lineStarts[line];
  const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] : raw.length;

  // The post has to be the entire statement. `if (x) bus.post(…)`,
  // `.also { bus.post(…) }` and a chained call all leave a dangling head.
  const before = clean.slice(lineStart, postIdx);
  const receiverStart = lineStart + before.length - receiverBefore(clean, postIdx).length;
  if (clean.slice(lineStart, receiverStart).trim() !== '') return { start: -1, end: -1 };

  const after = clean.slice(closeIdx + 1, lineEnd).trim();
  if (after !== '' && after !== ';') return { start: -1, end: -1 };

  // An argument that calls something has a side effect we would be deleting.
  // Sliced from AFTER the post's own paren, which would otherwise read as the
  // outer call of a nested pair and make every post unremovable.
  const arg = clean.slice(openIdx + 1, closeIdx);
  if (/\w\s*\([^)]*\w\s*\(/.test(arg)) return { start: -1, end: -1 };

  const endLine = offsetToPos(lineStarts as number[], closeIdx).line;
  return {
    start: lineStart,
    end: endLine + 1 < lineStarts.length ? lineStarts[endLine + 1] : raw.length,
  };
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

  const events: UnheardEvent[] = [];
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
      events.push({
        name: simple,
        fqn,
        verdict,
        path: site.path,
        line: site.line,
        character: site.character,
        removeStart: site.removeStart,
        removeEnd: site.removeEnd,
      });
    }
  }

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
