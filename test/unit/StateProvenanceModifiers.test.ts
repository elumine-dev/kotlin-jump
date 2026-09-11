/**
 * KJ-014 — les etats declares avec `override` n'avaient aucune lentille.
 *
 * `DECL_RE` n'acceptait que `private`, `internal` et `protected` avant `val`.
 * Un `override val state: StateFlow<UiState> = MutableStateFlow(UiState())`,
 * la forme meme d'une interface de ViewModel, ne correspondait donc a rien.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse, 3558 fichiers Kotlin :
 * 518 lignes portent un constructeur d'etat, 306 etaient reconnues comme
 * declarations, et **13** le deviennent avec la liste de modificateurs
 * complete, soit 4 pour cent des etats du projet qui n'avaient pas de
 * lentille. Ce sont de vraies proprietes `MutableStateFlow`, ecrites par
 * `.value =` et `.update`, donc le compte affiche est juste des qu'elles
 * sont vues.
 *
 * Limite assumee et mesuree : `var model by mutableStateOf(null)`, 24 sur le
 * projet, reste hors champ. Ses ecritures sont des affectations nues
 * (`model = x`), pas des `.value =`, donc la reconnaitre sans changer aussi
 * la detection d'ecriture afficherait « 0 write » sur des etats bien ecrits.
 */
import { describe, it, expect } from 'vitest';
import { analyzeStateProvenance } from '../../src/providers/StateProvenanceProvider';

const NL = String.fromCharCode(10);
const vm = (corps: string[]) => ['class Vm : Contract {', ...corps.map(l => '    ' + l), '}'].join(NL);
const noms = (code: string) => analyzeStateProvenance(code).map(s => s.property);

describe('analyzeStateProvenance — la liste des modificateurs', () => {
  it('override val est un etat comme un autre', () => {
    const etats = analyzeStateProvenance(vm([
      'override val state: StateFlow<UiState> = MutableStateFlow(UiState())',
    ]));
    expect(etats.map(s => s.property)).toEqual(['state']);
    expect(etats[0].kind).toBe('stateflow');
    expect(etats[0].line).toBe(1);
  });

  it('temoin : private val reste reconnu', () => {
    expect(noms(vm(['private val _x = MutableStateFlow(0)']))).toEqual(['_x']);
  });

  it('open, lateinit et public passent aussi', () => {
    expect(noms(vm([
      'open var a = MutableLiveData<Int>()',
      'public val b = MutableSharedFlow<String>()',
      'internal val c = MutableStateFlow(1)',
    ]))).toEqual(['a', 'b', 'c']);
  });

  it('les ecritures d un override val sont comptees', () => {
    const etats = analyzeStateProvenance(vm([
      'override val state = MutableStateFlow(0)',
      'fun charger() {',
      '    state.value = 1',
      '    state.update { it + 1 }',
      '}',
    ]));
    expect(etats).toHaveLength(1);
    expect(etats[0].directWrites).toBe(2);
  });

  it('sans aucun modificateur, c est un etat aussi', () => {
    expect(noms(vm(['val compteur = MutableStateFlow(0)']))).toEqual(['compteur']);
  });

  it('temoin : une declaration DANS une chaine ne compte pas', () => {
    // Les commentaires sont neutralises, pas les chaines : l ancre de debut
    // d instruction est ce qui empeche de lire une declaration citee.
    expect(noms(vm(['val exemple = "private val _faux = MutableStateFlow(0)"']))).toEqual([]);
  });

  it('temoin : un constructeur qui n est pas une declaration ne compte pas', () => {
    expect(noms(vm([
      'fun neuf(): StateFlow<Int> {',
      '    return MutableStateFlow(0)',
      '}',
    ]))).toEqual([]);
  });

  it('temoin : une declaration en commentaire ne compte pas', () => {
    expect(noms(vm(['// private val _mort = MutableStateFlow(0)']))).toEqual([]);
  });

  it('limite assumee : la delegation `by` reste hors champ', () => {
    // La reconnaitre sans traiter les affectations nues afficherait « 0 write ».
    expect(noms(vm(['private var model by mutableStateOf<Model?>(null)']))).toEqual([]);
  });
});
