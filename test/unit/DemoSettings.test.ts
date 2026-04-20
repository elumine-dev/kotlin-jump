/**
 * Schema test for `scripts/demo/fixtures/demo-settings.json`.
 *
 * This fixture drives 50 VS Code keys that shape every demo we ship. A
 * silent toggle (e.g. `editor.fontSize: 14` after a careless merge) would
 * degrade every future recording without failing any other test — the
 * E2E palette/fade assertions still pass on a 14 pt editor, they just
 * produce a mobile-unreadable WebP.
 *
 * We assert each key the playbook §6 considers mandatory. `Other`
 * preferences (cursorBlinking, autoSave, …) are not asserted: they are
 * aesthetic and can change without shipping harm.
 *
 * Justifications are inlined in each test name — they travel with the
 * assertion so a future dev touching the file reads "why 18 pt?" right next
 * to the failing expectation.
 */

import { describe, it, expect } from 'vitest';
import * as fs   from 'node:fs';
import * as path from 'node:path';

const SETTINGS_PATH = path.resolve(
  __dirname, '..', '..', 'scripts', 'demo', 'fixtures', 'demo-settings.json',
);

const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as Record<string, unknown>;

describe('DemoSettings — playbook §6 mobile-first readability', () => {
  it('editor.fontSize = 18 (20 pt is the mobile-safe minimum after 0.75× WebP downscale)', () => {
    expect(settings['editor.fontSize']).toBe(18);
  });
  it('editor.lineHeight = 28 (matches fontSize 18, slight expansion for air)', () => {
    expect(settings['editor.lineHeight']).toBe(28);
  });
});

describe('DemoSettings — chrome hidden (≤4 elements on screen rule)', () => {
  it('workbench.activityBar.location = "hidden"', () => {
    expect(settings['workbench.activityBar.location']).toBe('hidden');
  });
  it('workbench.statusBar.visible = false', () => {
    expect(settings['workbench.statusBar.visible']).toBe(false);
  });
  it('workbench.editor.showTabs = "multiple" (auto-shown only when 2+ files open)', () => {
    // "multiple" matches the playbook §6 rule out of the box:
    //   - single-file demo → tabs hidden (less chrome, more focus on code)
    //   - cross-file demo  → tabs appear automatically as a second editor opens
    // stage.showTabs() is now a no-op kept for back-compat with existing demos.
    expect(settings['workbench.editor.showTabs']).toBe('multiple');
  });
  it('editor.minimap.enabled = false', () => {
    expect(settings['editor.minimap.enabled']).toBe(false);
  });
  it('editor.scrollbar.vertical = "hidden"', () => {
    expect(settings['editor.scrollbar.vertical']).toBe('hidden');
  });
  it('editor.scrollbar.horizontal = "hidden"', () => {
    expect(settings['editor.scrollbar.horizontal']).toBe('hidden');
  });
  it('breadcrumbs.enabled = false', () => {
    expect(settings['breadcrumbs.enabled']).toBe(false);
  });
  it('window.menuBarVisibility = "hidden"', () => {
    expect(settings['window.menuBarVisibility']).toBe('hidden');
  });
  it('editor.overviewRulerBorder = false', () => {
    expect(settings['editor.overviewRulerBorder']).toBe(false);
  });
  it('editor.stickyScroll.enabled = false (would add a second overlay band)', () => {
    expect(settings['editor.stickyScroll.enabled']).toBe(false);
  });
  it('editor.lightbulb.enabled = "off" (surprise quickfix popups break the demo)', () => {
    expect(settings['editor.lightbulb.enabled']).toBe('off');
  });
});

describe('DemoSettings — window positioning infrastructure', () => {
  it('window.title contains "KJ_DEMO_RECORDING_WINDOW" (AppleScript fallback matches this marker when PID lookup is unavailable)', () => {
    // The setting is a VS Code template — must include template
    // placeholders so the settings parser accepts it, but also embed the
    // marker for the name-contains fallback in `checkRecordingWindow`.
    expect(settings['window.title']).toContain('KJ_DEMO_RECORDING_WINDOW');
    expect(String(settings['window.title'])).toMatch(/\$\{[a-zA-Z]+\}/);
  });
  it('window.titleBarStyle = "custom" (native macOS title bar would cover the marker)', () => {
    expect(settings['window.titleBarStyle']).toBe('custom');
  });
  it('workbench.startupEditor = "none" (no Welcome tab that the runner has to race-close)', () => {
    expect(settings['workbench.startupEditor']).toBe('none');
  });
});

describe('DemoSettings — reproducibility (playbook §2-bis priority #1)', () => {
  it('workbench.colorTheme = "Default Dark Modern" (pinned theme)', () => {
    expect(settings['workbench.colorTheme']).toBe('Default Dark Modern');
  });
  it('window.zoomLevel = 0 (baseline DPR; any zoom breaks pixel-coord overlays)', () => {
    expect(settings['window.zoomLevel']).toBe(0);
  });
  it('telemetry.telemetryLevel = "off" (no HTTP traffic during recording)', () => {
    expect(settings['telemetry.telemetryLevel']).toBe('off');
  });
  it('update.mode = "none" (no update prompts during recording)', () => {
    expect(settings['update.mode']).toBe('none');
  });
  it('extensions.autoCheckUpdates = false', () => {
    expect(settings['extensions.autoCheckUpdates']).toBe(false);
  });
  it('extensions.autoUpdate = false', () => {
    expect(settings['extensions.autoUpdate']).toBe(false);
  });
  it('git.enabled = false (the git decorator introduces per-worktree non-determinism)', () => {
    expect(settings['git.enabled']).toBe(false);
  });
});
