import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync('/tmp/gaps.json', 'utf8'));
const bt = '`';
const par = {};
for (const f of r.testResults) {
  const base = f.name.split('/').pop();
  const cle = base.split('.')[0];
  const src = fs.readFileSync(f.name, 'utf8');
  // Seulement les APPELS : une ligne dont le premier mot est `it.fails(`.
  // Les docstrings de ces fichiers citent `it.fails()` en prose, et les
  // compter faisait dire au tableau que G1 avait 11 cas positifs pour 1 vert.
  const fails = src.split('\n').filter(l => /^\s*it\.fails\(/.test(l)).length;
  let passes = 0, echecs = 0, skip = 0;
  for (const a of f.assertionResults) {
    if (a.status === 'passed') passes++;
    else if (a.status === 'failed') echecs++;
    else skip++;
  }
  par[cle] = { verts: passes - fails, echecs, fails, skip, fichier: base };
}
console.log('| Trou | Fichier | Verts | Rouges | ' + bt + 'it.fails()' + bt + ' | Skippés |');
console.log('|---|---|---|---|---|---|');
for (const [k, v] of Object.entries(par).sort()) {
  const num = k.replace(/^G0/, 'G');
  console.log(`| ${num} | ${bt}${v.fichier}${bt} | ${v.verts} | ${v.echecs} | ${v.fails} | ${v.skip || ''} |`);
}
const T = Object.values(par).reduce((a, v) => ({ v: a.v + v.verts, r: a.r + v.echecs, f: a.f + v.fails, s: a.s + v.skip }), { v: 0, r: 0, f: 0, s: 0 });
console.log(`\nTOTAUX : ${T.v} verts, ${T.r} rouges, ${T.f} it.fails, ${T.s} skippés = ${T.v + T.r + T.f + T.s} cas`);
