import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

import { LogcatService } from '../../src/logcat/LogcatService';
import type { Logger } from '../../src/util/logger';
import type { SymbolIndex, SymbolEntry } from '../../src/indexer/SymbolIndex';
import * as vscode from 'vscode';

const noopLog: Logger = { channel: { appendLine: () => {} } as any, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

class FakeIndex {
  private map = new Map<string, SymbolEntry>();
  add(fqn: string, fileUri: string, line = 0): void {
    this.map.set(fqn, {
      name: fqn.split('.').pop() ?? fqn,
      fqn,
      kind: 'class',
      uri: vscode.Uri.parse(fileUri),
      line, character: 0,
      packageName: fqn.split('.').slice(0, -1).join('.'),
      isComposable: false, depth: 0,
    });
  }
  lookupFqn(fqn: string): SymbolEntry | undefined { return this.map.get(fqn); }
}

function writeFixture(lines: string[]): string {
  const file = path.join(os.tmpdir(), `kotlin-jump-logcat-fixture-${Date.now()}-${Math.random()}.log`);
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

const FIXTURE_LINES = [
  '2026-04-29 10:32:11.214  4521  4521 I MyApp   : onCreate begin',
  '2026-04-29 10:32:11.288  4521  4521 E AndroidRuntime: FATAL EXCEPTION: main',
  '2026-04-29 10:32:11.288  4521  4521 E AndroidRuntime: java.lang.NullPointerException: NPE',
  '2026-04-29 10:32:11.288  4521  4521 E AndroidRuntime: \tat com.example.app.MainActivity.onCreate(MainActivity.kt:42)',
];

describe('LogcatService.streamFixture', () => {
  let svc: LogcatService;

  beforeEach(() => {
    const idx = new FakeIndex();
    idx.add('com.example.app.MainActivity', 'file:///work/MainActivity.kt');
    svc = new LogcatService(idx as unknown as SymbolIndex, noopLog, 1000);
  });

  it('marks the demo serial active and emits a fake-device list', async () => {
    const file = writeFixture(FIXTURE_LINES);
    const devices: any[] = [];
    svc.on('devices', d => devices.push(d));

    await svc.streamFixture(file, { speed: 100 });
    expect(svc.getCurrentSerial()).toBe('__demo__');
    expect(devices.length).toBeGreaterThanOrEqual(1);
    const fakeList = devices.find(arr => arr[0]?.serial === '__demo__');
    expect(fakeList).toBeDefined();
    fs.unlinkSync(file);
    svc.dispose();
  });

  it('replays entries and resolves the FATAL frame to the indexed source URI', async () => {
    const file = writeFixture(FIXTURE_LINES);
    await svc.streamFixture(file, { speed: 100 });
    // Speed 100 collapses the pacing to ~0.5 ms per row floor; await the chain
    // explicitly via setTimeout(50) to let all setTimeout(0..) fire.
    await new Promise(r => setTimeout(r, 200));

    const all = svc['buffer'].all() as { tag: string; message: string; frames?: any[] }[];
    expect(all.length).toBe(FIXTURE_LINES.length);

    // The FATAL row must have been merged with continuation frames; the message
    // contains the at-frame line, and `frames` is populated with the resolved URI.
    const fatal = all.find(e => e.message.includes('MainActivity.onCreate(MainActivity.kt:42)'));
    expect(fatal).toBeDefined();
    expect(fatal!.frames).toBeDefined();
    expect(fatal!.frames!.some(f => f.uri === 'file:///work/MainActivity.kt')).toBe(true);
    fs.unlinkSync(file);
    svc.dispose();
  });

  it('demoFlashFrame emits a demo-flash event for the most recent matching entry', async () => {
    const file = writeFixture(FIXTURE_LINES);
    await svc.streamFixture(file, { speed: 100 });
    await new Promise(r => setTimeout(r, 200));

    const flashes: { seq: number; frameIndex: number }[] = [];
    svc.on('demo-flash', payload => flashes.push(payload));
    svc.demoFlashFrame({ tag: 'AndroidRuntime', messageContains: 'MainActivity.onCreate' }, 0);
    expect(flashes).toHaveLength(1);
    expect(flashes[0]!.frameIndex).toBe(0);

    fs.unlinkSync(file);
    svc.dispose();
  });

  it('demoFlashFrame is a no-op when no entry matches', async () => {
    const file = writeFixture(FIXTURE_LINES);
    await svc.streamFixture(file, { speed: 100 });
    await new Promise(r => setTimeout(r, 200));

    const flashes: any[] = [];
    svc.on('demo-flash', p => flashes.push(p));
    svc.demoFlashFrame({ tag: 'NoSuchTag' }, 0);
    expect(flashes).toHaveLength(0);
    fs.unlinkSync(file);
    svc.dispose();
  });

  it('demoClickFrame opens the resolved URI when the frame matches', async () => {
    const file = writeFixture(FIXTURE_LINES);
    await svc.streamFixture(file, { speed: 100 });
    await new Promise(r => setTimeout(r, 200));

    const showSpy = vi.spyOn(vscode.window, 'showTextDocument');
    await svc.demoClickFrame({ tag: 'AndroidRuntime', messageContains: 'MainActivity.onCreate' }, 0);
    expect(showSpy).toHaveBeenCalled();
    const callArg = showSpy.mock.calls[0]![0] as any;
    expect(callArg.toString()).toContain('MainActivity.kt');
    showSpy.mockRestore();
    fs.unlinkSync(file);
    svc.dispose();
  });
});
