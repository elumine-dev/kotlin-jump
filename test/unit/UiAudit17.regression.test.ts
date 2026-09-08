import { describe, it, expect } from 'vitest';
import { computeCallSiteEdits } from '../../src/providers/unusedParameters';
import { findUnusedDtoFields } from '../../src/providers/unusedDtoFields';
import { findUnusedEnumEntries } from '../../src/providers/unusedEnumEntries';
import { analyzeDocument } from '../../src/providers/SealedWhenCoverageProvider';
import { missingImportsFor, buildMissingBranchEdit } from '../../src/commands/addMissingWhenBranches';
import { rewriteImports, neededImports } from '../../src/providers/MoveFileProvider';
import { buildOutline } from '../../src/providers/ComposeOutlineProvider';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { mockDocument } from './helpers';

// Audit 17 : actions qui modifient le code ou affichent un diagnostic.

const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest'];
const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (path: string, text: string) => ({ path, text });
let _id = 0;
const fresh = () => `file:///A17_${_id++}.kt`;

function applyEdits(text: string, edits: { start: number; end: number }[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + out.slice(e.end);
  return out;
}

describe('KJ-025 : lambda hors parenthèses', () => {
  it('retirer le dernier paramètre retire la trailing lambda', () => {
    const call = 'fun open() {\n    showDialog("Hi") { println("dismissed") }\n    showDialog("Yo", onDismiss = { })\n}\n';
    const res = computeCallSiteEdits(call, { name: 'onDismiss', paramIndex: 1, paramCount: 2, ownerName: 'showDialog', kind: 'funParam' });
    expect(res.skipped).toBe(0);
    expect(applyEdits(call, res.edits)).toBe('fun open() {\n    showDialog("Hi")\n    showDialog("Yo")\n}\n');
  });

  it('un paramètre qui n\'est pas le dernier laisse la lambda en place', () => {
    const call = 'fun open() { showDialog("Hi", 2) { done() } }\n';
    const res = computeCallSiteEdits(call, { name: 'n', paramIndex: 1, paramCount: 3, ownerName: 'showDialog', kind: 'funParam' });
    expect(applyEdits(call, res.edits)).toBe('fun open() { showDialog("Hi") { done() } }\n');
  });

  it('nombre de paramètres inconnu : le site est signalé, jamais cassé', () => {
    const call = 'fun open() { showDialog("Hi") { done() } }\n';
    const res = computeCallSiteEdits(call, { name: 'onDismiss', paramIndex: 1, ownerName: 'showDialog', kind: 'funParam' });
    expect(res.edits).toEqual([]);
    expect(res.skipped).toBe(1);
  });

  it('le corps d\'une sous-classe (`: Owner(a, b) {`) n\'est pas une lambda', () => {
    const call = 'class Sub : Owner(1, 2) {\n    override fun x() = 1\n}\nval o = object : Owner(1, 2) { }\n';
    const res = computeCallSiteEdits(call, { name: 'cb', paramIndex: 1, paramCount: 2, ownerName: 'Owner', kind: 'ctorParam' });
    expect(applyEdits(call, res.edits)).toBe('class Sub : Owner(1) {\n    override fun x() = 1\n}\nval o = object : Owner(1) { }\n');
  });
});

describe('KJ-044 : virgule finale et corps de requête', () => {
  it('supprimer le dernier champ avec trailing comma ne laisse pas `,,`', () => {
    const dto = f(`${MAIN}/UserResponse.kt`, [
      'package com.x',
      '',
      'data class UserResponse(',
      '    val id: Int,',
      '    val name: String,',
      '    val avatarUrl: String,',
      ')',
    ].join('\n'));
    const reader = f(`${MAIN}/Use.kt`, 'package com.x\n\nfun go(u: UserResponse) = u.id + u.name.length\n');
    const found = findUnusedDtoFields({ sources: [dto, reader], testSourceSets: TEST_SETS });
    expect(found.map(x => x.name)).toEqual(['avatarUrl']);
    const after = dto.text.slice(0, found[0].removeStart) + dto.text.slice(found[0].removeEnd);
    expect(after).toBe('package com.x\n\ndata class UserResponse(\n    val id: Int,\n    val name: String,\n)');
  });

  it('un LoginRequest construit par l\'app n\'est pas « deserialized but never read »', () => {
    const req = f(`${MAIN}/LoginRequest.kt`, 'package com.x\n\ndata class LoginRequest(val email: String, val password: String)\n');
    const use = f(`${MAIN}/Auth.kt`, 'package com.x\n\nfun doLogin(api: Api, mail: String, pwd: String) = api.login(LoginRequest(mail, pwd))\n');
    expect(findUnusedDtoFields({ sources: [req, use], testSourceSets: TEST_SETS })).toEqual([]);
    // Une réponse construite à la main garde son verdict (règle D5 de la fixture).
    const resp = f(`${MAIN}/PingResponse.kt`, 'package com.x\n\ndata class PingResponse(val ok: Boolean, val ttl: Long)\n');
    const build = f(`${MAIN}/Ping.kt`, 'package com.x\n\nfun sample() = PingResponse(true, 1L)\nfun go(p: PingResponse) = p.ok\n');
    const found = findUnusedDtoFields({ sources: [resp, build], testSourceSets: TEST_SETS });
    expect(found.map(x => x.name)).toEqual(['ttl']);
    expect(found[0].removeStart).toBe(-1);
  });
});

describe('KJ-039 : enums résolus à l\'exécution', () => {
  const mode = f(`${MAIN}/Mode.kt`, 'package com.x\n\nenum class Mode {\n    ALLOW,\n    DENY,\n    ASK,\n}\n');
  const names = (sources: any[]) => findUnusedEnumEntries({ sources, testSourceSets: TEST_SETS }).map((e: any) => e.name);

  it('enumValueOf<Mode>() et enumValues<Mode>() parcourent l\'enum', () => {
    const use = f(`${MAIN}/Parse.kt`, 'package com.x\n\nfun parse(s: String): Mode = enumValueOf<Mode>(s)\n');
    expect(names([mode, use])).toEqual([]);
    const use2 = f(`${MAIN}/All.kt`, 'package com.x\n\nfun all(): Array<Mode> = enumValues<Mode>()\n');
    expect(names([mode, use2])).toEqual([]);
    const none = f(`${MAIN}/None.kt`, 'package com.x\n\nfun one() = Mode.ALLOW\n');
    expect(names([mode, none])).toEqual(['DENY', 'ASK']);
  });

  it('un enum typé sur un champ de DTO revient du JSON par son nom', () => {
    const status = f(`${MAIN}/Status.kt`, 'package com.x\n\nenum class Status { ACTIVE, SUSPENDED, DELETED }\n');
    const dto = f(`${MAIN}/UserResponse.kt`, 'package com.x\n\ndata class UserResponse(val status: Status)\n');
    const use = f(`${MAIN}/Use.kt`, 'package com.x\n\nfun isActive(u: UserResponse) = u.status == Status.ACTIVE\n');
    expect(names([status, dto, use])).toEqual([]);
    const plain = f(`${MAIN}/Holder.kt`, 'package com.x\n\nclass Holder(val status: Status)\n');
    expect(names([status, plain, use])).toEqual(['SUSPENDED', 'DELETED']);
  });

  it('un @TypeConverter Room nommant l\'enum le protège', () => {
    const conv = f(`${MAIN}/Converters.kt`, 'package com.x\n\nclass Converters {\n    @TypeConverter fun toMode(s: String): Mode = Mode.valueOf(s)\n}\n');
    expect(names([mode, conv])).toEqual([]);
  });
});

describe('Sealed when : conditions multi-lignes et imports', () => {
  function analyze(code: string) {
    const uri = fresh();
    const index = new SymbolIndex();
    index.add(parse(uri, code));
    index.finalize();
    return { analyses: analyzeDocument(mockDocument(uri, code), index), index, uri };
  }
  const WEATHER = 'package com.demo\nenum class Weather { Sunny, Rainy, Stormy }\n';

  it('condition sur une ligne, flèche sur la suivante : pas de lens (au lieu de « missing: Sunny »)', () => {
    const code = WEATHER + 'fun f(w: Weather) = when (w) {\n    Weather.Sunny\n        -> "a"\n    Weather.Rainy -> "b"\n    Weather.Stormy -> "c"\n}\n';
    expect(analyze(code).analyses).toEqual([]);
  });

  it('un commentaire de bloc dans la condition ne cache pas la branche', () => {
    const code = WEATHER + 'fun f(w: Weather) = when (w) {\n    Weather.Sunny /* legacy */ -> 1\n    Weather.Rainy -> 2\n}\n';
    const a = analyze(code).analyses;
    expect(a).toHaveLength(1);
    expect(a[0].missing.map(e => e.name)).toEqual(['Stormy']);
  });

  it('la branche insérée reçoit son import quand le fichier importe les sous-types un par un', () => {
    const sealed = 'package com.demo\nsealed class S {\n    object A : S()\n    object B : S()\n}\n';
    const sealedUri = fresh();
    const uri = fresh();
    const code = 'package com.demo.ui\nimport com.demo.S.B\nfun f(s: com.demo.S) = when (s) {\n    B -> 1\n}\n';
    const index = new SymbolIndex();
    index.add(parse(sealedUri, sealed));
    index.add(parse(uri, code));
    index.finalize();
    const doc = mockDocument(uri, code);
    const a = analyzeDocument(doc, index);
    expect(a).toHaveLength(1);
    expect(a[0].missing.map(e => e.name)).toEqual(['A']);
    expect(buildMissingBranchEdit(a[0]).text).toBe('    A -> TODO()\n');
    expect(missingImportsFor(a[0], doc, index)).toEqual(['com.demo.S.A']);
    // Même package : rien à importer.
    const sameUri = fresh();
    const same = 'package com.demo\nfun g(s: S) = when (s) {\n    is S.B -> 1\n}\n';
    index.add(parse(sameUri, same));
    index.finalize();
    const b = analyzeDocument(mockDocument(sameUri, same), index);
    expect(missingImportsFor(b[0], mockDocument(sameUri, same), index)).toEqual([]);
  });
});

describe('Move File : importateurs Java et voisins du même package', () => {
  it('réécrit `import …;` et `import static …Kt.…;`', () => {
    const java = 'package com.app.ui;\n\nimport com.app.data.UserRepository;\nimport static com.app.data.UserRepositoryKt.helper;\n\nclass A {}';
    const r = rewriteImports(java, 'com.app.data', 'com.app.data.repo', new Set(['UserRepository', 'UserRepositoryKt']));
    expect(r).toEqual([
      { line: 2, newText: 'import com.app.data.repo.UserRepository;' },
      { line: 3, newText: 'import static com.app.data.repo.UserRepositoryKt.helper;' },
    ]);
  });

  it('un voisin du même package reçoit l\'import du symbole déplacé', () => {
    const vm = 'package com.app.data\n\nimport javax.inject.Inject\n\nclass UserViewModel @Inject constructor(private val repo: UserRepository)\nclass UserRepositoryFake : UserRepository()\n';
    const n = neededImports(vm, 'com.app.data', 'com.app.data.repo', new Set(['UserRepository', 'Unrelated']));
    expect(n).toEqual({ line: 3, text: 'import com.app.data.repo.UserRepository\n' });
    const other = 'package com.app.other\n\nclass X(val r: UserRepository)\n';
    expect(neededImports(other, 'com.app.data', 'com.app.data.repo', new Set(['UserRepository']))).toBeNull();
    const wildcard = 'package com.app.other\n\nimport com.app.data.*\n\nclass X(val r: UserRepository)\n';
    expect(neededImports(wildcard, 'com.app.data', 'com.app.data.repo', new Set(['UserRepository']))?.text).toBe('import com.app.data.repo.UserRepository\n');
    const declares = 'package com.app.data\n\nclass UserRepository\n';
    expect(neededImports(declares, 'com.app.data', 'com.app.data.repo', new Set(['UserRepository']))).toBeNull();
  });
});

describe('Compose Outline : commentaires, littéraux char, slots nommés', () => {
  const tree = (n: any): string => n.children.length ? `${n.name}(${n.children.map(tree).join(',')})` : n.name;

  it('un `// }` ou un `Card { }` commenté ne change pas l\'arbre', () => {
    const code = [
      '@Composable fun Screen() {',
      '    Column {',
      '        // TODO wrap in Card { }',
      "        if (sep == '{') Text(\"a\")",
      '        // }',
      '        Text("b")',
      '    }',
      '    Footer()',
      '}',
    ].join('\n');
    expect(tree(buildOutline(code, 'Screen'))).toBe('Screen(Column(Text,Text),Footer)');
  });

  it('les slots nommés d\'un Scaffold apparaissent, pas les handlers', () => {
    const code = [
      '@Composable fun Screen() {',
      '    Scaffold(',
      '        topBar = { TopAppBar(title = { Text("Title") }) },',
      '        floatingActionButton = { FloatingActionButton(onClick = { Fake() }) { Icon(Icons.Default.Add, null) } },',
      '    ) { padding -> Body(padding) }',
      '}',
    ].join('\n');
    expect(tree(buildOutline(code, 'Screen'))).toBe('Screen(Scaffold(TopAppBar(Text),FloatingActionButton(Icon),Body))');
  });

  it('this@Column.AnimatedVisibility garde son nœud', () => {
    const code = '@Composable fun Screen() {\n    Column {\n        this@Column.AnimatedVisibility(visible) { Text("v") }\n    }\n}';
    expect(tree(buildOutline(code, 'Screen'))).toBe('Screen(Column(AnimatedVisibility(Text)))');
  });
});
