import { describe, it, expect } from 'vitest';
import { findDisplaySites } from '../../../src/providers/StringXmlHoverProvider';

/** KJ-018 — tentatives de casse au-delà du contrat. */

describe('KJ-018 adversarial', () => {
  it('deux usages dans le MÊME composable : un seul site (dédup)', () => {
    const files = [{
      path: 'S.kt',
      text: `@Composable\nfun Screen() {\n  Text(stringResource(R.string.hello))\n  Text(stringResource(R.string.hello))\n}`,
    }];
    expect(findDisplaySites('hello', files)).toHaveLength(1);
  });

  it('fun imbriquée : le composable le plus INTERNE gagne', () => {
    const files = [{
      path: 'S.kt',
      text: `@Composable\nfun Outer() {\n  Inner()\n}\n@Composable\nfun Inner() {\n  Text(stringResource(R.string.deep))\n}`,
    }];
    expect(findDisplaySites('deep', files)).toEqual([{ enclosing: 'Inner', isComposable: true }]);
  });

  it('fun top-level non composable sans classe : le nom de la fun', () => {
    const files = [{ path: 'U.kt', text: `fun format(): Int = R.string.label\n` }];
    // expression body : pas de bloc — le span fun est ignoré, pas de classe → rien.
    // Variante avec bloc :
    const files2 = [{ path: 'U.kt', text: `fun format(): Int {\n  return R.string.label\n}\n` }];
    expect(findDisplaySites('label', files)).toEqual([]);
    expect(findDisplaySites('label', files2)).toEqual([{ enclosing: 'format', isComposable: false }]);
  });

  it('« hello » ne matche pas « hello_world » (frontière)', () => {
    const files = [{
      path: 'S.kt',
      text: `@Composable fun S() { Text(stringResource(R.string.hello_world)) }`,
    }];
    expect(findDisplaySites('hello', files)).toEqual([]);
  });

  it('BUG-HUNT-22 : fun locale dans un composable — on remonte jusqu’au composable', () => {
    const files = [{
      path: 'S.kt',
      text: [
        '@Composable',
        'fun Screen() {',
        '  fun helperLabel(): Int {',
        '    return R.string.deep_label',
        '  }',
        '  Text(stringResource(helperLabel()))',
        '}',
      ].join('\n'),
    }];
    expect(findDisplaySites('deep_label', files)).toEqual([
      { enclosing: 'Screen', isComposable: true },
    ]);
  });

  it('BUG-HUNT-17 : usage dans un object → le nom de l’object, pas celui de la fun', () => {
    const files = [{
      path: 'H.kt',
      text: `object StringHolder {\n  fun label(): Int {\n    return R.string.held\n  }\n}`,
    }];
    expect(findDisplaySites('held', files)).toEqual([
      { enclosing: 'StringHolder', isComposable: false },
    ]);
  });

  it('BUG-HUNT-9 : annotation avec ")" dans une string ne casse pas la détection composable', () => {
    const files = [{
      path: 'S.kt',
      text: `@Composable\n@Preview(name = ":)")\nfun Smiley() {\n  Text(stringResource(R.string.smile))\n}`,
    }];
    expect(findDisplaySites('smile', files)).toEqual([{ enclosing: 'Smiley', isComposable: true }]);
  });

  it('@Preview @Composable empilés : toujours composable', () => {
    const files = [{
      path: 'S.kt',
      text: `@Preview(showBackground = true)\n@Composable\nfun P() {\n  Text(stringResource(R.string.pv))\n}`,
    }];
    expect(findDisplaySites('pv', files)).toEqual([{ enclosing: 'P', isComposable: true }]);
  });
});
