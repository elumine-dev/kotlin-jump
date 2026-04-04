// No vscode import — this module runs in Node.js worker threads too
import { Parser, Language, Node } from 'web-tree-sitter';
import * as path from 'path';
import type { ParsedFile, RawSymbol, SymbolKind } from './KotlinParser';

// ── Singleton state (one per worker thread) ───────────────────────────────────
let tsParser: Parser | null = null;
let wasmReady  = false;
let wasmFailed = false;

export function isWasmReady(): boolean {
  return wasmReady;
}

export async function initWasm(distDir: string): Promise<void> {
  if (wasmReady || wasmFailed) return;
  try {
    await Parser.init({
      locateFile: (f: string) => path.join(distDir, f),
    });
    const lang = await Language.load(path.join(distDir, 'tree-sitter-kotlin.wasm'));
    tsParser = new Parser();
    tsParser.setLanguage(lang);
    wasmReady = true;
  } catch (e) {
    console.error('[kotlin-nav] WASM init failed:', e);
    wasmFailed = true;
  }
}

// ── Public parse entry point ──────────────────────────────────────────────────

export function parseWasm(uriString: string, text: string): ParsedFile {
  if (!tsParser) throw new Error('[kotlin-nav] parseWasm called before successful initWasm()');
  const tree = tsParser.parse(text);
  try {
    return extractFromTree(uriString, text, tree.rootNode);
  } finally {
    tree.delete(); // free WASM heap — no GC in WASM
  }
}

// ── Core extraction ───────────────────────────────────────────────────────────

function extractFromTree(uriString: string, text: string, root: Node): ParsedFile {
  const symbols: RawSymbol[] = [];
  let packageName = '';
  const imports: string[] = [];

  for (const node of root.namedChildren) {
    if (node.type === 'package_header') {
      const ident = node.namedChildren.find(c => c.type === 'identifier');
      if (ident) packageName = ident.text;
    } else if (node.type === 'import_list') {
      for (const imp of node.namedChildren) {
        if (imp.type === 'import_header') {
          const ident = imp.namedChildren.find(c => c.type === 'identifier');
          if (ident) {
            const hasWildcard = imp.namedChildren.some(c => c.type === 'wildcard_import');
            imports.push(hasWildcard ? ident.text + '.*' : ident.text);
          }
        }
      }
    } else {
      visitNode(node, symbols, 0);
    }
  }

  // tree-sitter-kotlin grammar doesn't support `fun interface` — patch from ERROR nodes
  if (text.includes('fun interface')) {
    findFunInterfaceErrors(root, symbols);
  }

  return { uriString, packageName, imports, symbols };
}

// ── Tree visitor ──────────────────────────────────────────────────────────────

function visitNode(node: Node, symbols: RawSymbol[], depth: number): void {
  switch (node.type) {
    case 'class_declaration':   pushClass(node, symbols, depth);    break;
    case 'object_declaration':  pushObject(node, symbols, depth);   break;
    case 'companion_object':    pushCompanion(node, symbols, depth); break;
    case 'function_declaration':
      // tree-sitter-kotlin misparsing of `fun interface Name {...}`:
      // produces function_declaration with user_type{interface} receiver + ERROR{Name} child
      if (isFunInterfaceMisparse(node)) pushFunInterfaceFromFnDecl(node, symbols, depth);
      else pushFunction(node, symbols, depth);
      break;
    case 'property_declaration':pushProperty(node, symbols, depth);  break;
    case 'type_alias':          pushTypeAlias(node, symbols, depth); break;
    case 'enum_entry':          pushEnumEntry(node, symbols, depth); break;
    case 'statements':
      for (const child of node.namedChildren) visitNode(child, symbols, depth);
      break;
    // All other node types (expressions, control flow, etc.) are skipped
    default: break;
  }
}

function visitChildren(node: Node, symbols: RawSymbol[], depth: number): void {
  for (const child of node.namedChildren) visitNode(child, symbols, depth);
}

// ── Declaration handlers ──────────────────────────────────────────────────────

function pushClass(node: Node, symbols: RawSymbol[], depth: number): void {
  const nameNode = node.namedChildren.find(c => c.type === 'type_identifier');
  if (!nameNode) return;

  const kind      = classKind(node);
  const modsNode  = node.namedChildren.find(c => c.type === 'modifiers');
  const modFlags  = extractModifierFlags(modsNode);

  symbols.push({
    name: nameNode.text,
    kind,
    line: nameNode.startPosition.row,
    character: nameNode.startPosition.column,
    isComposable: false,
    depth,
    supertypes: getSupertypes(node),
    isAbstract:      modFlags.isAbstract || undefined,
    isHiltViewModel: modFlags.isHiltViewModel || undefined,
  });

  // Primary constructor val/var parameters → class members at depth+1
  const ctor = node.namedChildren.find(c => c.type === 'primary_constructor');
  if (ctor) {
    for (const param of ctor.namedChildren) {
      if (param.type !== 'class_parameter') continue;
      const bpk = param.namedChildren.find(c => c.type === 'binding_pattern_kind');
      if (!bpk) continue; // no val/var — plain constructor param
      const pName = param.namedChildren.find(c => c.type === 'simple_identifier');
      if (!pName) continue;
      symbols.push({
        name: pName.text,
        kind: bpk.text === 'val' ? 'val' : 'var',
        line: pName.startPosition.row,
        character: pName.startPosition.column,
        isComposable: false,
        depth: depth + 1,
      });
    }
  }

  // Recurse into body
  if (kind === 'enum') {
    const body = node.namedChildren.find(c => c.type === 'enum_class_body');
    if (body) {
      for (const child of body.namedChildren) {
        if (child.type === 'enum_entry') pushEnumEntry(child, symbols, depth + 1);
        else visitNode(child, symbols, depth + 1);
      }
    }
  } else {
    const body = node.namedChildren.find(c => c.type === 'class_body');
    if (body) visitChildren(body, symbols, depth + 1);
  }
}

function pushObject(node: Node, symbols: RawSymbol[], depth: number): void {
  const nameNode = node.namedChildren.find(c => c.type === 'type_identifier');
  if (!nameNode) return;
  symbols.push({
    name: nameNode.text,
    kind: 'object',
    line: nameNode.startPosition.row,
    character: nameNode.startPosition.column,
    isComposable: false,
    depth,
    supertypes: getSupertypes(node),
  });
  const body = node.namedChildren.find(c => c.type === 'class_body');
  if (body) visitChildren(body, symbols, depth + 1);
}

function pushCompanion(node: Node, symbols: RawSymbol[], depth: number): void {
  // Named companion object → emit as object; anonymous → skip but still recurse
  const nameNode = node.namedChildren.find(c => c.type === 'type_identifier');
  if (nameNode) {
    symbols.push({
      name: nameNode.text,
      kind: 'object',
      line: nameNode.startPosition.row,
      character: nameNode.startPosition.column,
      isComposable: false,
      depth,
      supertypes: getSupertypes(node),
    });
  }
  const body = node.namedChildren.find(c => c.type === 'class_body');
  if (body) visitChildren(body, symbols, depth + 1);
}

function pushFunction(node: Node, symbols: RawSymbol[], depth: number): void {
  const nameNode = node.namedChildren.find(c => c.type === 'simple_identifier');
  if (!nameNode) return;

  const modsNode = node.namedChildren.find(c => c.type === 'modifiers');
  const flags    = extractModifierFlags(modsNode);

  // Extension function: a type node appears before the simple_identifier
  const nameIdx    = node.namedChildren.indexOf(nameNode);
  const isExtension = node.namedChildren
    .slice(0, nameIdx)
    .some(c => c.type === 'user_type' || c.type === 'nullable_type' || c.type === 'parenthesized_type');

  symbols.push({
    name: nameNode.text,
    kind: flags.isComposable ? 'composable' : 'fun',
    line: nameNode.startPosition.row,
    character: nameNode.startPosition.column,
    isComposable: flags.isComposable,
    depth,
    isSuspend:  flags.isSuspend  || undefined,
    isAbstract: flags.isAbstract || undefined,
    isInline:   flags.isInline   || undefined,
    isInfix:    flags.isInfix    || undefined,
    isExtension: isExtension     || undefined,
    isOperator: flags.isOperator || undefined,
    isOverride: flags.isOverride || undefined,
    isPreview:  flags.isPreview  || undefined,
  });

  // Recurse into function body to index local val/var declarations
  const body = node.namedChildren.find(c => c.type === 'function_body');
  if (body) visitChildren(body, symbols, depth + 1);
}

function pushProperty(node: Node, symbols: RawSymbol[], depth: number): void {
  const bpk = node.namedChildren.find(c => c.type === 'binding_pattern_kind');
  if (!bpk) return;
  const varDecl = node.namedChildren.find(c => c.type === 'variable_declaration');
  if (!varDecl) return;
  const nameNode = varDecl.namedChildren.find(c => c.type === 'simple_identifier');
  if (!nameNode) return;

  const modsNode = node.namedChildren.find(c => c.type === 'modifiers');
  const flags    = extractModifierFlags(modsNode);

  symbols.push({
    name: nameNode.text,
    kind: bpk.text === 'val' ? 'val' : 'var',
    line: nameNode.startPosition.row,
    character: nameNode.startPosition.column,
    isComposable: false,
    depth,
    isConst:    flags.isConst    || undefined,
    isAbstract: flags.isAbstract || undefined,
    isLateinit: flags.isLateinit || undefined,
    isOverride: flags.isOverride || undefined,
  });
}

function pushTypeAlias(node: Node, symbols: RawSymbol[], depth: number): void {
  const nameNode = node.namedChildren.find(c => c.type === 'type_identifier');
  if (!nameNode) return;
  const eq = node.text.indexOf('=');
  const aliasTarget = eq !== -1 ? node.text.slice(eq + 1).trim() : undefined;
  symbols.push({
    name: nameNode.text,
    kind: 'typealias',
    line: nameNode.startPosition.row,
    character: nameNode.startPosition.column,
    isComposable: false,
    depth,
    aliasTarget,
  });
}

function pushEnumEntry(node: Node, symbols: RawSymbol[], depth: number): void {
  const nameNode = node.namedChildren.find(c => c.type === 'simple_identifier');
  if (!nameNode) return;
  symbols.push({
    name: nameNode.text,
    kind: 'enum',
    line: nameNode.startPosition.row,
    character: nameNode.startPosition.column,
    isComposable: false,
    depth,
  });
}

function isFunInterfaceMisparse(node: Node): boolean {
  // Detects: function_declaration whose receiver type_identifier text is "interface"
  // and which has an ERROR child — the grammar's misparse of `fun interface Name`
  const receiverType = node.namedChildren.find(c => c.type === 'user_type');
  if (!receiverType) return false;
  const typeId = receiverType.namedChildren.find(c => c.type === 'type_identifier');
  if (typeId?.text !== 'interface') return false;
  return node.namedChildren.some(c => c.isError);
}

function pushFunInterfaceFromFnDecl(node: Node, symbols: RawSymbol[], depth: number): void {
  const errorChild = node.namedChildren.find(c => c.isError);
  const nameNode   = errorChild?.namedChildren.find(c => c.type === 'simple_identifier');
  if (!nameNode) return;
  symbols.push({
    name: nameNode.text,
    kind: 'interface',
    line: node.startPosition.row,
    character: nameNode.startPosition.column,
    isComposable: false,
    depth,
  });
}

// ── fun interface fallback (ERROR node patching) ──────────────────────────────

function findFunInterfaceErrors(node: Node, symbols: RawSymbol[]): void {
  if (node.isError) {
    // fun interface pattern: ERROR has anonymous 'fun' child,
    // then user_type child with type_identifier "interface", then simple_identifier (name)
    const hasFunKeyword = node.children.some(c => !c.isNamed && c.type === 'fun');
    const hasInterfaceType = node.namedChildren.some(
      c => c.type === 'user_type' &&
           c.namedChildren.some(cc => cc.type === 'type_identifier' && cc.text === 'interface'),
    );
    if (hasFunKeyword && hasInterfaceType) {
      const nameNode = node.namedChildren.find(c => c.type === 'simple_identifier');
      if (nameNode) {
        const depth = ancestorBodyCount(node);
        const alreadyIndexed = symbols.some(
          s => s.name === nameNode.text && s.kind === 'interface' && s.line === node.startPosition.row,
        );
        if (!alreadyIndexed) {
          symbols.push({
            name: nameNode.text,
            kind: 'interface',
            line: node.startPosition.row,
            character: nameNode.startPosition.column,
            isComposable: false,
            depth,
          });
        }
      }
    }
    return; // don't recurse into error nodes
  }

  if (node.hasError) {
    for (const child of node.namedChildren) findFunInterfaceErrors(child, symbols);
  }
}

// Count body-level ancestors to determine nesting depth — mirrors the depth
// increments in visitNode (class_body, enum_class_body, function_body all add 1).
function ancestorBodyCount(node: Node): number {
  let depth = 0;
  let cur = node.parent;
  while (cur !== null) {
    if (cur.type === 'class_body' || cur.type === 'enum_class_body' || cur.type === 'function_body') depth++;
    cur = cur.parent;
  }
  return depth;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function classKind(node: Node): SymbolKind {
  // Enum: signaled by enum_class_body, not a modifier
  if (node.namedChildren.some(c => c.type === 'enum_class_body')) return 'enum';

  const modsNode = node.namedChildren.find(c => c.type === 'modifiers');
  const classModTexts = modsNode
    ? modsNode.namedChildren
        .filter(c => c.type === 'class_modifier')
        .map(c => c.text)
    : [];

  if (classModTexts.includes('sealed'))     return 'sealedClass';
  if (classModTexts.includes('annotation')) return 'annotation';

  // interface keyword is anonymous (unnamed) child
  const isInterface = node.children.some(c => !c.isNamed && c.type === 'interface');
  if (isInterface) return 'interface';

  if (classModTexts.includes('data')) return 'dataClass';

  return 'class';
}

function getSupertypes(node: Node): string[] | undefined {
  const types: string[] = [];
  for (const child of node.namedChildren) {
    if (child.type !== 'delegation_specifier') continue;
    const name = extractSupertypeName(child);
    if (name) types.push(name);
  }
  return types.length > 0 ? types : undefined;
}

// Extracts the class name from a delegation_specifier node.
// For qualified names like Outer.Inner, user_type has multiple direct type_identifier children;
// we take the LAST one so `Outer.Inner` → `"Inner"`, not `"Outer"`.
// type_arguments children are a different node type, so generic params are never included.
function extractSupertypeName(delegationSpec: Node): string | undefined {
  let userType: Node | undefined;
  for (const child of delegationSpec.namedChildren) {
    if (child.type === 'user_type') { userType = child; break; }
    if (child.type === 'constructor_invocation') {
      userType = child.namedChildren.find(c => c.type === 'user_type');
      break;
    }
  }
  if (!userType) return undefined;

  // Direct type_identifier children = the qualified name segments (no type args mixed in)
  const directTypeIds = userType.namedChildren.filter(c => c.type === 'type_identifier');
  if (directTypeIds.length > 0) return directTypeIds[directTypeIds.length - 1].text;

  // Fallback: grammar may use simple_user_type wrappers — take the last one's type_identifier
  const simpleTypes = userType.namedChildren.filter(c => c.type === 'simple_user_type');
  if (simpleTypes.length > 0) {
    return simpleTypes[simpleTypes.length - 1].namedChildren.find(c => c.type === 'type_identifier')?.text;
  }

  return undefined;
}

interface ModFlags {
  isComposable:    boolean;
  isPreview:       boolean;
  isHiltViewModel: boolean;
  isSuspend:       boolean;
  isAbstract:      boolean;
  isInline:        boolean;
  isInfix:         boolean;
  isOperator:      boolean;
  isOverride:      boolean;
  isLateinit:      boolean;
  isConst:         boolean;
}

function extractModifierFlags(modsNode: Node | undefined): ModFlags {
  const f: ModFlags = {
    isComposable: false, isPreview: false, isHiltViewModel: false,
    isSuspend: false, isAbstract: false, isInline: false, isInfix: false,
    isOperator: false, isOverride: false, isLateinit: false, isConst: false,
  };
  if (!modsNode) return f;

  for (const mod of modsNode.namedChildren) {
    switch (mod.type) {
      case 'annotation': {
        const name = annotationName(mod);
        if (name === 'Composable')    f.isComposable = true;
        if (name === 'Preview')       f.isPreview = true;
        if (name === 'HiltViewModel') f.isHiltViewModel = true;
        break;
      }
      case 'function_modifier':
        if (mod.text === 'suspend')  f.isSuspend = true;
        if (mod.text === 'inline')   f.isInline = true;
        if (mod.text === 'infix')    f.isInfix = true;
        if (mod.text === 'operator') f.isOperator = true;
        break;
      case 'member_modifier':
        if (mod.text === 'override') f.isOverride = true;
        if (mod.text === 'lateinit') f.isLateinit = true;
        break;
      case 'inheritance_modifier':
        if (mod.text === 'abstract') f.isAbstract = true;
        break;
      case 'property_modifier':
        if (mod.text === 'const') f.isConst = true;
        break;
    }
  }
  return f;
}

// Annotation names: two shapes:
//   @Foo           → annotation > user_type > type_identifier "Foo"
//   @Foo(args)     → annotation > constructor_invocation > user_type > type_identifier "Foo"
function annotationName(annotNode: Node): string {
  for (const child of annotNode.namedChildren) {
    if (child.type === 'user_type') {
      return child.namedChildren.find(c => c.type === 'type_identifier')?.text ?? '';
    }
    if (child.type === 'constructor_invocation') {
      const ut = child.namedChildren.find(c => c.type === 'user_type');
      return ut?.namedChildren.find(c => c.type === 'type_identifier')?.text ?? '';
    }
  }
  return '';
}
