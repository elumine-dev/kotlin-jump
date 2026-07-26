import { describe, it, expect } from 'vitest';
import { buildOutline } from '../../../src/providers/ComposeOutlineProvider';

/** KJ-015 — tentatives de casse au-delà du contrat. */

const flatten = (n: any, acc: string[] = []): string[] => {
  acc.push(n.name);
  for (const c of n.children ?? []) flatten(c, acc);
  return acc;
};

describe('KJ-015 adversarial', () => {
  it('lambda dans les ARGS ignorée, lambda trailing parsée', () => {
    const text = `
      @Composable fun S() {
        Button(onClick = { Fake() }) { Text("ok") }
      }
      @Composable fun Fake() { Text("no") }
    `;
    const names = flatten(buildOutline(text, 'S'));
    expect(names).toContain('Text');
    expect(names).not.toContain('Fake'); // l'appel n'est que dans les args
  });

  it('accolade DANS une string ne casse pas l’équilibrage', () => {
    const text = `
      @Composable fun S() {
        Column {
          Text("has { brace")
          Chip()
        }
      }
      @Composable fun Chip() { Text("c") }
    `;
    const names = flatten(buildOutline(text, 'S'));
    expect(names).toContain('Chip');
  });

  it('if sans accolades : les deux appels trouvés quand même', () => {
    const text = `
      @Composable fun S(x: Boolean) {
        if (x) Spinner() else Empty()
      }
      @Composable fun Spinner() { Text("s") }
      @Composable fun Empty() { Text("e") }
    `;
    const names = flatten(buildOutline(text, 'S'));
    expect(names).toContain('Spinner');
    expect(names).toContain('Empty');
  });

  it('BUG-HUNT-14 : KDoc long entre @Composable et fun — la définition reste expansée', () => {
    const kdoc = '/**\n' + ' * '.padEnd(60, 'x').repeat(6).split('x').join('x\n * ') + '\n */';
    const text = `
      @Composable
      ${kdoc}
      fun S() {
        Column { Chip() }
      }
      @Composable fun Chip() { Text("c") }
    `;
    expect(kdoc.length).toBeGreaterThan(200); // le piège : fenêtre fixe dépassée
    const names = flatten(buildOutline(text, 'S'));
    expect(names).toContain('Chip');
  });

  it('racine inconnue : arbre vide, pas de crash', () => {
    const t = buildOutline('fun notComposable() {}', 'Ghost');
    expect(t.name).toBe('Ghost');
    expect(t.children).toEqual([]);
  });

  it('maxDepth 0 : racine seule', () => {
    const text = `@Composable fun S() { Column { Text("x") } }`;
    expect(flatten(buildOutline(text, 'S', 0))).toEqual(['S']);
  });

  it('récursion mutuelle A→B→A coupée', () => {
    const text = `
      @Composable fun A() { B() }
      @Composable fun B() { A() }
    `;
    const raw = JSON.stringify(buildOutline(text, 'A'));
    expect(raw).toMatch(/"cycle":\s*true/);
  });

  it('LazyColumn items {} : contenu marqué loop', () => {
    const text = `
      @Composable fun S(team: List<String>) {
        LazyColumn {
          items(team) { name -> Slot(name) }
        }
      }
      @Composable fun Slot(n: String) { Text(n) }
    `;
    const tree = buildOutline(text, 'S');
    const findNode = (n: any, name: string): any => {
      if (n.name === name) return n;
      for (const c of n.children ?? []) {
        const f = findNode(c, name);
        if (f) return f;
      }
      return null;
    };
    expect(findNode(tree, 'Slot')?.loop).toBe(true);
  });
});
