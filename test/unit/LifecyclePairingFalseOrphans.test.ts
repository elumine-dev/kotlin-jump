/**
 * KJ-016 — les deux familles de faux avertissements mesurees sur le vrai projet.
 *
 * Le diagnostic est en Warning et actif par defaut. Passe sur
 * /Users/kevin/Desktop/work/lapresse (5088 sources, 132 fichiers retenus par la
 * garde du fournisseur), il produit 5 avertissements, et 4 sont faux :
 *
 *   3x  onBackPressedDispatcher.addCallback(callback)
 *   1x  viewModel.bind()
 *
 * `onBackPressedDispatcher` appartient a l'Activity : ce qu'on lui ajoute meurt
 * avec elle, exactement comme `lifecycle.addObserver(x)` que le code excluait
 * deja. Et la paire `bind`/`unbind` vise `bindService` : un `bind()` sans aucun
 * argument ne lie aucune ressource, le nom rapporte etait celui du recepteur
 * (« viewModel acquired in onCreate() with no release in onDestroy() »).
 *
 * Le cinquieme, `ngAdView.addListener(this)` dans une Activity de debogage,
 * reste signale : la ressource est bien le recepteur et rien dans le texte ne
 * dit que cette vue meurt avec l'ecran.
 */
import { describe, it, expect } from 'vitest';
import { analyzeLifecyclePairs } from '../../src/providers/LifecyclePairingProvider';

const NL = String.fromCharCode(10);
const orphelins = (lignes: string[]) =>
  analyzeLifecyclePairs(lignes.join(NL)).orphans.map(o => `${o.method}:${o.resource}`);

const ACTIVITE = (corpsCreate: string[], corpsDestroy: string[] = []) => [
  'class Ecran : AppCompatActivity() {',
  '    override fun onCreate(savedInstanceState: Bundle?) {',
  '        super.onCreate(savedInstanceState)',
  ...corpsCreate.map(l => '        ' + l),
  '    }',
  '',
  '    override fun onDestroy() {',
  '        super.onDestroy()',
  ...corpsDestroy.map(l => '        ' + l),
  '    }',
  '}',
];

describe('KJ-016 — onBackPressedDispatcher appartient a l ecran', () => {
  it('addCallback sur le dispatcher n est pas un orphelin', () => {
    expect(orphelins(ACTIVITE(['onBackPressedDispatcher.addCallback(onBackPressedCallback)']))).toEqual([]);
  });

  it('meme avec un objet anonyme en argument', () => {
    expect(orphelins(ACTIVITE([
      'onBackPressedDispatcher.addCallback(',
      '    object : OnBackPressedCallback(true) {',
      '        override fun handleOnBackPressed() {',
      '            finish()',
      '        }',
      '    },',
      ')',
    ]))).toEqual([]);
  });

  it('meme qualifie par requireActivity()', () => {
    expect(orphelins(ACTIVITE(['requireActivity().onBackPressedDispatcher.addCallback(callback)']))).toEqual([]);
  });

  it('mais un autre recepteur reste signale', () => {
    // La garde porte sur CE recepteur la, pas sur le nom de la methode.
    expect(orphelins(ACTIVITE(['monEmetteur.addCallback(callback)']))).toEqual(['addCallback:callback']);
  });

  it('et lifecycle.addObserver reste exclu comme avant', () => {
    expect(orphelins(ACTIVITE(['lifecycle.addObserver(observateur)']))).toEqual([]);
  });
});

describe('KJ-016 — bind sans argument ne lie aucune ressource', () => {
  it('viewModel.bind() n est pas un orphelin', () => {
    expect(orphelins(ACTIVITE(['viewModel.bind()']))).toEqual([]);
  });

  it('mais bind avec un argument le reste', () => {
    expect(orphelins(ACTIVITE(['presenter.bind(vue)']))).toEqual(['bind:vue']);
  });

  it('et il disparait des que onDestroy appelle unbind', () => {
    expect(orphelins(ACTIVITE(['presenter.bind(vue)'], ['presenter.unbind(vue)']))).toEqual([]);
  });
});

describe('KJ-016 — les vrais orphelins restent signales', () => {
  it('registerReceiver sans unregisterReceiver', () => {
    expect(orphelins([
      'class Ecran : AppCompatActivity() {',
      '    override fun onStart() {',
      '        registerReceiver(recepteur, filtre)',
      '    }',
      '',
      '    override fun onStop() {',
      '        super.onStop()',
      '    }',
      '}',
    ])).toEqual(['registerReceiver:recepteur']);
  });

  it('bindService sans unbindService, apparie sur la connexion', () => {
    expect(orphelins([
      'class Ecran : AppCompatActivity() {',
      '    override fun onStart() { bindService(intent, connexion, flags) }',
      '    override fun onStop() { }',
      '}',
    ])).toEqual(['bindService:connexion']);
  });
});
