import { describe, it, expect } from 'vitest';
import {
  classifyDependency,
  aliasToCatalogKey,
  parseCatalogCoordinates,
} from '../../../src/providers/DependencyUsageBadgeProvider';

/** KJ-022 — tentatives de casse au-delà du contrat. */

describe('KJ-022 adversarial', () => {
  it('préfixe piégeux : okhttp3 ne matche pas okhttp3x', () => {
    const r = classifyDependency('com.squareup.okhttp3:okhttp', ['import okhttp3x.Client']);
    expect(r).toEqual({ kind: 'counted', imports: 0 });
  });

  it('import du package exact (sans sous-chemin) compté', () => {
    const r = classifyDependency('com.squareup.retrofit2:retrofit', ['import retrofit2']);
    expect(r).toEqual({ kind: 'counted', imports: 1 });
  });

  it('hilt : dagger, dagger.hilt et javax.inject comptent tous', () => {
    const r = classifyDependency('com.google.dagger:hilt-android', [
      'import dagger.hilt.android.AndroidEntryPoint',
      'import javax.inject.Inject',
      'import dagger.Module',
    ]);
    expect(r).toEqual({ kind: 'counted', imports: 3 });
  });

  it('Compose Multiplatform : artefact org.jetbrains, packages androidx (cas trouvé par Kevin)', () => {
    const imports = [
      'import androidx.compose.runtime.Composable',
      'import androidx.compose.material.Text',
      'import androidx.compose.material.Button',
    ];
    expect(classifyDependency('org.jetbrains.compose.runtime:runtime', imports)).toEqual({
      kind: 'counted',
      imports: 1,
    });
    expect(classifyDependency('org.jetbrains.compose.material:material', imports)).toEqual({
      kind: 'counted',
      imports: 2,
    });
  });

  it('n’importe quel artefact -bom → bom, même inconnu de la table', () => {
    expect(classifyDependency('com.obscure:mystery-bom', [])).toEqual({ kind: 'bom' });
  });

  it('alias multi-points converti (libs.retrofit.core → retrofit-core)', () => {
    expect(aliasToCatalogKey('libs.retrofit.core')).toBe('retrofit-core');
  });

  it('BUG-HUNT-18 : ordre des clés TOML libre ({ name=…, group=… } aussi)', () => {
    const toml = 'gson = { name = "gson", group = "com.google.code.gson", version = "2.10.1" }\n';
    expect(parseCatalogCoordinates(toml).get('gson')).toBe('com.google.code.gson:gson');
  });

  it('toml : forme module= reconnue en plus de group=/name=', () => {
    const toml = 'gson = { module = "com.google.code.gson:gson", version = "2.10.1" }\n' +
      'retrofit-core = { group = "com.squareup.retrofit2", name = "retrofit", version.ref = "retrofit" }\n';
    const map = parseCatalogCoordinates(toml);
    expect(map.get('gson')).toBe('com.google.code.gson:gson');
    expect(map.get('retrofit-core')).toBe('com.squareup.retrofit2:retrofit');
  });
});
