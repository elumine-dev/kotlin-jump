import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { Position, Range } from './__mocks__/vscode';
import { surroundSelection } from '../../src/providers/SurroundWithProvider';
import { ExpiredTodoActionProvider } from '../../src/providers/DiscoverabilityQuickFixes';
import { extractTemplateArgs, literalAtPosition, isComposableContext, buildReplacement, isResIdSetterArgument, insideHandlerLambda, escapeForStringsXml } from '../../src/providers/ExtractStringResourceProvider';
import { computeSeparatorLines } from '../../src/providers/MethodSeparatorProvider';
import { analyzeDispatcherScopes } from '../../src/providers/DispatcherLensProvider';
import { analyzeStateProvenance } from '../../src/providers/StateProvenanceProvider';
import { ConstValFoldingProvider } from '../../src/providers/ConstValFoldingProvider';
import { KmpExpectActualProvider } from '../../src/providers/KmpExpectActualProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';

// Audit 20 : décorations, lenses et quick fixes inline.

afterEach(() => vi.restoreAllMocks());

describe('Surround with', () => {
  it('échappe $ et \\ de la sélection pour le snippet', () => {
    expect(surroundSelection('let', 'println("surround me: $name $total")', '')).toBe('println("surround me: \\$name \\$total").let { $0 }');
    expect(surroundSelection('if', 'Regex("\\\\d+")', '')).toBe('if ($1) {\n    Regex("\\\\\\\\d+")\n}');
    expect(surroundSelection('run', 'val a = 1\nval b = "$a"', '')).toBe('run {\n    val a = 1\n    val b = "\\$a"\n}');
  });
});

describe('Quick fix « Remove expired TODO »', () => {
  const fix = (lines: string[], line: number) => {
    const doc = mockDocument('file:///T.kt', lines.join('\n'));
    const actions = new ExpiredTodoActionProvider().provideCodeActions(doc, new Range(line, 0, line, 0));
    if (actions.length === 0) return null;
    const entries = (actions[0].edit as any).entries();
    const e = entries[0];
    const text = lines[e.range.start.line];
    if (e.range.end.line > e.range.start.line) return { deletedLine: true };
    return { result: text.slice(0, e.range.start.character) + text.slice(e.range.end.character) };
  };

  it('coupe le commentaire, pas l\'URL ni la chaîne', () => {
    expect(fix(['val url = "http://x.io" // TODO(2020-01-01): move'], 0)).toEqual({ result: 'val url = "http://x.io"' });
    expect(fix(['val y = 1 /* TODO(2020-01-01) */'], 0)).toEqual({ result: 'val y = 1' });
    expect(fix(['// TODO(2020-01-01): drop me'], 0)).toEqual({ deletedLine: true });
  });

  it('ne s\'offre ni dans une chaîne ni pour un TODO daté d\'aujourd\'hui', () => {
    expect(fix(['val a = 1 // note', 'val s = "TODO(2020-01-01)"'], 1)).toBeNull();
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(fix([`// TODO(${iso}): today`], 0)).toBeNull();
  });
});

describe('Extract string resource', () => {
  it('$100 est un littéral, % est doublé avec des arguments, @ initial échappé', () => {
    expect(extractTemplateArgs('Price: $100')).toEqual({ xmlValue: 'Price: $100', args: [] });
    expect(extractTemplateArgs('$pct% done')).toEqual({ xmlValue: '%1$s%% done', args: ['pct'] });
    expect(extractTemplateArgs('Hello ${user.name}')).toEqual({ xmlValue: 'Hello %1$s', args: ['user.name'] });
    expect(escapeForStringsXml('@home')).toBe('\\@home');
    expect(escapeForStringsXml('50% off & more')).toBe('50% off &amp; more');
  });

  it('un template avec des guillemets imbriqués est lu en entier', () => {
    const line = 'Text("Hello ${user.name ?: "anon"}")';
    const hit = literalAtPosition(line, 8)!;
    expect(hit.literal).toBe('Hello ${user.name ?: "anon"}');
    expect(line.slice(hit.start, hit.start + hit.length)).toBe('"Hello ${user.name ?: "anon"}"');
  });

  it('contexte composable derrière un @Preview multi-lignes, pas dans une lambda onClick', () => {
    const lines = ['@Composable', '@Preview(', '    showBackground = true', ')', 'fun Foo() {', '    Text("x")', '}'];
    expect(isComposableContext(lines, 5)).toBe(true);
    expect(insideHandlerLambda('    Button(onClick = { showSnackbar("Saved!") }) { Text("Save") }', 27)).toBe(true);
    expect(insideHandlerLambda('    Button(onClick = { showSnackbar("Saved!") }) { Text("Save") }', 54)).toBe(false);
  });

  it('un String attend getString, un setter resId garde l\'id', () => {
    expect(buildReplacement('x', 'hello', 'code', [], false)).toBe('getString(R.string.hello)');
    expect(buildReplacement('x', 'hello', 'code')).toBe('R.string.hello');
    expect(isResIdSetterArgument('    binding.title.setText("Hello")', 26)).toBe(true);
    expect(isResIdSetterArgument('    val s = "Hello"', 12)).toBe(false);
  });
});

describe('Séparateurs de méthodes', () => {
  it('un en-tête de classe multi-lignes (Hilt) et une accolade dans une chaîne', () => {
    const text = [
      'class BattleViewModel @Inject constructor(',
      '    private val repo: Repo,',
      ') : ViewModel() {',
      '    fun a() {',
      '        sb.append("{")',
      '    }',
      '    fun b() = 1',
      '    fun c() = 2',
      '}',
    ].join('\n');
    expect(computeSeparatorLines(text)).toEqual([6, 7]);
  });
});

describe('Dispatcher lens', () => {
  it('viewLifecycleOwner, commentaires et chaînes ne sont pas des accès ; apiKey n\'est pas un appel bloquant', () => {
    const text = [
      'fun load() {',
      '    viewLifecycleOwner.lifecycleScope.launch(Dispatchers.IO) {',
      '        repo.load()',
      '    }',
      '    lifecycleScope.launch(Dispatchers.Main) {',
      '        // TODO: move api.fetch to IO',
      '        val url = "https://api.example.com/v2"',
      '        val n = apiKey.length',
      '        api.fetch()',
      '    }',
      '}',
    ].join('\n');
    const { hints } = analyzeDispatcherScopes(text);
    expect(hints).toEqual([{ line: 8, kind: 'blocking-in-main' }]);
  });
});

describe('Provenance d\'état', () => {
  it('une écriture commentée ne compte pas', () => {
    const vm = 'class Vm : ViewModel() {\n    private val _count = MutableStateFlow(0)\n    val count = _count.asStateFlow()\n    fun inc() {\n        // _count.value = 0 used to be here\n        _count.value = _count.value + 1\n    }\n}';
    const s = analyzeStateProvenance(vm).find(x => x.property === '_count')!;
    expect(s.directWrites).toBe(1);
  });
});

describe('Const val folding', () => {
  function setup() {
    vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.window, 'onDidChangeTextEditorSelection').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(undefined as any);
  }
  function foldTexts(index: SymbolIndex, uri: string, code: string): string[] {
    setup();
    const editor = { document: mockDocument(uri, code), selections: [], setDecorations: vi.fn() } as any;
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
    new ConstValFoldingProvider(index);
    const calls = editor.setDecorations.mock.calls;
    return calls.flatMap((c: any[]) => (c[1] as any[]).map(o => o.renderOptions?.after?.contentText ?? o.renderOptions?.before?.contentText ?? '')).filter(Boolean);
  }

  it('un val local homonyme bloque le repli, un qualificateur étranger aussi', () => {
    const main = 'package p\nclass MainActivity {\n    companion object { const val TAG = "MainActivity" }\n}\nobject Palette { const val RED = 0xFFFF0000 }\n';
    const repo = 'package p\nclass Repo {\n    private val TAG = "Repo"\n    fun f() { Log.d(TAG, "x"); paint(Color.RED); use(Palette.RED) }\n}\n';
    const index = new SymbolIndex();
    index.add(parse('file:///Main.kt', main));
    index.add(parse('file:///Repo.kt', repo));
    index.finalize();
    const texts = foldTexts(index, 'file:///Repo.kt', repo);
    expect(texts.some(t => t.includes('MainActivity'))).toBe(false);
    expect(texts.filter(t => t.includes('0xFFFF0000'))).toHaveLength(1);
  });
});

describe('Badges KMP', () => {
  it('les cibles attendues sont celles du module de l\'expect', () => {
    const index = new SymbolIndex();
    index.add(parse('file:///P/shared/src/commonMain/kotlin/Platform.kt', 'package p\nexpect fun platform(): String\n'));
    index.add(parse('file:///P/shared/src/androidMain/kotlin/Platform.kt', 'package p\nactual fun platform(): String = "a"\n'));
    index.add(parse('file:///P/shared/src/iosMain/kotlin/Platform.kt', 'package p\nactual fun platform(): String = "i"\n'));
    index.add(parse('file:///P/composeApp/src/desktopMain/kotlin/Main.kt', 'package app\nfun main() {}\n'));
    index.add(parse('file:///P/composeApp/src/wasmJsMain/kotlin/Main.kt', 'package app\nfun main() {}\n'));
    index.finalize();
    const doc = mockDocument('file:///P/shared/src/commonMain/kotlin/Platform.kt', 'package p\nexpect fun platform(): String\n');
    const lenses = new KmpExpectActualProvider(index).provideCodeLenses(doc, {} as any) as any[];
    expect(lenses).toHaveLength(1);
    const title = lenses[0].command.title as string;
    expect(title).not.toContain('desktop');
    expect(title).not.toContain('wasmJs');
    expect(title).toContain('android');
    expect(title).toContain('ios');
  });
});
