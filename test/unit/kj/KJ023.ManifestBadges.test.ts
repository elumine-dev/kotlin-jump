import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

/**
 * KJ-023 — Badges de nécessité Manifest. CONTRAT :
 *   export function analyzeManifest(manifestXml: string, project: {
 *     classExists(fqn: string): boolean;
 *     searchApiUsage(patterns: string[]): string[];  // fichiers touchés
 *   }): {
 *     permissions: { name: string; status: 'used' | 'unused' | 'maybe-lib'; files: string[] }[];
 *     components: { name: string; status: 'ok' | 'missing-class' | 'unreferenced' }[];
 *   }
 */
const mod: any = await importOrNull('src/providers/ManifestNecessityProvider');
const manifest = () => fixture('src/main/AndroidManifest.xml');

const projectStub = (usedApis: Record<string, string[]> = {}, classes: string[] = []) => ({
  classExists: (fqn: string) => classes.includes(fqn),
  searchApiUsage: (patterns: string[]) =>
    patterns.flatMap((p) => usedApis[p] ?? []),
});

describe.skipIf(!mod)('KJ-023 — analyse du manifest fixture', () => {
  it('READ_SMS → unused (aucune API SMS dans le projet)', () => {
    const r = mod.analyzeManifest(manifest(), projectStub());
    const sms = r.permissions.find((p: any) => p.name.endsWith('READ_SMS'));
    expect(sms?.status).toBe('unused');
  });

  it('GhostActivity → missing-class', () => {
    const r = mod.analyzeManifest(
      manifest(),
      projectStub({}, ['com.example.kotlinjumpdemo.MainActivity'])
    );
    const ghost = r.components.find((c: any) => c.name.endsWith('GhostActivity'));
    expect(ghost?.status).toBe('missing-class');
  });

  it('DeepLinkActivity référencé par intent-filter → PAS unreferenced', () => {
    const r = mod.analyzeManifest(manifest(), projectStub());
    const deep = r.components.find((c: any) => c.name.endsWith('DeepLinkActivity'));
    expect(deep?.status).not.toBe('unreferenced');
  });

  it('permission avec usage détecté → used avec fichiers', () => {
    const r = mod.analyzeManifest(
      manifest(),
      projectStub({ 'CameraX|Camera2|camera': ['CameraController.kt'] })
    );
    const cam = r.permissions.find((p: any) => p.name.endsWith('CAMERA'));
    expect(cam?.status).toBe('used');
    expect(cam?.files).toContain('CameraController.kt');
  });

  it('jamais d’affirmation trompeuse : statut ternaire respecté', () => {
    const r = mod.analyzeManifest(manifest(), projectStub());
    for (const p of r.permissions) {
      expect(['used', 'unused', 'maybe-lib']).toContain(p.status);
    }
  });
});
