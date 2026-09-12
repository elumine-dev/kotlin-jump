import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-029 / KJ-031 — la classe R importee, sous ses trois formes.
 *
 * Le collecteur n'acceptait que `R.kind.name`. Un fichier qui importe la
 * classe imbriquee (`import ca.foo.R.color`) ecrit ensuite `color.name`, sans
 * jamais epeler `R.`, et la reference devenait invisible.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse : 7 fichiers importent un
 * `R.<kind>` imbrique, 5 aliasent la classe R. Deux couleurs vivantes,
 * `vertical_video_post_background_color` et `vertical_video_post_border_color`,
 * ont ete signalees mortes puis supprimees, et `:rubicon:component-feed`
 * a cesse de compiler :
 *   e: VerticalVideoItemComposable.kt:68:54 Unresolved reference.
 *
 * Le piege dans l'autre sens est `import android.R.style` : c'est le R de la
 * plateforme, et `style.Theme_Holo` ne garde aucune de nos cles en vie.
 */

const mod: any = await importOrNull('src/util/xmlRefs');

const VALUE_KINDS = ['string', 'color', 'dimen', 'style', 'attr', 'integer', 'bool', 'array', 'plurals'];
const FILE_KINDS = ['layout', 'menu', 'anim', 'animator', 'raw', 'drawable', 'mipmap'];

const refs = (code: string) =>
  mod.collectValueResourceRefs(code, '/a/src/main/java/A.kt', VALUE_KINDS).map((r: any) => `${r.kind}/${r.name}`);
const fileRefs = (code: string) =>
  mod.collectCodeResourceRefs(code, FILE_KINDS).map((r: any) => `${r.kind}/${r.name}`);

describe.skipIf(!mod)('la classe R importee', () => {
  it('le cas de LaPresse : import du R imbrique puis usage nu', () => {
    const code = [
      'package nuglif.rubicon.foundation.feed.ui.post.generic.verticalvideo',
      'import androidx.compose.ui.res.colorResource',
      'import nuglif.rubicon.feed.R.color',
      'fun VerticalVideoItem() {',
      '    Column(modifier = Modifier.background(',
      '        color = colorResource(id = color.vertical_video_post_background_color)))',
      '}',
    ].join('\n');
    expect(refs(code)).toContain('color/vertical_video_post_background_color');
  });

  it('le R imbrique aliase', () => {
    const code = [
      'import nuglif.rubicon.base.R.color as baseColor',
      'val c = colorResource(baseColor.text_hyper_link_blue)',
    ].join('\n');
    expect(refs(code)).toContain('color/text_hyper_link_blue');
  });

  it('la classe R elle meme aliasee', () => {
    const code = [
      'import ca.lapresse.lapresseplus.R as AppR',
      'val s = getString(AppR.string.hello)',
    ].join('\n');
    expect(refs(code)).toContain('string/hello');
  });

  it('les fichiers de ressources connaissent les memes trois formes', () => {
    expect(fileRefs('import ca.foo.R.drawable\nval d = drawable.ic_close')).toContain('drawable/ic_close');
    expect(fileRefs('import ca.foo.R as AppR\nval l = AppR.layout.activity_main')).toContain('layout/activity_main');
    expect(fileRefs('import ca.foo.R.layout as L\nsetContentView(L.activity_main)')).toContain('layout/activity_main');
  });

  it('temoin : android.R n est pas le notre', () => {
    const code = [
      'import android.R.style',
      'val d = Dialog(context, style.Theme_Holo_Light)',
    ].join('\n');
    expect(refs(code)).not.toContain('style/Theme_Holo_Light');
  });

  it('temoin : sans import de R, un nom nu ne garde rien en vie', () => {
    // Sans cette garde, toute propriete lue sur une variable nommee `color`
    // ou `style` marquerait une cle morte comme vivante, et le detecteur
    // deviendrait muet sur le projet entier.
    expect(refs('val teinte = palette.color.primary')).not.toContain('color/primary');
    expect(refs('val n = style.name')).not.toContain('style/name');
  });

  it('temoin : la forme R.kind.name marche toujours', () => {
    expect(refs('val c = R.color.primary')).toContain('color/primary');
    expect(fileRefs('setContentView(R.layout.activity_main)')).toContain('layout/activity_main');
  });

  it('temoin : un import de R imbrique n ouvre que SON type', () => {
    const code = [
      'import ca.foo.R.color',
      'val a = color.primary',
      'val b = string.hello',
    ].join('\n');
    const out = refs(code);
    expect(out).toContain('color/primary');
    expect(out).not.toContain('string/hello');
  });
});
