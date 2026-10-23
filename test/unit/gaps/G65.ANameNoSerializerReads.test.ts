import { describe, it, expect } from 'vitest';
import { explainMembers, findUnusedMembers } from '../../../src/providers/unusedMembers';
import { androidApi } from '../../../src/util/androidApi';

/**
 * G65 — une methode qu aucun serialiseur ne lit, gardee comme s il la lisait.
 *
 * Audit de dix fichiers du projet de reference, 2026-10-21 : `ObituaryModel.hasTitle()` n a
 * aucun appelant, et KJ la gardait sous `M4:F6:Serializable`.
 *
 * F6 dit « une bibliotheque fabrique l objet et lit ce qu il expose ». Ce
 * qu elle lit a un nom fixe :
 *
 *   Java (Serializable)   les CHAMPS, plus readObject, writeObject,
 *                         readObjectNoData, readResolve, writeReplace
 *   Gson, Moshi           les CHAMPS
 *   Jackson               les champs, et les accesseurs JavaBean getX, isX, setX
 *   Parcelable            rien par reflexion : writeToParcel et CREATOR
 *
 * Une methode dont le nom n est ni un accesseur JavaBean ni un crochet de la
 * serialisation Java n est donc lue par aucune. Elle redescend dans le
 * comptage. Les champs et les accesseurs gardent F6 : le projet de reference passe une
 * vingtaine d objets a Jackson (`jsonService.toJson`), dont certains par un
 * parametre generique, et rien ne prouve qu un getter n y passe pas.
 */

const SEGS = ['test/java'];
/** Comme Remove All : l index G61 rend visible la chaine qui sort par `Serializable`. */
const API = androidApi({
  level: 'test',
  names: ['writeToParcel', 'describeContents', 'toString', 'hashCode'],
  types: {
    'java.lang.Object': [null, [], [2, 3]],
    'java.io.Serializable': [null, [], []],
    'android.os.Parcelable': [null, [], [0, 1]],
  },
});
const P = '/w/app/src/main/java/p';
const src = (path: string, ...lines: string[]) => ({ path: `${P}/${path}`, text: lines.join('\n') + '\n' });

const modele = (supertype: string, ...extra: string[]) => src('ObituaryModel.java',
  'package p;',
  '',
  'import java.io.Serializable;',
  'import android.os.Parcelable;',
  '',
  `public class ObituaryModel implements ${supertype} {`,
  '\tprivate String defunctTitle;',
  '',
  '\tpublic String getDefunctTitle() {',
  '\t\treturn defunctTitle;',
  '\t}',
  '',
  '\tpublic boolean hasTitle() {',
  '\t\treturn defunctTitle != null;',
  '\t}',
  ...extra,
  '}',
);

const MAIN = src('Main.java',
  'package p;',
  '',
  'class Main {',
  '\tString m(ObituaryModel o) { return o.getDefunctTitle(); }',
  '}',
);

const morts = (...sources: { path: string; text: string }[]) =>
  findUnusedMembers({ sources, testSourceSets: SEGS, androidApi: API } as any).filter(m => m.verdict === 'unreferenced').map(m => m.name);
const pourquoi = (nom: string, ...sources: { path: string; text: string }[]) =>
  (explainMembers({ sources, testSourceSets: SEGS, androidApi: API } as any) as any[]).find(r => r.name === nom);

describe('G65 — un nom qu aucun serialiseur ne lit', () => {
  it('hasTitle d un modele Serializable', () => {
    expect(morts(modele('Serializable'), MAIN)).toContain('hasTitle');
    expect(pourquoi('hasTitle', modele('Serializable'), MAIN)).toMatchObject({ outcome: 'unreferenced' });
  });

  it('et d un Parcelable', () => {
    expect(morts(modele('Parcelable'), MAIN)).toContain('hasTitle');
  });
});

describe('G65 — ce que F6 garde encore', () => {
  it('un getter JavaBean, que Jackson lit', () => {
    const sansLecteur = src('Main.java', 'package p;', '', 'class Main {', '\tObject m(ObituaryModel o) { return o; }', '}');
    expect(morts(modele('Serializable'), sansLecteur)).not.toContain('getDefunctTitle');
    expect(pourquoi('getDefunctTitle', modele('Serializable'), sansLecteur))
      .toMatchObject({ outcome: 'M4:F6:Serializable' });
  });

  it('un isX et un setX', () => {
    const m = modele('Serializable',
      '',
      '\tpublic boolean isSpecial() { return false; }',
      '',
      '\tpublic void setDefunctTitle(String t) { defunctTitle = t; }',
    );
    expect(morts(m, MAIN)).not.toContain('isSpecial');
    expect(morts(m, MAIN)).not.toContain('setDefunctTitle');
  });

  it('un crochet de la serialisation Java', () => {
    const m = modele('Serializable',
      '',
      '\tprotected Object readResolve() { return this; }',
      '',
      '\tprotected Object writeReplace() { return this; }',
    );
    expect(morts(m, MAIN)).not.toContain('readResolve');
    expect(morts(m, MAIN)).not.toContain('writeReplace');
  });

  it('une methode appelee', () => {
    const appel = src('Caller.java', 'package p;', '', 'class Caller {', '\tboolean c(ObituaryModel o) { return o.hasTitle(); }', '}');
    expect(morts(modele('Serializable'), MAIN, appel)).not.toContain('hasTitle');
  });
});

/**
 * `SectionDO.getPageExternalUid(PageUid uid)` : le nom commence par `get`,
 * mais Jackson ne lit que des getters SANS parametre et des setters a UN
 * parametre. Avec un argument, ce n est pas un accesseur.
 */
describe('G65 — un get qui prend un argument', () => {
  const parcelable = src('SectionDO.java',
    'package p;',
    '',
    'import android.os.Parcelable;',
    '',
    'public class SectionDO implements Parcelable {',
    '\tpublic String getUid() { return "u"; }',
    '',
    '\tpublic String getPageExternalUid(String pageUid) { return pageUid; }',
    '',
    '\tpublic String getPageExternalUid(int index) { return null; }',
    '}',
  );
  const lecteur = src('Main.java', 'package p;', '', 'class Main {', '\tString m(SectionDO s) { return s.getUid(); }', '}');

  it('n est pas protege comme un accesseur', () => {
    expect(pourquoi('getPageExternalUid', parcelable, lecteur)).not.toMatchObject({ outcome: 'M4:F6:Parcelable' });
  });

  it('alors que getUid, sans parametre, l est encore', () => {
    const sansLecteur = src('Main.java', 'package p;', '', 'class Main {', '\tObject m(SectionDO s) { return s; }', '}');
    expect(pourquoi('getUid', parcelable, sansLecteur)).toMatchObject({ outcome: 'M4:F6:Parcelable' });
  });
});
