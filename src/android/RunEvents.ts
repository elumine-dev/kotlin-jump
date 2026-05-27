import * as vscode from 'vscode';

/**
 * Payload broadcast by `kotlin-jump.runAndroid` after a successful build + launch.
 * Consumers (Logcat auto-start, future profiler view, future APK-size pill) subscribe
 * via `onRunSuccess` instead of being imported from inside AndroidRunCommand — this
 * keeps the Run command independent of optional features that may be disabled.
 */
export interface RunSuccessEvent {
  device:      string;   // ADB serial used for `adb install`
  packageName: string;   // launched applicationId
  projectRoot: string;   // for future consumers that need workspace context
  at:          number;   // Date.now() at the moment of success
}

const emitter = new vscode.EventEmitter<RunSuccessEvent>();

/** Subscribe to successful runs. Returns a Disposable. */
export const onRunSuccess: vscode.Event<RunSuccessEvent> = emitter.event;

/**
 * Internal — only AndroidRunCommand should call this. Marked with an underscore
 * so the public API surface remains `onRunSuccess` only.
 */
export function _emitRunSuccess(ev: RunSuccessEvent): void {
  emitter.fire(ev);
}
