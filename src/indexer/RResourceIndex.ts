import { stripXmlComments } from '../util/xmlRefs';

export interface RUsageEntry {
  uri:       string;
  line:      number;
  character: number;
  /**
   * Longueur du texte reconnu, relevee ici et non devinee par l'appelant.
   *
   * `R.color.accent` et `@color/accent` ne font pas la meme longueur. Les
   * fournisseurs reconstruisaient `R.<type>.<cle>` pour en deduire la plage,
   * ce qui debordait d'un caractere sur tout usage venu d'un XML.
   */
  length:    number;
}

const R_RE = /(?<!(?<![\w.])android\.)(?<!(?<![\w.])androidx\.[\w.]*)(?<!(?<![\w.])com\.google\.(?:android|firebase)[\w.]*\.)\bR\.(string|plurals|array|color|drawable|mipmap|dimen)\.([A-Za-z_]\w*)\b/g;

/**
 * Les references de ressource des XML : `@string/cle`, `@color/cle`, etc.
 *
 * En Android la plupart des chaines ne sont referencees que depuis un layout,
 * un menu ou un graphe de navigation. Mesure sur un projet reel de 1237 cles :
 * 428, soit 35 %, ne vivent que la, et Ctrl+clic depuis `strings.xml` ne
 * menait nulle part pour elles.
 *
 * `@+id/cle` et `@android:string/ok` ne correspondent pas : le type doit
 * suivre immediatement l'arobase et figurer dans la liste.
 */
const XML_REF_RE = /@(string|plurals|array|color|drawable|mipmap|dimen)\/([A-Za-z_]\w*)/g;

export type RType = 'string' | 'plurals' | 'array' | 'color' | 'drawable' | 'mipmap' | 'dimen';

const CH_ETOILE = 42;
const CH_BARRE  = 47;

/**
 * Cette colonne est elle derriere un commentaire de ligne, ou sur une ligne de
 * commentaire de bloc ?
 *
 * Volontairement grossier et en temps constant : la seule chose a eviter est
 * d'offrir une ligne commentee comme cible de navigation.
 */
function estCommente(ligne: string, col: number): boolean {
  if (ligne.lastIndexOf('//', col) >= 0) return true;
  let k = 0;
  while (k < ligne.length && (ligne.charCodeAt(k) === 32 || ligne.charCodeAt(k) === 9)) k++;
  const c = ligne.charCodeAt(k);
  return c === CH_ETOILE || (c === CH_BARRE && ligne.charCodeAt(k + 1) === CH_ETOILE);
}

export class RResourceIndex {
  private readonly string   = new Map<string, RUsageEntry[]>();
  private readonly plurals  = new Map<string, RUsageEntry[]>();
  private readonly array    = new Map<string, RUsageEntry[]>();
  private readonly color    = new Map<string, RUsageEntry[]>();
  private readonly drawable = new Map<string, RUsageEntry[]>();
  private readonly mipmap   = new Map<string, RUsageEntry[]>();
  private readonly dimen    = new Map<string, RUsageEntry[]>();

  // Tracks which (type, key) pairs each file contributes — needed for clean removal
  private readonly byFile  = new Map<string, Array<{ type: RType; key: string }>>();

  reindexFile(uri: string, content: string): void {
    this.removeFile(uri); // idempotent — clears previous state for this file

    // `@type/cle` n'a de sens que dans un XML : du code ecrit `R.string.cle`.
    // Chercher ce motif dans chaque ligne de chaque source coutait 41 % de plus
    // sur la construction de l'index, pour zero reference utile.
    const estXml = uri.endsWith('.xml');
    const contributed: Array<{ type: RType; key: string }> = [];
    // Un `@dimen/x` dans un commentaire XML n'est pas une reference. Cette
    // regex fait UNE passe et ne coute presque rien ; desamorcer entierement
    // chaque fichier Kotlin, lui, multipliait par treize le cout de l'index,
    // 411 ms contre 32 sur un projet reel, pour deux cibles fautives.
    const lines = (estXml ? stripXmlComments(content) : content).split('\n');
    for (let ln = 0; ln < lines.length; ln++) {
      for (const re of estXml ? [R_RE, XML_REF_RE] : [R_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(lines[ln]))) {
          // Cote code, un controle par CORRESPONDANCE plutot qu'un balayage du
          // fichier : `// assertEquals(R.drawable.x, ...)` n'est pas un usage.
          if (!estXml && estCommente(lines[ln], m.index)) continue;
          const type = m[1] as RType;
          const key  = m[2];
          if (!this[type].has(key)) this[type].set(key, []);
            this[type].get(key)!.push({ uri, line: ln, character: m.index, length: m[0].length });
          contributed.push({ type, key });
        }
      }
    }
    if (contributed.length > 0) this.byFile.set(uri, contributed);
  }

  removeFile(uri: string): void {
    const contrib = this.byFile.get(uri);
    if (!contrib) return;
    for (const { type, key } of contrib) {
      const arr  = this[type].get(key);
      const next = arr?.filter(e => e.uri !== uri) ?? [];
      if (next.length) this[type].set(key, next);
      else             this[type].delete(key);
    }
    this.byFile.delete(uri);
  }

  getUsages(type: RType, key: string): RUsageEntry[] {
    return this[type].get(key) ?? [];
  }
}
