/**
 * Une cle de chaine declaree VIDE dans un module et remplie dans un autre.
 *
 * Un module de base declare souvent la cle sans valeur,
 * `<string name="x"/>`, pour que le code qui la reference compile, et le
 * module applicatif fournit le texte. La fusion de ressources d'Android laisse
 * toujours la valeur non vide l'emporter : c'est elle que l'application
 * affiche a l'execution.
 *
 * Le classement de l'index donnait pourtant la priorite au module du fichier
 * appelant, donc l'espace reserve vide gagnait, et le survol n'affichait rien.
 * Mesure sur un projet reel : 5 cles dans ce cas, dont le mode de theme clair
 * et sombre reference depuis le module de base.
 *
 * Rien d'autre ne bouge : quand toutes les declarations sont remplies, ou
 * toutes vides, elles recoivent le meme bonus et l'ordre reste celui d'avant.
 */
import { describe, it, expect } from 'vitest';
import { StringResourceIndex } from '../../src/indexer/StringResourceIndex';

const NL = String.fromCharCode(10);
const uri = (p: string) => ({ toString: () => 'file://' + p, path: p, fsPath: p });

const BASE_XML = '/p/base/src/main/res/values/base_strings.xml';
const APP_XML  = '/p/app/src/main/res/values/strings.xml';
const APPELANT_BASE = '/p/base/src/main/java/com/x/Reglages.kt';
const APPELANT_APP  = '/p/app/src/main/java/com/y/Ecran.kt';

function index(baseVide: boolean) {
  const i = new StringResourceIndex();
  i.reindexFile(uri(BASE_XML) as any, [
    '<resources>',
    baseVide ? '    <string name="theme_clair"/>' : '    <string name="theme_clair">Base</string>',
    '    <string name="commun">Depuis base</string>',
    '</resources>',
  ].join(NL));
  i.reindexFile(uri(APP_XML) as any, [
    '<resources>',
    '    <string name="theme_clair">Clair</string>',
    '    <string name="commun">Depuis app</string>',
    '</resources>',
  ].join(NL));
  return i;
}

describe('une valeur remplie l emporte sur un espace reserve vide', () => {
  it('depuis le module qui declare la cle vide, on voit la vraie valeur', () => {
    expect(index(true).getValue('theme_clair', APPELANT_BASE)?.value).toBe('Clair');
  });

  it('et depuis l autre module aussi, evidemment', () => {
    expect(index(true).getValue('theme_clair', APPELANT_APP)?.value).toBe('Clair');
  });

  it('quand les DEUX sont remplies, le module appelant garde la priorite', () => {
    expect(index(false).getValue('theme_clair', APPELANT_BASE)?.value).toBe('Base');
    expect(index(false).getValue('theme_clair', APPELANT_APP)?.value).toBe('Clair');
  });

  it('et le classement par module reste intact sur une cle ordinaire', () => {
    const i = index(true);
    expect(i.getValue('commun', APPELANT_BASE)?.value).toBe('Depuis base');
    expect(i.getValue('commun', APPELANT_APP)?.value).toBe('Depuis app');
  });

  it('si toutes les declarations sont vides, on rend quand meme une entree', () => {
    const i = new StringResourceIndex();
    i.reindexFile(uri(BASE_XML) as any, '<resources><string name="vide"/></resources>');
    i.reindexFile(uri(APP_XML) as any, '<resources><string name="vide"/></resources>');
    expect(i.getValue('vide', APPELANT_BASE)).toBeTruthy();
    expect(i.getValue('vide', APPELANT_BASE)?.value).toBe('');
  });
});
