/**
 * Enregistre plusieurs demos et rend un tableau vérifié.
 *
 * Sans ça, produire une série = 21 commandes à la main puis un audit
 * manuel des tailles. Ici : une commande, un verdict par demo (pertinence,
 * taille, durée), et un code de sortie non nul si l'une échoue.
 *
 *   node dist/demo/record-batch.js kj          # les 21 demos de la vague KJ
 *   node dist/demo/record-batch.js a b c       # une liste explicite
 *   node dist/demo/record-batch.js --all       # tout le dossier demos/
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEMOS_DIR = path.join(REPO_ROOT, 'scripts', 'demo', 'demos');
const OUT_DIR = path.join(REPO_ROOT, 'assets', 'demos');

/** Budget README/Marketplace. */
const MAX_MB = 6;

const KJ = [
  'named-arguments', 'postfix-completion', 'live-templates', 'surround-with',
  'smart-join-lines', 'extract-string-resource', 'screen-flow-map', 'udf-xray',
  'compose-outline', 'lifecycle-pairing', 'dispatcher-lens', 'room-migration-drift',
  'unused-imports', 'resource-usage-badges', 'dependency-usage-badges',
  'manifest-necessity', 'resource-shadowing', 'reverse-string-map',
  'method-separators', 'android-project-view', 'recent-locations',
];

function resolveNames(args: string[]): string[] {
  if (args.length === 0 || args[0] === 'kj') return KJ;
  if (args[0] === '--all') {
    return readdirSync(DEMOS_DIR)
      .filter(f => f.endsWith('.demo.ts'))
      .map(f => f.replace('.demo.ts', ''));
  }
  return args;
}

interface Result {
  name: string;
  status: 'ok' | 'creuse' | 'trop-lourde' | 'erreur';
  mb: number;
  detail: string;
}

function record(name: string): Result {
  const script = path.join(DEMOS_DIR, `${name}.demo.ts`);
  if (!existsSync(script)) {
    return { name, status: 'erreur', mb: 0, detail: 'script introuvable' };
  }
  let out = '';
  try {
    out = execFileSync('node', [path.join(REPO_ROOT, 'dist', 'demo', 'record.js'), script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    // Les échecs de pertinence portent un message dédié : on le remonte tel quel.
    const hollow = /(DEMO NON PERTINENTE|BADGE HORS CADRE)[^\n]*/.exec(out);
    if (hollow) return { name, status: 'creuse', mb: 0, detail: hollow[0].slice(0, 96) };
    // Le stderr de VS Code est bruyant (extensions non chargées, avertissements
    // GPU…). On cherche la vraie cause, sinon on dit qu'on ne sait pas —
    // plutôt que de remonter la dernière ligne venue.
    const NOISE = /mermaid|chatParticipant|GPU|DeprecationWarning|update#|storage/i;
    const real = out
      .split('\n')
      .filter(l => l.trim() && !NOISE.test(l))
      .reverse()
      .find(l => /error|fail|timeout|throw|✗/i.test(l));
    return {
      name,
      status: 'erreur',
      mb: 0,
      detail: (real ?? 'cause non identifiée, relancer seul pour le log complet').slice(0, 96),
    };
  }

  const webp = path.join(OUT_DIR, `${name}.webp`);
  if (!existsSync(webp)) {
    return { name, status: 'erreur', mb: 0, detail: 'aucun fichier produit' };
  }
  const mb = statSync(webp).size / 1048576;
  if (mb > MAX_MB) {
    return { name, status: 'trop-lourde', mb, detail: `${mb.toFixed(1)} MB > ${MAX_MB} MB` };
  }
  return { name, status: 'ok', mb, detail: '' };
}

const names = resolveNames(process.argv.slice(2));
console.log(`[batch] ${names.length} demo(s) à enregistrer\n`);

const results: Result[] = [];
for (const [i, name] of names.entries()) {
  process.stdout.write(`  [${String(i + 1).padStart(2)}/${names.length}] ${name.padEnd(26)}`);
  const r = record(name);
  results.push(r);
  const badge = { ok: '✓', creuse: '✗ CREUSE', 'trop-lourde': '✗ LOURDE', erreur: '✗ ERREUR' }[r.status];
  console.log(`${badge} ${r.mb > 0 ? `${r.mb.toFixed(1)} MB` : ''} ${r.detail}`);
}

const ko = results.filter(r => r.status !== 'ok');
const total = results.reduce((s, r) => s + r.mb, 0);
console.log(
  `\n[batch] ${results.length - ko.length}/${results.length} valides · ${total.toFixed(0)} MB au total`,
);
if (ko.length > 0) {
  console.log('\n[batch] à corriger :');
  for (const r of ko) console.log(`  ${r.name} — ${r.detail}`);
  process.exit(1);
}
