/**
 * KJ — « 4 writeOnly » et « 1 dead islands » dans la meme notification.
 *
 * La v1.42.207 a fait accorder les compteurs de tete des resumes, et s est
 * arretee la. Les libelles a l interieur de la phrase, eux, restent ecrits une
 * fois pour toutes au pluriel, et deux d entre eux ne sont meme pas des mots :
 * la commande d ensemble affichait la CLE du detecteur, pas son libelle.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse, 5093 fichiers Kotlin et Java :
 * le detail de la section « dead code » y annonce aujourd hui
 * « 43 locals, 21 imports, 19 declarations, 4 writeOnly, 2 parameters ».
 * `locals` et `writeOnly` sont des identifiants de code, et le libelle qui
 * dit « variables » et « write-only variables » existait deja trois lignes
 * plus haut, dans l autre commande.
 *
 * L accord a un, lui, est latent sur ce projet la : le plus petit compte
 * mesure est 2 (parameters). Il suffit d un parametre inutilise de moins.
 */
import { describe, it, expect } from 'vitest';
import { describeFindings, resumeNonRetirable } from '../../src/commands/DeadCodeSweep';
import { resumeTout, Section } from '../../src/commands/FindEverythingUnused';
import type { SweepFinding, SweepDetector } from '../../src/providers/DeadCodeSweep';

const trouvaille = (detector: SweepDetector): SweepFinding =>
  ({ detector, line: 0, character: 0, length: 1, name: 'x', message: 'm' }) as unknown as SweepFinding;

const section = (one: string, label: string, count: number, detail?: string): Section =>
  ({ one, label, count, detail });

describe('le detail du balayage de code mort', () => {
  it('ne montre jamais la cle du detecteur', () => {
    const d = describeFindings([
      trouvaille('writeOnly'), trouvaille('writeOnly'), trouvaille('locals'),
    ]);
    expect(d).not.toContain('writeOnly');
    expect(d).not.toContain('locals');
    expect(d).toBe('2 write-only variables, 1 variable');
  });

  it('un seul element passe au singulier', () => {
    expect(describeFindings([trouvaille('imports')])).toBe('1 import');
    expect(describeFindings([trouvaille('parameters')])).toBe('1 parameter');
    expect(describeFindings([trouvaille('declarations')])).toBe('1 declaration');
    expect(describeFindings([trouvaille('locals')])).toBe('1 variable');
    expect(describeFindings([trouvaille('writeOnly')])).toBe('1 write-only variable');
  });

  it('temoin : plusieurs elements gardent leur pluriel et leur ordre', () => {
    expect(describeFindings([
      trouvaille('imports'), trouvaille('imports'), trouvaille('locals'),
    ])).toBe('2 imports, 1 variable');
  });
});

describe('la phrase du nettoyage par fichier', () => {
  it('une seule trouvaille ne porte pas de verbe au pluriel', () => {
    const r = resumeNonRetirable(1);
    expect(r).not.toContain('findings');
    expect(r).not.toContain(' need ');
    expect(r).toContain('1 finding');
  });

  it('temoin : plusieurs trouvailles restent au pluriel', () => {
    expect(resumeNonRetirable(3)).toContain('3 findings');
  });
});

describe('le resume de la commande d ensemble', () => {
  it('chaque libelle s accorde a un', () => {
    const r = resumeTout([
      section('dead island', 'dead islands', 1),
      section('enum entry', 'enum entries', 1),
      section('catalog alias', 'catalog aliases', 1),
      section('class member', 'class members', 1),
      section('unreferenced symbol', 'unreferenced symbols', 1),
      section('resource key', 'resource keys', 1),
      section('resource file', 'resource files', 1),
      section('Remote Config key', 'Remote Config keys', 1),
      section('unheard event', 'unheard events', 1),
    ], 3, []);
    for (const faux of [
      '1 dead islands', '1 enum entries', '1 enum entrys', '1 catalog aliases',
      '1 catalog aliass', '1 class members', '1 unreferenced symbols',
      '1 resource keys', '1 resource files', '1 Remote Config keys',
      '1 unheard events',
    ]) expect(r).not.toContain(faux);
    expect(r).toContain('9 findings across 3 files');
    expect(r).toContain('1 dead island ·');
    expect(r).toContain('1 enum entry ·');
    expect(r).toContain('1 catalog alias ·');
  });

  it('temoin : au dela de un, les libelles restent au pluriel', () => {
    const r = resumeTout([
      section('enum entry', 'enum entries', 2),
      section('catalog alias', 'catalog aliases', 3),
    ], 3, []);
    expect(r).toBe('5 findings across 3 files: 2 enum entries · 3 catalog aliases.');
  });

  it('une section a zero disparait sans laisser de trace', () => {
    expect(resumeTout([
      section('dead island', 'dead islands', 0),
      section('enum entry', 'enum entries', 1),
    ], 2, [])).toBe('1 finding across 2 files: 1 enum entry.');
  });

  it('tout a zero avec un detecteur saute ne finit plus sur « : . »', () => {
    const r = resumeTout([section('dead island', 'dead islands', 0)], 4, ['resource keys']);
    expect(r).not.toContain(': .');
    expect(r).toBe('Nothing unused found across 4 files. Skipped: resource keys.');
  });

  it('temoin : tout a zero sans rien de saute garde sa phrase', () => {
    expect(resumeTout([], 1, [])).toBe('Nothing unused found across 1 file.');
  });

  it('le detail suit le compte de sa section', () => {
    expect(resumeTout([section('dead island', 'dead islands', 1, '3 declarations')], 9, []))
      .toBe('1 finding across 9 files: 1 dead island (3 declarations).');
  });
});
