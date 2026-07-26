import { splitTopLevelArguments } from '../providers/NamedArgumentsActionProvider';

/**
 * KJ-013 — Screen Flow Map : statically parses Compose Navigation.
 * No types needed: routes are literals (or const val entries the caller
 * supplies through `constants`). Analysis runs on balanced, string-aware
 * spans, not line by line.
 */

export interface NavNode {
  route: string;
  composable?: string;
  dynamic?: boolean;
  graph?: string;
  /** 0-based line of the composable(...) declaration, used for the jump. */
  line?: number;
}

export interface NavEdge {
  from: string;
  to: string;
}

export interface NavDeepLink {
  pattern: string;
  route: string;
}

export interface ParsedNavigation {
  nodes: NavNode[];
  edges: NavEdge[];
  deepLinks: NavDeepLink[];
  startDestinations: string[];
  /** Routes of the nested graphs (containers, not screens). */
  graphs: string[];
}

interface CallSite {
  name: string;
  callIndex: number;      // index of the name
  headerStart: number;    // index of '('
  headerEnd: number;      // index of the matching ')'
  blockStart: number;     // index of the block '{', -1 if no block
  blockEnd: number;       // index of the matching '}', -1
  args: string;
}

// ── Scanners string-aware ───────────────────────────────────────────────────

function matchBalanced(text: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let inString: '"' | 'raw' | null = null;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\' && inString !== 'raw') { i++; continue; }
      if (inString === 'raw' && text.startsWith('"""', i)) { inString = null; i += 2; }
      else if (inString === '"' && ch === '"') inString = null;
      continue;
    }
    if (text.startsWith('"""', i)) { inString = 'raw'; i += 2; continue; }
    if (ch === '"') { inString = '"'; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Blanks out comments (strings stay intact: routes live inside them). */
function stripComments(text: string): string {
  const out: string[] = [];
  let mode: 'code' | 'line' | 'block' | 'string' | 'raw' = 'code';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const two = text.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; out.push('  '); i++; continue; }
      if (two === '/*') { mode = 'block'; out.push('  '); i++; continue; }
      if (text.startsWith('"""', i)) { mode = 'raw'; out.push('"""'); i += 2; continue; }
      if (ch === '"') { mode = 'string'; out.push(ch); continue; }
      out.push(ch);
    } else if (mode === 'line') {
      if (ch === '\n') { mode = 'code'; out.push('\n'); } else out.push(' ');
    } else if (mode === 'block') {
      if (two === '*/') { mode = 'code'; out.push('  '); i++; continue; }
      out.push(ch === '\n' ? '\n' : ' ');
    } else if (mode === 'string') {
      if (ch === '\\') { out.push(text.slice(i, i + 2)); i++; continue; }
      if (ch === '"' || ch === '\n') mode = 'code';
      out.push(ch);
    } else {
      if (text.startsWith('"""', i)) { mode = 'code'; out.push('"""'); i += 2; continue; }
      out.push(ch);
    }
  }
  return out.join('');
}

function findCalls(text: string, name: string): CallSite[] {
  const sites: CallSite[] = [];
  // `(?<!\w)`: excludes renavigate(), but keeps navController.navigate().
  const re = new RegExp(`(?<!\\w)${name}\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const headerStart = m.index + m[0].length - 1;
    const headerEnd = matchBalanced(text, headerStart, '(', ')');
    if (headerEnd < 0) continue;

    let blockStart = -1;
    let blockEnd = -1;
    let j = headerEnd + 1;
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] === '{') {
      blockStart = j;
      blockEnd = matchBalanced(text, j, '{', '}');
    }
    sites.push({
      name,
      callIndex: m.index,
      headerStart,
      headerEnd,
      blockStart,
      blockEnd,
      args: text.slice(headerStart + 1, headerEnd),
    });
  }
  return sites;
}

// ── Route resolution ────────────────────────────────────────────────────────

function namedArg(args: string[], name: string): string | undefined {
  const found = args.find(a => a.trim().startsWith(`${name} =`) || a.trim().startsWith(`${name}=`));
  return found?.slice(found.indexOf('=') + 1).trim();
}

/** Resolves a route expression. Literal with templates → `{seg}`. */
function resolveRouteExpr(
  expr: string | undefined,
  constants: Map<string, string>,
): { route?: string; dynamic?: boolean } {
  if (!expr) return { dynamic: true };
  const trimmed = expr.trim();

  const literal = /^"((?:[^"\\]|\\.)*)"$/.exec(trimmed);
  if (literal) {
    const route = literal[1]
      .replace(/\$\{([^}]+)\}/g, (_s, inner) => `{${String(inner).trim()}}`)
      .replace(/\$(\w+)/g, '{$1}');
    return { route };
  }
  const constant = constants.get(trimmed);
  if (constant !== undefined) return { route: constant };
  return { dynamic: true };
}

/** Does the target segment match the declared route? `{x}` = wildcard on both sides. */
function routeMatches(target: string, declared: string): boolean {
  if (target === declared) return true;
  const t = target.split('/');
  const d = declared.split('/');
  if (t.length !== d.length) return false;
  return t.every((seg, i) => seg === d[i] || seg.startsWith('{') || d[i].startsWith('{'));
}

// ── API ─────────────────────────────────────────────────────────────────────

export function parseNavigation(
  rawText: string,
  constants: Map<string, string>,
): ParsedNavigation {
  const text = stripComments(rawText);
  const lineOf = (index: number) => (text.slice(0, index).match(/\n/g) ?? []).length;

  const navHosts = findCalls(text, 'NavHost');
  const graphCalls = findCalls(text, 'navigation');
  const composables = findCalls(text, 'composable');
  const navigates = findCalls(text, 'navigate');

  const startDestinations: string[] = [];
  const graphs: string[] = [];

  for (const host of navHosts) {
    const args = splitTopLevelArguments(host.args);
    const start = resolveRouteExpr(namedArg(args, 'startDestination') ?? args[1], constants);
    if (start.route) startDestinations.push(start.route);
  }

  const graphInfo = graphCalls.map(g => {
    const args = splitTopLevelArguments(g.args);
    const route = resolveRouteExpr(namedArg(args, 'route'), constants);
    const start = resolveRouteExpr(namedArg(args, 'startDestination'), constants);
    if (route.route) graphs.push(route.route);
    if (start.route) startDestinations.push(start.route);
    return { site: g, route: route.route };
  });

  const innermostGraph = (index: number): string | undefined => {
    let best: { route?: string; size: number } | undefined;
    for (const g of graphInfo) {
      if (g.site.blockStart < 0) continue;
      if (index > g.site.blockStart && index < g.site.blockEnd) {
        const size = g.site.blockEnd - g.site.blockStart;
        if (!best || size < best.size) best = { route: g.route, size };
      }
    }
    return best?.route;
  };

  const nodes: NavNode[] = [];
  const deepLinks: NavDeepLink[] = [];

  for (const c of composables) {
    const args = splitTopLevelArguments(c.args);
    const routeExpr =
      namedArg(args, 'route') ??
      args.find(a => !/^\s*\w+\s*=/.test(a) && !a.trim().startsWith('{'));
    const resolved = resolveRouteExpr(routeExpr, constants);

    const node: NavNode = resolved.route
      ? { route: resolved.route, line: lineOf(c.callIndex) }
      : { route: `«dynamic»@${lineOf(c.callIndex)}`, dynamic: true, line: lineOf(c.callIndex) };

    const graph = innermostGraph(c.callIndex);
    if (graph) node.graph = graph;

    // Rendered composable name: first Capitalized identifier in the block.
    if (c.blockStart >= 0) {
      const body = text.slice(c.blockStart + 1, c.blockEnd);
      const first = /\b([A-Z]\w*)\s*\(/.exec(body);
      if (first) node.composable = first[1];
    }

    nodes.push(node);

    if (resolved.route) {
      const dlRe = /uriPattern\s*=\s*"([^"]+)"/g;
      let dl: RegExpExecArray | null;
      while ((dl = dlRe.exec(c.args)) !== null) {
        deepLinks.push({ pattern: dl[1], route: resolved.route });
      }
    }
  }

  const innermostComposable = (index: number): NavNode | undefined => {
    let best: { node: NavNode; size: number } | undefined;
    for (let i = 0; i < composables.length; i++) {
      const c = composables[i];
      if (c.blockStart < 0) continue;
      if (index > c.blockStart && index < c.blockEnd) {
        const size = c.blockEnd - c.blockStart;
        if (!best || size < best.size) best = { node: nodes[i], size };
      }
    }
    return best?.node;
  };

  const edges: NavEdge[] = [];
  for (const nav of navigates) {
    const from = innermostComposable(nav.callIndex);
    if (!from || from.dynamic) continue;

    const args = splitTopLevelArguments(nav.args);
    const target = resolveRouteExpr(args[0], constants);
    if (!target.route) continue;

    const declared = nodes.find(n => !n.dynamic && routeMatches(target.route!, n.route));
    const to = declared?.route ?? target.route;
    if (!edges.some(e => e.from === from.route && e.to === to)) {
      edges.push({ from: from.route, to });
    }
  }

  return { nodes, edges, deepLinks, startDestinations, graphs };
}

// ── XML nav graphs (old-school Jetpack Navigation, fragments) ───────────
// Covers pre-Compose apps: <fragment android:id> + <action
// app:destination> + <deepLink app:uri> + nested <navigation>.

function xmlAttr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
  return m?.[1];
}

function stripIdRef(ref: string | undefined): string | undefined {
  return ref?.replace(/^@\+?id\//, '').replace(/^@\+?navigation\//, '');
}

export function parseNavigationXml(xmlText: string): ParsedNavigation {
  const xml = xmlText.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  const nodes: NavNode[] = [];
  const edges: NavEdge[] = [];
  const deepLinks: NavDeepLink[] = [];
  const startDestinations: string[] = [];
  const graphs: string[] = [];

  // Stacks: nested <navigation> (graphs) and the enclosing destination.
  const graphStack: string[] = [];
  const destStack: (string | undefined)[] = [];

  const tagRe = /<(\/?)(navigation|fragment|dialog|activity|action|deepLink)\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const [, closing, tag, attrs, selfClosing] = m;

    if (closing) {
      if (tag === 'navigation') graphStack.pop();
      else if (tag !== 'action' && tag !== 'deepLink') destStack.pop();
      continue;
    }

    const line = (xml.slice(0, m.index).match(/\n/g) ?? []).length;

    if (tag === 'navigation') {
      const id = stripIdRef(xmlAttr(attrs, 'android:id'));
      const start = stripIdRef(xmlAttr(attrs, 'app:startDestination'));
      if (start) startDestinations.push(start);
      // the root graph is not a cluster; the nested ones are
      if (graphStack.length > 0 && id) graphs.push(id);
      graphStack.push(id ?? '');
      if (selfClosing) graphStack.pop();
      continue;
    }

    if (tag === 'fragment' || tag === 'dialog' || tag === 'activity') {
      const id = stripIdRef(xmlAttr(attrs, 'android:id'));
      const className = xmlAttr(attrs, 'android:name');
      if (id) {
        const node: NavNode = { route: id, line };
        if (className) node.composable = className.split('.').pop();
        const enclosingGraph = graphStack.length > 1 ? graphStack[graphStack.length - 1] : undefined;
        if (enclosingGraph) node.graph = enclosingGraph;
        nodes.push(node);
      }
      destStack.push(id);
      if (selfClosing) destStack.pop();
      continue;
    }

    if (tag === 'action') {
      const to = stripIdRef(xmlAttr(attrs, 'app:destination'));
      const from = destStack[destStack.length - 1];
      if (to) {
        // global action (outside any destination): the target stays reachable
        edges.push({ from: from ?? '«global»', to });
      }
      continue;
    }

    if (tag === 'deepLink') {
      const uri = xmlAttr(attrs, 'app:uri');
      const route = destStack[destStack.length - 1];
      if (uri && route) deepLinks.push({ pattern: uri, route });
    }
  }

  return { nodes, edges, deepLinks, startDestinations, graphs };
}

/** Screens never reached: no incoming edge, no deeplink, no startDestination. */
export function findOrphans(parsed: ParsedNavigation): string[] {
  const reachable = new Set<string>([
    ...parsed.edges.map(e => e.to),
    ...parsed.deepLinks.map(d => d.route),
    ...parsed.startDestinations,
  ]);
  return parsed.nodes
    .filter(n => !n.dynamic && !reachable.has(n.route))
    .map(n => n.route);
}

/** Route constants of a file: `const val X = "…"` inside an object,
 *  exposed as both `Object.X` AND `X`. */
export function gatherRouteConstants(text: string): Map<string, string> {
  const constants = new Map<string, string>();
  const lines = stripComments(text).split('\n');
  const objectStack: { name: string; depth: number }[] = [];
  let depth = 0;

  for (const line of lines) {
    const obj = /^\s*(?:\w+\s+)*object\s+(\w+)/.exec(line);
    if (obj && line.includes('{')) {
      objectStack.push({ name: obj[1], depth });
    }
    const cv = /\bconst\s+val\s+(\w+)\s*=\s*"([^"]*)"/.exec(line);
    if (cv) {
      constants.set(cv[1], cv[2]);
      const owner = objectStack[objectStack.length - 1];
      if (owner) constants.set(`${owner.name}.${cv[1]}`, cv[2]);
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        while (objectStack.length > 0 && depth <= objectStack[objectStack.length - 1].depth) {
          objectStack.pop();
        }
      }
    }
  }
  return constants;
}
