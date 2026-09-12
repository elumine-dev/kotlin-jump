import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-049 — ou se pose `private` sur une ligne de declaration.
 *
 * Un seul endroit, partage par l'ampoule par membre et par la commande de
 * masse. Les deux existaient deja comme deux copies des trois memes lignes, et
 * une copie est exactement la maniere dont un correctif cesse de correspondre
 * a son propre diagnostic.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse : 142 membres « pourrait etre
 * prive », soit 142 clics sur une ampoule.
 */

const mod: any = await importOrNull('src/providers/narrowToPrivate');
const pose = (ligne: string) => {
  const e = mod.narrowToPrivate(ligne);
  return e === undefined ? undefined : ligne.slice(0, e.column) + e.text + ligne.slice(e.column + e.length);
};

describe.skipIf(!mod)('narrowToPrivate', () => {
  it('remplace le modificateur present', () => {
    expect(pose('    public fun draw() {')).toBe('    private fun draw() {');
    expect(pose('    internal val x = 1')).toBe('    private val x = 1');
    expect(pose('    protected fun onDraw() {')).toBe('    private fun onDraw() {');
  });

  it('insere a l indentation quand il n y en a pas', () => {
    expect(pose('    fun draw() {')).toBe('    private fun draw() {');
    expect(pose('\t\tval x = 1')).toBe('\t\tprivate val x = 1');
  });

  it('respecte les autres modificateurs', () => {
    expect(pose('    suspend fun load() {')).toBe('    private suspend fun load() {');
    expect(pose('    public suspend fun load() {')).toBe('    private suspend fun load() {');
  });

  it('temoin : une ligne deja privee ne bouge pas', () => {
    expect(mod.narrowToPrivate('    private fun draw() {')).toBeUndefined();
    expect(mod.narrowToPrivate('    private set')).toBeUndefined();
  });

  it('temoin : une ligne vide ne recoit rien', () => {
    expect(mod.narrowToPrivate('')).toBeUndefined();
    expect(mod.narrowToPrivate('    ')).toBeUndefined();
  });

  it('temoin : une propriete de constructeur primaire reste valide', () => {
    expect(pose('    val titre: String,')).toBe('    private val titre: String,');
  });
  it('le mot cle est cherche dans les MODIFICATEURS, pas dans la ligne entiere', () => {
    // Premiere version livree : la regex balayait toute la ligne. Un
    // commentaire etait mutile et le membre n etait pas restreint, et pire, le
    // CONTENU d une chaine etait reecrit. Un refactor qui modifie un litteral
    // en silence est pire qu un refactor qui ne fait rien.
    expect(pose('    fun draw() { // make public later'))
      .toBe('    private fun draw() { // make public later');
    expect(pose('    val label = "make it public "'))
      .toBe('    private val label = "make it public "');
  });

  it('un commentaire qui contient le mot prive ne fait plus renoncer', () => {
    expect(pose('    fun draw() { // not private')).toBe('    private fun draw() { // not private');
  });

  it('private se pose APRES les annotations', () => {
    expect(pose('    @Inject lateinit var analytics: Tracker'))
      .toBe('    @Inject private lateinit var analytics: Tracker');
    expect(pose('    @JvmField @Suppress("unused") val x = 1'))
      .toBe('    @JvmField @Suppress("unused") private val x = 1');
  });

  it('temoin : un modificateur reel est toujours remplace, pas double', () => {
    expect(pose('    internal suspend fun load() {')).toBe('    private suspend fun load() {');
  });
  it('les ARGUMENTS d une annotation ne sont pas des modificateurs', () => {
    // Deuxieme couche du meme defaut. La version d avant lisait la suite de
    // modificateurs, mais celle ci contient encore les arguments des
    // annotations. Le pire cas renomme un champ JSON en silence.
    expect(pose('    @SerializedName("internal ") val y = 2'))
      .toBe('    @SerializedName("internal ") private val y = 2');
    expect(pose('    @Suppress("public ") fun draw() {'))
      .toBe('    @Suppress("public ") private fun draw() {');
    expect(pose('    @Deprecated("use the public one ") val x = 1'))
      .toBe('    @Deprecated("use the public one ") private val x = 1');
  });

  it('un vrai modificateur apres une annotation est bien remplace', () => {
    expect(pose('    @Suppress("unused") public fun ok() {'))
      .toBe('    @Suppress("unused") private fun ok() {');
  });

  it('une annotation a parentheses imbriquees est franchie', () => {
    expect(pose('    @Foo(bar(1)) public val z = 1')).toBe('    @Foo(bar(1)) private val z = 1');
    expect(pose('    @RequiresApi(Build.VERSION_CODES.O) fun n() {'))
      .toBe('    @RequiresApi(Build.VERSION_CODES.O) private fun n() {');
  });

  it('une annotation qu on ne sait pas fermer ne donne aucune edition', () => {
    // Plutot que de deviner ou elle se termine : rien.
    expect(mod.narrowToPrivate('    @Foo("(" fun draw() {')).toBeUndefined();
    expect(mod.narrowToPrivate('    @Foo(1, 2 val x = 1')).toBeUndefined();
  });

  it('une parenthese dans une chaine d annotation ne casse pas l equilibre', () => {
    expect(pose('    @Foo("a)b") val w = 1')).toBe('    @Foo("a)b") private val w = 1');
  });
});
