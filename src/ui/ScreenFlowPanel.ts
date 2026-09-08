import * as vscode from 'vscode';
import {
  ParsedNavigation,
  NavNode,
  findOrphans,
  gatherRouteConstants,
  parseNavigation,
  parseNavigationXml,
  routeMatches,
} from '../indexer/NavigationIndex';

/**
 * KJ-013 — Screen Flow Map : self-contained webview (inline SVG, no lib)
 * drawing the screens and their navigations. Click on a node = jump to the
 * composable(...) declaration.
 */

interface FileNode extends NavNode {
  file: string;
  /** The same route declared in several files (flavours, modules): one box, a picker on click. */
  alternatives?: { file: string; line?: number }[];
}

interface MergedNavigation extends Omit<ParsedNavigation, 'nodes'> {
  nodes: FileNode[];
  /** True when the file listing hit its cap: some screens may be missing. */
  truncated?: boolean;
}

const MAX_KT_FILES = 20_000;

export async function buildWorkspaceNavigation(): Promise<MergedNavigation> {
  const files = await vscode.workspace.findFiles('**/*.kt', '**/{build,.gradle}/**', MAX_KT_FILES);
  const texts = new Map<string, string>();
  for (const f of files) {
    try {
      const bytes = await vscode.workspace.fs.readFile(f);
      texts.set(f.toString(), new TextDecoder().decode(bytes));
    } catch {
      continue;
    }
  }

  const constants = new Map<string, string>();
  for (const t of texts.values()) {
    for (const [k, v] of gatherRouteConstants(t)) constants.set(k, v);
  }

  const merged: MergedNavigation = {
    nodes: [], edges: [], deepLinks: [], startDestinations: [], graphs: [],
  };
  merged.truncated = files.length >= MAX_KT_FILES;
  for (const [file, t] of texts) {
    if (!/\b(NavHost|composable|navigate)\s*\(/.test(t)) continue;
    const parsed = parseNavigation(t, constants);
    // A dynamic node is keyed by its line: two files with one at the same
    // line drew on top of each other and the click always opened the first.
    const tag = file.split('/').pop() ?? file;
    merged.nodes.push(...parsed.nodes.map(n => ({ ...n, file, route: n.dynamic ? `${n.route}@${tag}` : n.route })));
    merged.edges.push(...parsed.edges);
    merged.deepLinks.push(...parsed.deepLinks);
    merged.startDestinations.push(...parsed.startDestinations);
    merged.graphs.push(...parsed.graphs);
  }

  // XML nav graphs (fragment-based Jetpack Navigation, pre-Compose apps).
  const navXmls = await vscode.workspace.findFiles(
    '**/res/navigation/*.xml', '**/{build,.gradle}/**', 200,
  );
  for (const uri of navXmls) {
    try {
      const parsed = parseNavigationXml(
        new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)),
      );
      merged.nodes.push(...parsed.nodes.map(n => ({ ...n, file: uri.toString() })));
      merged.edges.push(...parsed.edges);
      merged.deepLinks.push(...parsed.deepLinks);
      merged.startDestinations.push(...parsed.startDestinations);
      merged.graphs.push(...parsed.graphs);
    } catch {
      continue;
    }
  }

  // A `navigate("detail/42")` parsed in another file than the
  // `composable("detail/{id}")` kept its literal target: no arrow, and the
  // screen sat in the unreached column although findOrphans knew better.
  const declared = merged.nodes.filter(n => !n.dynamic).map(n => n.route);
  for (const e of merged.edges) {
    if (declared.includes(e.to)) continue;
    const hit = declared.find(r => routeMatches(e.to, r));
    if (hit) e.to = hit;
  }

  // The same route in two files (src/main and src/debug, two modules) drew
  // two boxes at the same spot and counted twice in the legend.
  const byRoute = new Map<string, FileNode>();
  const nodes: FileNode[] = [];
  for (const n of merged.nodes) {
    const first = byRoute.get(n.route);
    if (!first) { byRoute.set(n.route, n); nodes.push(n); continue; }
    (first.alternatives ??= [{ file: first.file, line: first.line }]).push({ file: n.file, line: n.line });
  }
  merged.nodes = nodes;
  return merged;
}

export class ScreenFlowPanel {
  static current: ScreenFlowPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private nav: MergedNavigation;

  static async show(): Promise<void> {
    const nav = await buildWorkspaceNavigation();
    if (ScreenFlowPanel.current) {
      // The click handler reads this.nav, so a re-render must swap it too or
      // routes added since the first open draw fine but never navigate.
      ScreenFlowPanel.current.nav = nav;
      ScreenFlowPanel.current.panel.webview.html = renderHtml(nav);
      ScreenFlowPanel.current.panel.reveal();
      return;
    }
    ScreenFlowPanel.current = new ScreenFlowPanel(nav);
  }

  private constructor(nav: MergedNavigation) {
    this.nav = nav;
    this.panel = vscode.window.createWebviewPanel(
      'kotlinJump.screenFlowMap',
      'Screen Flow Map',
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );
    this.panel.webview.html = renderHtml(nav);
    this.panel.onDidDispose(() => {
      ScreenFlowPanel.current = undefined;
    });
    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.type !== 'jump') return;
      const node = this.nav.nodes.find(n => n.route === msg.route);
      if (!node) return;
      let target: { file: string; line?: number } = node;
      if (node.alternatives && node.alternatives.length > 1) {
        const pick = await vscode.window.showQuickPick(
          node.alternatives.map(a => ({ label: a.file.split('/').pop() ?? a.file, description: vscode.Uri.parse(a.file).path, alt: a })),
          { placeHolder: `${node.route} is declared in ${node.alternatives.length} files` },
        );
        if (!pick) return;
        target = pick.alt;
      }
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(target.file));
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      const pos = new vscode.Position(Math.min(target.line ?? 0, doc.lineCount - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    });
  }
}

// ── SVG rendering ───────────────────────────────────────────────────────────

const NODE_W = 190;
const NODE_H = 44;
const GAP_X = 70;
const GAP_Y = 26;

function layerNodes(nav: MergedNavigation): Map<string, number> {
  const layers = new Map<string, number>();
  const queue: { route: string; depth: number }[] = nav.startDestinations
    .filter(s => nav.nodes.some(n => n.route === s))
    .map(s => ({ route: s, depth: 0 }));

  while (queue.length > 0) {
    const { route, depth } = queue.shift()!;
    if (layers.has(route)) continue;
    layers.set(route, depth);
    for (const e of nav.edges.filter(x => x.from === route)) {
      queue.push({ route: e.to, depth: depth + 1 });
    }
  }
  // Unreached (orphans, dynamic routes): last column.
  const maxDepth = Math.max(0, ...layers.values()) + 1;
  for (const n of nav.nodes) {
    if (!layers.has(n.route)) layers.set(n.route, maxDepth);
  }
  return layers;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function renderHtml(nav: MergedNavigation): string {
  const orphans = new Set(findOrphans(nav));
  const deepLinked = new Set(nav.deepLinks.map(d => d.route));
  const layers = layerNodes(nav);

  const byLayer = new Map<number, FileNode[]>();
  for (const n of nav.nodes) {
    const l = layers.get(n.route) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(n);
  }

  const pos = new Map<string, { x: number; y: number }>();
  for (const [layer, list] of byLayer) {
    list.forEach((n, i) => {
      pos.set(n.route, {
        x: 30 + layer * (NODE_W + GAP_X),
        y: 30 + i * (NODE_H + GAP_Y),
      });
    });
  }

  const width = 60 + (Math.max(0, ...byLayer.keys()) + 1) * (NODE_W + GAP_X);
  const height =
    60 + Math.max(1, ...[...byLayer.values()].map(l => l.length)) * (NODE_H + GAP_Y);

  const arrows = nav.edges
    .map(e => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return '';
      return `<line x1="${a.x + NODE_W}" y1="${a.y + NODE_H / 2}" x2="${b.x - 4}" y2="${
        b.y + NODE_H / 2
      }" stroke="var(--vscode-editorLineNumber-foreground)" marker-end="url(#arr)"/>`;
    })
    .join('');

  const boxes = nav.nodes
    .map(n => {
      const p = pos.get(n.route)!;
      const stroke = orphans.has(n.route)
        ? 'var(--vscode-editorError-foreground)'
        : 'var(--vscode-focusBorder)';
      const dash = n.dynamic ? 'stroke-dasharray="5,4"' : '';
      const label = n.dynamic ? 'dynamic route' : n.route;
      const badge = deepLinked.has(n.route) ? ' 🔗' : '';
      const sub = n.composable ? `<tspan x="${p.x + 10}" dy="16" fill-opacity="0.65">${esc(n.composable)}</tspan>` : '';
      return `<g class="node" data-route="${esc(n.route)}">
        <rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="7"
          fill="var(--vscode-editorWidget-background)" stroke="${stroke}" ${dash}/>
        <text x="${p.x + 10}" y="${p.y + 18}" fill="var(--vscode-foreground)"
          font-size="12" font-family="var(--vscode-editor-font-family)">${esc(label)}${badge}${sub}</text>
      </g>`;
    })
    .join('');

  const legend = `${nav.nodes.length} screens · ${nav.edges.length} navigations · ${
    nav.deepLinks.length
  } deeplinks · ${orphans.size} orphan(s)${nav.truncated ? ` · only the first ${MAX_KT_FILES} Kotlin files were read` : ''}`;

  return `<!DOCTYPE html><html><body style="margin:0;padding:10px;overflow:auto;">
    <div style="font:12px var(--vscode-font-family);opacity:.75;margin-bottom:8px;">${esc(legend)} · click a screen to jump to the code</div>
    <svg width="${width}" height="${height}">
      <defs><marker id="arr" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto">
        <path d="M0,0 L8,3 L0,6 z" fill="var(--vscode-editorLineNumber-foreground)"/>
      </marker></defs>
      ${arrows}${boxes}
    </svg>
    <script>
      const vscode = acquireVsCodeApi();
      for (const g of document.querySelectorAll('.node')) {
        g.style.cursor = 'pointer';
        g.addEventListener('click', () =>
          vscode.postMessage({ type: 'jump', route: g.dataset.route }));
      }
    </script>
  </body></html>`;
}
