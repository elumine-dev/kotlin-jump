// Host ↔ webview message contract for the Logcat panel.
// `apiVersion` lets us evolve the schema without breaking already-loaded webviews.

import type { AdbDevice } from '../android/AdbBinary';

export const LOGCAT_API_VERSION = 1;

export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F';

/** A resolved stack frame in a log message — character range + nav target. */
export interface ResolvedFrame {
  startCol: number;          // offset in the message string (post-newline-join)
  endCol:   number;
  fqn:      string;
  method:   string;
  file:     string;
  line:     number;
  uri?:     string;          // present when SymbolIndex resolved the FQN
  obfuscated?: boolean;      // true when the FQN looks R8-obfuscated and unresolved
}

export interface LogEntry {
  seq:    number;            // monotonic id assigned by the ring buffer
  ts:     number;            // epoch ms (parsed in HOST tz — used only for sorting)
  tsDisplay: string;         // device-emitted "HH:MM:SS.mmm" — what to render. Stable across host TZ.
  pid:    number;
  tid:    number;
  level:  LogLevel;
  tag:    string;
  message: string;           // multi-line; continuation rows are joined with '\n'
  isStackFrame?: boolean;    // pre-tagged when message contains at least one frame
  frames?:       ResolvedFrame[];
  // Reserved for v1.1 — emitted blank in v1, webview ignores undefined.
  packageName?: string;
  uid?:         number;
  crashGroupId?: number;
  lifecycle?:   'fg' | 'bg' | 'killed' | 'crash' | 'anr';
}

// ── Host → webview ────────────────────────────────────────────────────────────

export type HostToView =
  | { apiVersion: number; type: 'init'; state: ViewState }
  | { apiVersion: number; type: 'append'; rows: LogEntry[] }
  | { apiVersion: number; type: 'hydrate'; rows: LogEntry[] }
  | { apiVersion: number; type: 'reset' }
  | { apiVersion: number; type: 'devices'; devices: AdbDevice[] }
  | { apiVersion: number; type: 'packages'; serial: string; packages: string[] }
  | { apiVersion: number; type: 'state'; paused: boolean; bufferUsed: number; bufferCap: number; throughputPerSec: number; streaming: boolean }
  | { apiVersion: number; type: 'adb-missing' }
  | { apiVersion: number; type: 'release-build-detected' }
  | { apiVersion: number; type: 'stream-error'; message: string }
  | { apiVersion: number; type: '_demoFlash'; seq: number; frameIndex: number };

export interface ViewState {
  selectedSerial?: string;
  selectedPackage?: string;
  followAppPid:   boolean;
  paused:         boolean;
  colorScheme:    'studio' | 'monochrome' | 'high-contrast';
  bufferCap:      number;
}

// ── Webview → host ────────────────────────────────────────────────────────────

export type ViewToHost =
  | { apiVersion: number; type: 'ready' }
  | { apiVersion: number; type: 'pickDevice'; serial: string }
  | { apiVersion: number; type: 'pickPackage'; packageName: string }
  | { apiVersion: number; type: 'setLevels'; levels: LogLevel[] }
  | { apiVersion: number; type: 'setSearch'; query: string }
  | { apiVersion: number; type: 'setTagFilter'; tag: string }
  | { apiVersion: number; type: 'setFollowAppPid'; enabled: boolean }
  | { apiVersion: number; type: 'pause' }
  | { apiVersion: number; type: 'resume' }
  | { apiVersion: number; type: 'clear' }
  | { apiVersion: number; type: 'export' }
  | { apiVersion: number; type: 'navigate'; uri: string; line: number }
  | { apiVersion: number; type: 'requestPackages'; serial: string };

export function makeHostMsg<T extends Omit<HostToView, 'apiVersion'>>(msg: T): HostToView {
  return { apiVersion: LOGCAT_API_VERSION, ...msg } as HostToView;
}
