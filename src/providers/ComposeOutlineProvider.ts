import * as vscode from 'vscode';

/**
 * KJ-015: Compose Outline Tree, the structure of a screen without rendering it.
 * The tree is the nesting of call-site lambdas (Column { … }) plus the
 * expansion of local composable definitions; if/when branches are labelled,
 * loops are flagged, recursions are cut.
 */

export interface OutlineNode {
  name: string;
  children: OutlineNode[];
  branch?: string;
  loop?: boolean;
  cycle?: boolean;
  /** Nesting level from the root composable; drives the default expansion. */
  depth?: number;
}

/** Levels expanded by default in the tree view. Beyond that, the structure
 *  (branches, loops, recursion) drowns in leaf Text/Icon rows: the sidebar
 *  gives the view a handful of rows, they must carry the signal. */
export const DEFAULT_EXPANDED_DEPTH = 2;

const LOOP_FNS = new Set(['forEach', 'forEachIndexed', 'map', 'items', 'itemsIndexed', 'repeat']);
const DEFAULT_MAX_DEPTH = 8;

function matchBalanced(text: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** name → body (content between braces) of each local @Composable. */
export function extractComposableDefs(text: string): Map<string, string> {
  const defs = new Map<string, string>();
  // Unbounded lazy match: between @Composable and its fun there is only KDoc,
  // annotations and modifiers. A fixed window missed long KDoc blocks.
  const re = /@Composable[\s\S]*?\bfun\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = matchBalanced(text, parenOpen, '(', ')');
    if (parenClose < 0) continue;
    let j = parenClose + 1;
    while (j < text.length && text[j] !== '{' && text[j] !== '\n' && text[j] !== '=') j++;
    if (text[j] !== '{') continue;
    const bodyEnd = matchBalanced(text, j, '{', '}');
    if (bodyEnd < 0) continue;
    if (!defs.has(m[1])) defs.set(m[1], text.slice(j + 1, bodyEnd));
    re.lastIndex = parenClose;
  }
  return defs;
}

interface Ctx {
  branch?: string;
  loop?: boolean;
}

export function buildOutline(
  text: string,
  rootComposable: string,
  maxDepth: number = DEFAULT_MAX_DEPTH,
): OutlineNode {
  const defs = extractComposableDefs(text);
  const rootBody = defs.get(rootComposable) ?? '';

  const parseBody = (body: string, depth: number, stack: string[], ctx: Ctx): OutlineNode[] => {
    if (depth > maxDepth) return [];
    const nodes: OutlineNode[] = [];
    let i = 0;

    const KEYWORDS = new Set([
      'if', 'when', 'for', 'while', 'do', 'else', 'try', 'catch', 'finally',
      'fun', 'object', 'init',
    ]);

    while (i < body.length) {
      const rest = body.slice(i);

      const ifM = /(?<![\w.])if\s*\(/.exec(rest);
      const whenM = /(?<![\w.])when\s*(\([^)]*\))?\s*\{/.exec(rest);
      const forM = /(?<![\w.])for\s*\(/.exec(rest);
      // Call with parens: Name(...), with an optional trailing lambda after.
      const callM = /(?<![\w.@])([A-Za-z_]\w*)\s*\(/.exec(rest);
      // Call WITHOUT parens: Column { … }, team.forEach { … }. A dotted
      // receiver is allowed, the captured NAME is the last segment.
      let braceM: RegExpExecArray | null = null;
      const braceRe = /(?<![\w@])(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\{/g;
      let bm: RegExpExecArray | null;
      while ((bm = braceRe.exec(rest)) !== null) {
        if (!KEYWORDS.has(bm[1])) { braceM = bm; break; }
      }

      const candidates = [
        ifM ? { kind: 'if' as const, at: ifM.index } : null,
        whenM ? { kind: 'when' as const, at: whenM.index } : null,
        forM ? { kind: 'for' as const, at: forM.index } : null,
        callM ? { kind: 'call' as const, at: callM.index, m: callM } : null,
        braceM ? { kind: 'brace' as const, at: braceM.index, m: braceM } : null,
      ].filter(Boolean) as {
        kind: 'if' | 'when' | 'for' | 'call' | 'brace';
        at: number;
        m?: RegExpExecArray;
      }[];

      if (candidates.length === 0) break;
      // Handle the nearest construct.
      candidates.sort((a, b) => a.at - b.at);
      const c = candidates[0];

      if (c.kind === 'if') {
        const condOpen = i + rest.indexOf('if', c.at) + 2 + (rest.slice(rest.indexOf('if', c.at) + 2).indexOf('('));
        const condOpenAbs = body.indexOf('(', i + c.at);
        const condClose = matchBalanced(body, condOpenAbs, '(', ')');
        const cond = body.slice(condOpenAbs + 1, condClose);
        let j = condClose + 1;
        while (j < body.length && /\s/.test(body[j])) j++;
        if (body[j] === '{') {
          const blockEnd = matchBalanced(body, j, '{', '}');
          nodes.push(...parseBody(body.slice(j + 1, blockEnd), depth, stack, { ...ctx, branch: `if (${cond.trim()})` }));
          let k = blockEnd + 1;
          const elseM = /^\s*else\s*\{/.exec(body.slice(k));
          if (elseM) {
            const elseOpen = k + elseM[0].length - 1;
            const elseEnd = matchBalanced(body, elseOpen, '{', '}');
            nodes.push(...parseBody(body.slice(elseOpen + 1, elseEnd), depth, stack, { ...ctx, branch: 'else' }));
            i = elseEnd + 1;
          } else {
            i = k;
          }
        } else {
          i = condClose + 1;
        }
        void condOpen;
        continue;
      }

      if (c.kind === 'when') {
        const braceOpen = body.indexOf('{', i + c.at);
        const braceEnd = matchBalanced(body, braceOpen, '{', '}');
        nodes.push(...parseBody(body.slice(braceOpen + 1, braceEnd), depth, stack, { ...ctx, branch: ctx.branch ?? 'when' }));
        i = braceEnd + 1;
        continue;
      }

      if (c.kind === 'for') {
        const parenOpen = body.indexOf('(', i + c.at);
        const parenClose = matchBalanced(body, parenOpen, '(', ')');
        let j = parenClose + 1;
        while (j < body.length && /\s/.test(body[j])) j++;
        if (body[j] === '{') {
          const blockEnd = matchBalanced(body, j, '{', '}');
          nodes.push(...parseBody(body.slice(j + 1, blockEnd), depth, stack, { ...ctx, loop: true }));
          i = blockEnd + 1;
        } else {
          i = parenClose + 1;
        }
        continue;
      }

      if (c.kind === 'brace') {
        const m = c.m!;
        const name = m[1];
        const braceOpen = i + m.index + m[0].lastIndexOf('{');
        const braceEnd = matchBalanced(body, braceOpen, '{', '}');
        if (braceEnd < 0) break;
        const content = body.slice(braceOpen + 1, braceEnd);

        if (/^[A-Z]/.test(name)) {
          const node: OutlineNode = { name, children: [], depth };
          if (ctx.branch) node.branch = ctx.branch;
          if (ctx.loop) node.loop = true;
          node.children.push(...parseBody(content, depth + 1, stack, {}));
          if (defs.has(name)) {
            if (stack.includes(name)) node.cycle = true;
            else if (depth < maxDepth) {
              node.children.push(...parseBody(defs.get(name)!, depth + 1, [...stack, name], {}));
            }
          }
          nodes.push(node);
        } else {
          nodes.push(
            ...parseBody(content, depth, stack, {
              ...ctx,
              loop: ctx.loop || LOOP_FNS.has(name),
            }),
          );
        }
        i = braceEnd + 1;
        continue;
      }

      // call
      const m = c.m!;
      const name = m[1];
      const nameIndex = i + m.index + m[0].indexOf(name);
      const parenOpen = i + m.index + m[0].length - 1;
      const parenClose = matchBalanced(body, parenOpen, '(', ')');
      if (parenClose < 0) break;

      let after = parenClose + 1;
      while (after < body.length && /[ \t]/.test(body[after])) after++;
      let lambdaContent: string | null = null;
      let end = parenClose + 1;
      if (body[after] === '{') {
        const lambdaEnd = matchBalanced(body, after, '{', '}');
        lambdaContent = body.slice(after + 1, lambdaEnd);
        end = lambdaEnd + 1;
      }

      const isComposableCall = /^[A-Z]/.test(name) && name !== 'R';
      if (isComposableCall) {
        const node: OutlineNode = { name, children: [], depth };
        if (ctx.branch) node.branch = ctx.branch;
        if (ctx.loop) node.loop = true;

        if (lambdaContent !== null) {
          node.children.push(...parseBody(lambdaContent, depth + 1, stack, {}));
        }
        if (defs.has(name)) {
          if (stack.includes(name)) {
            node.cycle = true;
          } else if (depth < maxDepth) {
            node.children.push(...parseBody(defs.get(name)!, depth + 1, [...stack, name], {}));
          }
        }
        nodes.push(node);
      } else if (lambdaContent !== null) {
        // lowercase call with a lambda: content is lifted up (forEach → loop).
        nodes.push(
          ...parseBody(lambdaContent, depth, stack, {
            ...ctx,
            loop: ctx.loop || LOOP_FNS.has(name),
          }),
        );
      }
      i = end;
      void nameIndex;
    }
    return nodes;
  };

  return {
    name: rootComposable,
    children: parseBody(rootBody, 1, [rootComposable], {}),
    depth: 0,
  };
}

export class ComposeOutlineProvider implements vscode.TreeDataProvider<OutlineNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private _root: OutlineNode | undefined;

  refreshFromEditor(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.languageId !== 'kotlin') return;
    const enabled = vscode.workspace
      .getConfiguration('kotlinJump')
      .get<boolean>('composeOutline', true);
    if (!enabled) return;

    const text = editor.document.getText();
    const line = editor.selection.active.line;
    // Composable enclosing the cursor: last @Composable declaration above it.
    const lines = text.split('\n').slice(0, line + 1);
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = /\bfun\s+([A-Z]\w*)\s*\(/.exec(lines[i]);
      if (m && extractComposableDefs(text).has(m[1])) {
        this._root = buildOutline(text, m[1]);
        this._onDidChange.fire();
        return;
      }
    }
  }

  getTreeItem(node: OutlineNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      node.name,
      node.children.length === 0
        ? vscode.TreeItemCollapsibleState.None
        : (node.depth ?? 0) < DEFAULT_EXPANDED_DEPTH
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
    );
    const tags = [
      node.branch ? `⑂ ${node.branch}` : '',
      node.loop ? '×items' : '',
      node.cycle ? '↺' : '',
    ].filter(Boolean);
    item.description = tags.join(' ');
    return item;
  }

  getChildren(node?: OutlineNode): OutlineNode[] {
    if (!node) return this._root ? [this._root] : [];
    return node.children;
  }

  /** Required by TreeView.reveal (demos scroll down to the ×items / cycle
   *  markers at the bottom of the tree). Works by top-down search: nodes
   *  keep no parent link. */
  getParent(node: OutlineNode): OutlineNode | undefined {
    const walk = (candidate: OutlineNode): OutlineNode | undefined => {
      if (candidate.children.includes(node)) return candidate;
      for (const child of candidate.children) {
        const found = walk(child);
        if (found) return found;
      }
      return undefined;
    };
    return this._root && this._root !== node ? walk(this._root) : undefined;
  }

  /** Deepest descendant of the last branch: the demos' scroll target.
   *  Revealing it makes TreeView.reveal expand the ancestors and bring the
   *  end-of-tree ×items / cycle markers on screen. */
  tailNode(): OutlineNode | undefined {
    let node = this._root;
    for (let hops = 0; hops < 4 && node && node.children.length > 0; hops++) {
      node = node.children[node.children.length - 1];
    }
    return node;
  }

  /** Snapshot of the current tree, probed by the demos and the tests: lets us
   *  check the view REALLY has content before announcing the result. */
  snapshot(): OutlineNode[] {
    return this._root ? [this._root] : [];
  }
}
