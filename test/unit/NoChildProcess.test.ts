import { describe, it, expect, vi, beforeEach } from 'vitest';

// Un test unitaire qui lance un processus enfant dépend de la machine, laisse
// derrière lui le minuteur de reconnexion de 2 s et ralentit la suite. Deux
// tests de Logcat appelaient `switchDevice`, qui lance un vrai `adb logcat`,
// et passaient quand même : le test qui passe pour une mauvaise raison.

const calls: string[][] = [];

vi.mock('../../src/android/AdbBinary', () => ({
  spawnAdb: (args: string[]) => { calls.push(args); throw new Error('spawnAdb interdit dans la suite unitaire'); },
  runAdb: (args: string[]) => { calls.push(args); return Promise.resolve(undefined); },
  runShell: () => Promise.resolve(undefined),
  resolveAdbPath: () => '/fake/adb',
  invalidateAdbPathCache: () => {},
  watchAdbPathSetting: () => ({ dispose: () => {} }),
  parseDevicesOutput: () => [],
}));

const noopLog: any = {
  channel: { appendLine: () => {} },
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
};

beforeEach(() => { calls.length = 0; });

describe('Aucun lancement adb depuis la suite unitaire', () => {
  it('changer d\'appareil ne lance rien quand le flux est neutralisé', async () => {
    const { LogcatService } = await import('../../src/logcat/LogcatService');
    const svc: any = new LogcatService({ lookupFqn: () => undefined } as any, noopLog);
    svc.startStream = () => {};
    svc.currentSerial = 'PIXEL7';
    svc.onEntry({ ts: Date.UTC(2026, 3, 29, 22, 0, 0), pid: 1, tid: 1, level: 'I', tag: 'T', message: 'm', seq: 1 });
    svc.switchDevice('PIXEL7');
    svc.switchDevice('emulator-5554');
    svc.clear();
    svc.dispose();
    expect(calls).toEqual([]);
  });

  it('construire le service, lire l\'ancre et suivre un PID ne lancent rien', async () => {
    const { LogcatService } = await import('../../src/logcat/LogcatService');
    const svc: any = new LogcatService({ lookupFqn: () => undefined } as any, noopLog);
    svc.resumeSince();
    svc.noteProcessStart(4600, 'com.example.app', false);
    svc.dispose();
    expect(calls).toEqual([]);
  });
});
