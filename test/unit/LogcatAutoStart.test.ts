import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

import { handleAutoStart, SNOOZE_KEY, type AutoStartDeps } from '../../src/logcat/index';
import type { RunSuccessEvent } from '../../src/android/RunEvents';

function buildDeps(overrides: Partial<AutoStartDeps> = {}): {
  deps: AutoStartDeps;
  switchDevice: ReturnType<typeof vi.fn>;
  setFollowedPackage: ReturnType<typeof vi.fn>;
  startWatching: ReturnType<typeof vi.fn>;
  setActive: ReturnType<typeof vi.fn>;
  showToast: ReturnType<typeof vi.fn>;
  showLogcat: ReturnType<typeof vi.fn>;
  state: Map<string, unknown>;
} {
  const state = new Map<string, unknown>();
  const switchDevice       = vi.fn();
  const setFollowedPackage = vi.fn();
  const startWatching      = vi.fn();
  const setActive          = vi.fn();
  const showToast          = vi.fn().mockResolvedValue(undefined);
  const showLogcat         = vi.fn().mockResolvedValue(undefined);

  const deps: AutoStartDeps = {
    service: {
      listDevices: vi.fn().mockResolvedValue([{ serial: 'emu-1', state: 'device', transport: 'usb' }]),
      switchDevice,
      setFollowedPackage,
      startWatching,
    } as any,
    viewProvider:    { visible: false },
    devicesProvider: { setActive },
    workspaceState: {
      get:    <T>(k: string) => state.get(k) as T | undefined,
      update: async (k: string, v: unknown) => { state.set(k, v); },
    },
    configEnabled: () => true,
    showToast,
    showLogcat,
    log: { debug: vi.fn(), warn: vi.fn() } as any,
    ...overrides,
  };

  return { deps, switchDevice, setFollowedPackage, startWatching, setActive, showToast, showLogcat, state };
}

const RUN_EV: RunSuccessEvent = {
  device: 'emu-1', packageName: 'com.example.app', projectRoot: '/work', at: 1700000000,
};

describe('handleAutoStart', () => {
  it('switches device and shows toast on the happy path', async () => {
    const { deps, switchDevice, setFollowedPackage, showToast } = buildDeps();
    await handleAutoStart(deps, RUN_EV);
    expect(switchDevice).toHaveBeenCalledWith('emu-1');
    expect(setFollowedPackage).toHaveBeenCalledWith('com.example.app');
    expect(showToast).toHaveBeenCalledWith('com.example.app');
  });

  it('respects autoStart=false (no switch, no toast)', async () => {
    const { deps, switchDevice, showToast } = buildDeps({ configEnabled: () => false });
    await handleAutoStart(deps, RUN_EV);
    expect(switchDevice).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('respects snooze (no switch, no toast)', async () => {
    const { deps, switchDevice, showToast, state } = buildDeps();
    state.set(SNOOZE_KEY, true);
    await handleAutoStart(deps, RUN_EV);
    expect(switchDevice).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('skips when device has disconnected since run completed', async () => {
    const { deps, switchDevice, showToast } = buildDeps({
      service: {
        listDevices: vi.fn().mockResolvedValue([{ serial: 'other', state: 'device', transport: 'usb' }]),
        switchDevice: vi.fn(),
        setFollowedPackage: vi.fn(),
        startWatching: vi.fn(),
      } as any,
    });
    // Re-grab the spies via the deps we just built.
    await handleAutoStart(deps, RUN_EV);
    expect(deps.service.switchDevice).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    void switchDevice; // silence unused
  });

  it('does NOT show toast when panel is already visible (quiet path)', async () => {
    const { deps, switchDevice, showToast } = buildDeps({ viewProvider: { visible: true } });
    await handleAutoStart(deps, RUN_EV);
    expect(switchDevice).toHaveBeenCalledWith('emu-1');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('opens Logcat when the toast action is clicked', async () => {
    const { deps, showLogcat } = buildDeps({
      showToast: vi.fn().mockResolvedValue('Show Logcat'),
    });
    await handleAutoStart(deps, RUN_EV);
    expect(showLogcat).toHaveBeenCalled();
  });

  it('does NOT open Logcat when the toast is dismissed', async () => {
    const { deps, showLogcat } = buildDeps({
      showToast: vi.fn().mockResolvedValue(undefined),
    });
    await handleAutoStart(deps, RUN_EV);
    expect(showLogcat).not.toHaveBeenCalled();
  });

  it('marks the device as active in the tree', async () => {
    const { deps, setActive } = buildDeps();
    await handleAutoStart(deps, RUN_EV);
    expect(setActive).toHaveBeenCalledWith('emu-1');
  });

  it('starts the (idempotent) ADB watcher even when snoozed — a Run success is a strong signal on its own', async () => {
    const { deps, startWatching, switchDevice, state } = buildDeps();
    state.set(SNOOZE_KEY, true);
    await handleAutoStart(deps, RUN_EV);
    expect(startWatching).toHaveBeenCalledTimes(1);
    expect(switchDevice).not.toHaveBeenCalled(); // snooze still blocks the actual switch
  });

  it('does not start the watcher when kotlinJump.logcat.autoStart is disabled', async () => {
    const { deps, startWatching } = buildDeps({ configEnabled: () => false });
    await handleAutoStart(deps, RUN_EV);
    expect(startWatching).not.toHaveBeenCalled();
  });
});
