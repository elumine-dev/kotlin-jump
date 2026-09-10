import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { handleGetKdoc } from '../../src/server/mcp';

// Audit 65 : `get_kdoc` relit le fichier sur le disque, mais cherche la
// declaration a la ligne memorisee par l'index au demarrage du serveur MCP.
// Comme cet index n'est jamais rafraichi, une edition qui deplace les lignes
// fait rendre la KDoc d'un AUTRE symbole, avec aplomb. Pour un agent qui edite
// puis interroge, c'est pire qu'une reponse vide.

const URI = 'file:///a65/Modele.kt';

const AVANT = [
  'package p',
  '',
  '/** Charge le profil. */',
  'fun chargerProfil() {}',
  '',
  '/** Efface tout. */',
  'fun effacerTout() {}',
].join('\n');

// La premiere fonction est supprimee : la seconde REMONTE exactement sur la
// ligne 3, celle que l'index garde en memoire pour la premiere.
const APRES = [
  'package p',
  '',
  '/** Efface tout. */',
  'fun effacerTout() {}',
].join('\n');

function indexDe(code: string): SymbolIndex {
  const index = new SymbolIndex();
  index.add(parse(URI, code));
  index.finalize();
  return index;
}

describe('get_kdoc ne rend pas la doc d\'un autre symbole', () => {
  it('la fixture fait remonter une AUTRE declaration documentee sur la ligne memorisee', () => {
    // Sans cela le test ne prouverait rien : il faut que l'ancienne ligne porte
    // une declaration voisine, sinon l'extracteur rend simplement null.
    const a = parse(URI, AVANT).symbols.find(s => s.name === 'chargerProfil')!;
    expect(a.line).toBe(3);
    expect(APRES.split('\n')[3].trim()).toBe('fun effacerTout() {}');
    expect(APRES.split('\n')[2].trim()).toBe('/** Efface tout. */');
  });

  it('sur un fichier inchange, la doc est la bonne', async () => {
    const r = await handleGetKdoc(indexDe(AVANT), 'p.chargerProfil', async () => AVANT);
    expect(r.kdoc).toContain('Charge le profil');
  });

  it('apres une edition qui decale les lignes, aucune doc erronee', async () => {
    // L'index date d'AVANT, le disque contient APRES.
    const r = await handleGetKdoc(indexDe(AVANT), 'p.chargerProfil', async () => APRES);
    expect(r.kdoc ?? '').not.toContain('Efface tout');
    expect(r.kdoc).toBeNull();
    expect((r as { stale?: boolean }).stale).toBe(true);
  });

  it('un symbole inconnu reste distinct d\'un symbole perime', async () => {
    const r = await handleGetKdoc(indexDe(AVANT), 'p.inexistant', async () => AVANT);
    expect(r.kdoc).toBeNull();
    expect((r as { stale?: boolean }).stale).toBeUndefined();
  });

  it('une declaration sans KDoc reste distincte d\'une declaration perimee', async () => {
    const code = 'package p\n\nfun sansDoc() {}\n';
    const r = await handleGetKdoc(indexDe(code), 'p.sansDoc', async () => code);
    expect(r.kdoc).toBeNull();
    expect((r as { stale?: boolean }).stale).toBeUndefined();
  });
});

describe('Le plafond de fichiers scannes est exact', () => {
  // `MAX_SCANNED_FILES` empeche un editeur lance depuis le dossier personnel
  // d'indexer tout le disque. La garde etait testee AVANT le `lstat`, dans une
  // rafale `Promise.all` : tous les enfants d'un dossier demarraient avant que
  // le premier ait pousse son entree. Mesure sur LaPresse : plafond annonce
  // 1000, 1803 fichiers indexes.
  const os = require('node:os') as typeof import('node:os');
  const fsSync = require('node:fs') as typeof import('node:fs');
  const pathMod = require('node:path') as typeof import('node:path');

  function arbre(nbDossiers: number, parDossier: number): string {
    const racine = fsSync.mkdtempSync(pathMod.join(os.tmpdir(), 'kj-cap-'));
    for (let d = 0; d < nbDossiers; d++) {
      const sous = pathMod.join(racine, `mod${d}`);
      fsSync.mkdirSync(sous);
      for (let f = 0; f < parDossier; f++) {
        fsSync.writeFileSync(pathMod.join(sous, `F${f}.kt`), `package p${d}\n\nclass C${d}_${f}\n`);
      }
    }
    return racine;
  }

  it('la fixture depasse largement le plafond demande', async () => {
    const { scanWorkspace } = await import('../../src/server/scanner');
    const racine = arbre(12, 30); // 360 fichiers
    try {
      const index = new SymbolIndex();
      await scanWorkspace(racine, index, 10_000);
      expect(index.stats().files).toBe(360);
    } finally { fsSync.rmSync(racine, { recursive: true, force: true }); }
  });

  it('le plafond est respecte au fichier pres', async () => {
    const { scanWorkspace } = await import('../../src/server/scanner');
    const racine = arbre(12, 30);
    try {
      for (const plafond of [1, 7, 50, 137]) {
        const index = new SymbolIndex();
        await scanWorkspace(racine, index, plafond);
        expect([plafond, index.stats().files]).toEqual([plafond, plafond]);
      }
    } finally { fsSync.rmSync(racine, { recursive: true, force: true }); }
  });
});
