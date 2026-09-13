/**
 * Ce que la famille des CLES DE RESSOURCES declare morte, confronte au corpus.
 *
 *   npx vite-node scripts/verify-resource-key-removals.ts <racine>
 *
 * Les autres temoins jugent la COUPE. Celui ci juge le VERDICT, parce que
 * c'est la qu'une cle de ressource se perd : une forme de reference que le
 * moissonneur ne connait pas ne laisse aucune trace, la cle passe pour morte,
 * et « Remove all » la supprime d'un `strings.xml` que rien ne recompilera
 * pour prevenir.
 *
 * Formule a l'envers de la regle de production : celle ci ne refait pas le
 * moissonnage, elle cherche le NOM de la cle dans le texte brut de toutes les
 * sources, en dehors de ses propres declarations. Une occurrence n'est pas une
 * preuve de vie, mais c'est une question a laquelle il faut repondre.
 *
 * Invariants :
 *   trace     le nom de la cle morte n'apparait nulle part ailleurs, en dehors
 *             des attributs `tools:`, qui sont du temps de conception. Verifie
 *             a l'aapt2 du SDK et non suppose : `tools:background="@color/x"`
 *             avec `x` absent compile et lie sans une erreur, alors que le
 *             meme `android:background` echoue sur
 *             « resource color/x not found ». Formule autrement que la regle
 *             de production, qui blanchit la valeur de tout attribut `tools:`
 *   forme     le fichier de valeurs reste bien forme une fois les coupes faites
 *   element   la coupe commence sur un `<` et finit sur un `>`. Mesure sur le
 *             projet de reference : aucune des 82 coupes ne porte de lignes
 *             entieres, 63 tiennent dans une ligne et 19 s'etalent a partir du
 *             `<` d'un `<style>`. La regle des lignes entieres des autres
 *             temoins n'a donc aucun sens ici, alors que la frontiere d'element
 *             tombe des le premier caractere de decalage
 *   bornes    chaque variante tient dans son fichier
 *   nom       la coupe de la variante de base contient le nom
 */
import * as fs from 'fs';
import * as path from 'path';
import { findUnusedResourceKeys } from '../src/providers/unusedResourceKeys';
import { collectValueKeyDeclarations, parseValuesPath } from '../src/indexer/ValueResourceScanner';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);

function walk(dir: string, vu: (f: string) => void): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, vu);
    else if (SOURCE_RE.test(e.name) || /META-INF[\\/]services[\\/]/.test(p)) vu(p);
  }
}

/**
 * Le fichier reste-t-il bien forme ?
 *
 * Pile de balises, sur le texte brut. Une coupe qui emporte une balise
 * ouvrante sans sa fermante, ou l'inverse, laisse un `strings.xml` que le
 * build refuse d'ouvrir, et aucun des autres invariants ne le verrait.
 */
function malForme(xml: string): string | undefined {
  const sansCommentaires = xml.replace(/<!--[\s\S]*?-->/g, '');
  const pile: string[] = [];
  const re = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sansCommentaires)) !== null) {
    if (m[2].startsWith('?') || m[2].startsWith('!')) continue;
    if (m[4] === '/') continue;
    if (m[1] === '/') {
      if (pile.pop() !== m[2]) return `fermeture inattendue </${m[2]}>`;
    } else {
      pile.push(m[2]);
    }
  }
  return pile.length > 0 ? `balise non fermee <${pile[pile.length - 1]}>` : undefined;
}

function main(): void {
  const racine = process.argv[2];
  const sources: { path: string; text: string }[] = [];
  walk(racine, f => { try { sources.push({ path: f, text: fs.readFileSync(f, 'utf8') }); } catch { /* illisible */ } });

  const moduleDirs = sources
    .filter(s => /[\\/]build\.gradle(\.kts)?$/.test(s.path))
    .map(s => s.path.replace(/[\\/]build\.gradle(\.kts)?$/, ''));
  const modulesWithCode = moduleDirs.filter(d =>
    sources.some(s => s.path.startsWith(`${d}/`) && /\.(kt|java)$/.test(s.path)));
  // Aucun module declare bibliotheque : c'est le reglage le PLUS severe pour
  // un temoin, puisqu'un module bibliotheque est menage par le detecteur. On
  // ne recopie pas la regle de `ResourceCorpus`, qui derivrait en silence.
  const libraryModules: string[] = [];

  const declarations = sources
    .filter(s => parseValuesPath(s.path) !== undefined)
    .flatMap(s => collectValueKeyDeclarations(s.path, s.text, modulesWithCode));

  const mortes = findUnusedResourceKeys({
    declarations, sources: sources as any, modulesWithCode, libraryModules, truncated: false,
  });

  const compte = { trace: 0, forme: 0, element: 0, bornes: 0, nom: 0 };
  const fautes: string[] = [];

  for (const k of mortes) {
    const siennes = new Set(k.variants.map((v: any) => `${v.path}:${v.start}`));
    for (const v of k.variants as any[]) {
      const texte = sources.find(s => s.path === v.path)?.text;
      if (texte === undefined || v.start < 0 || v.end > texte.length || v.end <= v.start) {
        compte.bornes++;
        if (fautes.length < 15) fautes.push(`BORNES ${path.relative(racine, v.path)} ${k.kind}/${k.name}`);
        continue;
      }
      if (texte[v.start] !== '<' || texte[v.end - 1] !== '>') {
        compte.element++;
        if (fautes.length < 15) {
          fautes.push(`ELEMENT ${path.relative(racine, v.path)} ${k.kind}/${k.name} `
            + `${JSON.stringify(texte.slice(v.start, v.start + 12))}..${JSON.stringify(texte.slice(v.end - 8, v.end))}`);
        }
      }
      if (!texte.slice(v.start, v.end).includes(k.name)) {
        compte.nom++;
        if (fautes.length < 15) fautes.push(`NOM ${path.relative(racine, v.path)} ${k.kind}/${k.name}`);
      }
    }
    // Le nom, en mot entier, ailleurs que dans ses propres declarations.
    const mot = new RegExp(`\\b${k.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const ailleurs: string[] = [];
    for (const s of sources) {
      if (!mot.test(s.text)) continue;
      const declIci = k.variants.filter((v: any) => v.path === s.path);
      let reste = s.text;
      for (const v of [...declIci].sort((a: any, b: any) => b.start - a.start)) {
        reste = reste.slice(0, v.start) + reste.slice(v.end);
      }
      // Ni un attribut `tools:`, du temps de conception, ni un commentaire ne
      // font vivre une cle. `// Subtle orange overlay` parle d'une couleur,
      // il ne la reference pas.
      const horsConception = reste
        .replace(/\btools:[\w.]+\s*=\s*"[^"]*"/g, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      if (mot.test(horsConception) && ailleurs.length < 3) ailleurs.push(path.relative(racine, s.path));
    }
    if (ailleurs.length > 0) {
      compte.trace++;
      if (fautes.length < 15) fautes.push(`TRACE ${k.kind}/${k.name} apparait dans ${ailleurs.join(', ')}`);
    }
    void siennes;
  }

  // Toutes les coupes d'un fichier appliquees ensemble, comme le ferait la
  // commande, puis relecture de la forme.
  const parFichier = new Map<string, { start: number; end: number; cle: string }[]>();
  for (const k of mortes) {
    for (const v of k.variants as any[]) {
      const l = parFichier.get(v.path) ?? [];
      l.push({ start: v.start, end: v.end, cle: `${k.kind}/${k.name}` });
      parFichier.set(v.path, l);
    }
  }
  for (const [p, coupes] of parFichier) {
    const texte = sources.find(s => s.path === p)?.text;
    if (texte === undefined) continue;
    if (malForme(texte) !== undefined) continue;   // deja casse avant nous
    let reste = texte;
    for (const c of [...coupes].sort((a, b) => b.start - a.start)) {
      reste = reste.slice(0, c.start) + reste.slice(c.end);
    }
    const faute = malForme(reste);
    if (faute !== undefined) {
      compte.forme++;
      if (fautes.length < 15) fautes.push(`FORME ${path.relative(racine, p)} ${faute} apres ${coupes.length} coupes`);
    }
  }

  console.log(JSON.stringify({
    sources: sources.length, declarations: declarations.length, mortes: mortes.length, ...compte,
  }));
  for (const x of fautes) console.log('  ' + x);
}

main();
