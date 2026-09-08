import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

import { LogcatService } from '../../src/logcat/LogcatService';
import { adbCommandFor } from '../../src/commands/AndroidRunCommand';
import type { Logger } from '../../src/util/logger';

// Audit 34 : Logcat et lancement sur appareil.

const noopLog: Logger = {
  channel: { appendLine: () => {} } as any,
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
} as any;

const fakeIndex = { lookupFqn: () => undefined } as any;

function entry(ts: number, pid = 1000) {
  return { ts, pid, tid: pid, level: 'I', tag: 'T', message: 'm', seq: ts } as any;
}

describe('Reprise du flux après un Clear', () => {
  it('l\'ancre de reprise survit au vidage de la vue', () => {
    const svc = new LogcatService(fakeIndex, noopLog);
    expect(svc.resumeSince()).toBeUndefined();
    (svc as any).onEntry(entry(Date.UTC(2026, 3, 29, 10, 32, 11, 214)));
    const anchor = svc.resumeSince();
    expect(anchor).toBeTruthy();

    svc.clear();
    // Avant : l'ancre était lue dans le tampon circulaire, que Clear vide.
    // Le flux repartait alors sans -T et rejouait tout le buffer de l'appareil.
    expect(svc.resumeSince()).toBe(anchor);
    svc.dispose();
  });

  it('l\'ancre avance avec la dernière ligne reçue', () => {
    const svc = new LogcatService(fakeIndex, noopLog);
    (svc as any).onEntry(entry(Date.UTC(2026, 3, 29, 10, 0, 0, 0)));
    const first = svc.resumeSince();
    (svc as any).onEntry(entry(Date.UTC(2026, 3, 29, 11, 0, 0, 0)));
    expect(svc.resumeSince()).not.toBe(first);
    svc.dispose();
  });
});

describe('Suivi des PID de l\'application', () => {
  function svcFollowing(pkg: string) {
    const svc = new LogcatService(fakeIndex, noopLog);
    (svc as any).filter.followedPackage = pkg;
    (svc as any).filter.followAppPid = true;
    return svc;
  }

  it('un redémarrage de l\'application oublie les PID de la génération précédente', () => {
    const svc = svcFollowing('com.example.app');
    svc.noteProcessStart(4600, 'com.example.app', false);
    svc.noteProcessStart(4611, 'com.example.app', true);
    expect([...(svc as any).filter.followedPids].sort()).toEqual([4600, 4611]);

    // L'utilisateur relance l'app depuis le launcher : nouveau processus principal.
    svc.noteProcessStart(5200, 'com.example.app', false);
    // Avant : {4600, 4611, 5200}, et dès qu'Android recyclait 4600 pour une
    // autre application ses lignes passaient le filtre Follow.
    expect([...(svc as any).filter.followedPids]).toEqual([5200]);
    expect((svc as any).filter.followedPid).toBe(5200);
    svc.dispose();
  });

  it('un processus secondaire s\'ajoute sans effacer le principal', () => {
    const svc = svcFollowing('com.example.app');
    svc.noteProcessStart(4600, 'com.example.app', false);
    svc.noteProcessStart(4700, 'com.example.app', true);
    expect([...(svc as any).filter.followedPids].sort()).toEqual([4600, 4700]);
    expect((svc as any).filter.followedPid).toBe(4600);
    svc.dispose();
  });

  it('un autre paquet ne touche à rien', () => {
    const svc = svcFollowing('com.example.app');
    svc.noteProcessStart(4600, 'com.example.app', false);
    svc.noteProcessStart(9999, 'com.other.app', false);
    expect([...(svc as any).filter.followedPids]).toEqual([4600]);
    svc.dispose();
  });
});

describe('Chemin adb passé au terminal intégré', () => {
  it('PowerShell reçoit l\'opérateur d\'appel, comme pour gradlew', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
      // Avant : la ligne commençait par un chemin entre guillemets, que
      // PowerShell affiche au lieu de l'exécuter. Le lancement échouait sans
      // message utile.
      expect(adbCommandFor('C:\\Android SDK\\platform-tools\\adb.exe', ps))
        .toBe('& "C:\\Android SDK\\platform-tools\\adb.exe"');
      expect(adbCommandFor('C:\\Android SDK\\platform-tools\\adb.exe', 'C:\\Windows\\System32\\cmd.exe'))
        .toBe('"C:\\Android SDK\\platform-tools\\adb.exe"');
      // Un chemin sans espace n'a besoin ni de guillemets ni de l'opérateur.
      expect(adbCommandFor('C:\\Android\\platform-tools\\adb.exe', ps))
        .toBe('C:\\Android\\platform-tools\\adb.exe');
    } finally {
      Object.defineProperty(process, 'platform', { value: original });
    }
    expect(adbCommandFor('/usr/local/bin/adb', '/bin/zsh')).toBe('/usr/local/bin/adb');
    expect(adbCommandFor('/Users/me/Android Sdk/adb', '/bin/zsh')).toBe('"/Users/me/Android Sdk/adb"');
  });
});
