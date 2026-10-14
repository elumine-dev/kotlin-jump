import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G60, la derniere entree d enum annotee n a pas d etendue de coupe.
 *
 * Vu en ecrivant le temoin de G59 : `enum Mode { ON, @Deprecated OFF }` rendait
 * OFF `unreferenced` mais avec `removeStart = -1`, donc trouvee et jamais
 * coupee. La derniere entree emporte la virgule qui la PRECEDE, et la marche
 * arriere partait du nom : elle tombait sur l annotation au lieu de la
 * virgule. Au milieu de la liste la coupe prend la virgule qui SUIT, et
 * l annotation la suivait deja.
 */

const enums: any = await importOrNull('src/providers/unusedEnumEntries');

const P = '/w/app/src/main/java/p';
const CALLER = { path: `${P}/Caller.java`, text: 'package p;\n\npublic class Caller {\n\tpublic static void main(String[] a) {\n\t\tMode m = Mode.ON;\n\t}\n}\n' };

const cut = (body: string) => {
  const mode = { path: `${P}/Mode.java`, text: `package p;\n\npublic enum Mode {\n${body}}\n` };
  const found = (enums.findUnusedEnumEntries({ sources: [CALLER, mode], testSourceSets: ['test/java'] }) as any[])
    .find(e => e.name === 'OFF');
  return found && found.removeStart >= 0
    ? mode.text.slice(0, found.removeStart) + mode.text.slice(found.removeEnd)
    : undefined;
};

describe('G60, la derniere entree annotee', () => {
  it('annotation sur la meme ligne', () => {
    expect(cut('\tON,\n\t@Deprecated OFF\n')).toBe('package p;\n\npublic enum Mode {\n\tON\n}\n');
  });

  it('annotation sur sa propre ligne', () => {
    expect(cut('\tON,\n\t@SuppressWarnings("unused")\n\tOFF\n')).toBe('package p;\n\npublic enum Mode {\n\tON\n}\n');
  });

  it('liste sur une seule ligne', () => {
    expect(cut('\tON, @Deprecated OFF\n')).toBe('package p;\n\npublic enum Mode {\n\tON\n}\n');
  });

  it('garde : sans annotation, la coupe ne change pas', () => {
    expect(cut('\tON,\n\tOFF\n')).toBe('package p;\n\npublic enum Mode {\n\tON\n}\n');
  });
});
