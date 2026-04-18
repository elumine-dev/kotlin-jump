# Demo recording pipeline

> **Dev-only tooling.** Nothing in `scripts/demo/` is shipped to end-users —
> `.vscodeignore` excludes it from the VSIX. Extension users installing
> Kotlin Jump from the Marketplace never see or download this code.

## Overview

Automates the production of annotated WebP demos for the README and the
"What's New" panel. You write a `*.demo.ts` script; one command drives a
clean-profile VS Code, captures the screen with ffmpeg, overlays keystroke
banners / click cards / captions, and converts the result to an animated
WebP at `media/demos/<name>.webp`.

## One-time setup

1. **ffmpeg with libwebp** — `brew install ffmpeg` (Homebrew's build
   includes libwebp).
2. **Screen Recording permission** — when you first run the pipeline, macOS
   will ask Terminal (or iTerm) to allow screen recording. Grant it.
   System Settings → Privacy & Security → Screen Recording.
3. **Marker file** — `.kotlin-jump-dev-mode` at the repo root. Already
   committed; the recorder extension refuses to activate without it.

## Quick start

```bash
# Build the pipeline
npm run compile

# Record a demo. Output lands in media/demos/<name>.webp
npm run demo:record scripts/demo/demos/navigation-history.demo.ts
```

## Capture region + window positioning

We use macOS' native `screencapture -v -R x,y,w,h` which takes **global
desktop coordinates** (not per-display indices). That handles multi-monitor
setups transparently.

### How the capture region is chosen

1. The orchestrator tries to find the VS Code window spawned by
   `@vscode/test-electron` and move it to `(KJ_DEMO_WINDOW_X,
   KJ_DEMO_WINDOW_Y)` with size 1280×720 via AppleScript.
2. If that succeeds, the capture region matches that rectangle.
3. If it fails (AppleScript couldn't see the window — see the Accessibility
   note below), it falls back to `(0, 0, 1280, 720)`.
4. You can **override the capture region explicitly** via
   `KJ_DEMO_CAPTURE_X/Y/W/H` — use this if positioning doesn't work but
   you know where your VS Code window ends up.

### Accessibility permission gotcha

`@vscode/test-electron` spawns the VS Code binary from
`.vscode-test/vscode-darwin-arm64-X.Y.Z/Visual Studio Code.app/Contents/MacOS/Electron`,
**not** from your installed `/Applications/Visual Studio Code.app`. On
macOS, Accessibility permission is tied to the binary path, so even if
your main VS Code has permission, this separate copy does not.

Symptom: `[demo] ⚠ window positioning failed — falling back to (0,0)`
with `ERROR:no-demo-recording-window; seen: (Electron)`.

Fix: add the test-electron Electron binary to System Settings →
Privacy & Security → Accessibility and toggle it on. The VS Code version
path includes the version number, so this needs to be redone if the test
runner pulls a new VS Code version.

Alternative without granting Accessibility: set
`KJ_DEMO_CAPTURE_X=<x> KJ_DEMO_CAPTURE_Y=<y>` to the known position where
VS Code will open on your setup, then manually move any other windows
out of that region before invoking `demo:record`.

### All env var overrides

| Variable | Meaning | Default |
|---|---|---|
| `KJ_DEMO_WINDOW_X` / `KJ_DEMO_WINDOW_Y` | Where to move the VS Code window | `0, 0` |
| `KJ_DEMO_CAPTURE_X/Y/W/H` | Force a specific capture rectangle, ignoring where the window ended up | Follows `rect.*` |
| `KJ_DEMO_KEEP_TMP` | Keep `raw.mov`, `annotated.mp4`, `timeline.json` for debugging | unset |

Before recording: make sure no fullscreen app covers the capture region
— macOS puts fullscreen apps in their own Space, and their content is
what gets captured even if VS Code is "logically" at that position.

## Writing a new demo

Create `scripts/demo/demos/<name>.demo.ts`:

```typescript
import { Stage } from '../lib/stage';

export default async function record(stage: Stage): Promise<void> {
  await stage.waitForIndexReady();

  await stage.openFile('src/main/kotlin/com/example/data/Foo.kt', { line: 10, column: 8 });
  await stage.caption('Start on Foo.bar', { duration: 1500 });

  // Cmd+Click → Go to Definition (renders a card at the bottom).
  await stage.click('bar', { modifier: 'Cmd', label: 'Go to Definition' });
  await stage.waitForEditor('FooImpl.kt', 20);
  await stage.pause(1200);

  // Keyboard shortcut (renders a banner top-left).
  await stage.keystroke('⌘ + ⌥ + ←', { label: 'Navigate Back' });
  await stage.runCommand('kotlinJump.navigateBack');
  await stage.waitForEditor('Foo.kt', 10);

  await stage.caption('History preserves line AND column', { duration: 2000 });
}
```

The output WebP will be named `media/demos/<name>.webp` — convention is
enforced: the basename of the demo file (without `.demo.ts`) becomes the
WebP stem. Don't configure this separately.

### Stage API cheat-sheet

| Call | What it does visually |
|---|---|
| `stage.openFile(relPath, { line, column })` | Opens the file at the given cursor position |
| `stage.click(target, { modifier, label })` | Runs Go-to-Definition at cursor; renders a card "Cmd+Click → label" at the bottom-center for 1.5 s |
| `stage.keystroke(shortcut, { label })` | Renders a banner at top-left showing the shortcut + its description for 1.2 s. Doesn't execute anything — follow with `stage.runCommand()`. |
| `stage.runCommand(id, ...args)` | Executes a VS Code command. No overlay. |
| `stage.waitForEditor(fileSuffix, line)` | Blocks until the active editor matches. 4 s timeout. |
| `stage.caption(text, { duration })` | Renders a narrative text overlay centered at the bottom. Use for "why this matters" — blocks for `duration` ms. |
| `stage.pause(ms)` | Dead-beat pause. Use between actions so the viewer can follow. |

### Timing guidelines

- Humans need **~500 ms** to register that something happened and **~1200 ms**
  to read a short label.
- A good demo has **one action every 1.5–2 seconds**, not every 300 ms.
- Total length: 6–12 seconds. Longer than that needs narration or trimming.

## Pipeline internals

```
┌──────────────┐      ready marker       ┌──────────────────────┐
│ record.ts    │ ◀─────────────────────  │ VS Code (dev host)   │
│ (orchestrator│                          │ + lib/vscode-runner   │
│  Node CLI)   │ ───── start marker ────▶ │ + demos/*.demo.js    │
└──────┬───────┘                          └──────────┬───────────┘
       │                                             │ timeline.json
       │  ffmpeg avfoundation (screen capture)       │
       ▼                                             ▼
   raw.mp4  ──────▶ applyOverlays (ffmpeg drawtext) ──▶ annotated.mp4 ──▶ WebP
                          ▲
                          │ uses Inter-Regular.ttf (bundled)
                   scripts/demo/fixtures/
```

1. Orchestrator spawns VS Code via `@vscode/test-electron` with a clean
   `userDataDir` seeded from `fixtures/demo-settings.json` (pinned theme,
   font, screencast mode).
2. The runner (inside the extension host) writes a `ready` marker, waits
   for the orchestrator's `start` marker.
3. Orchestrator positions the VS Code window, starts ffmpeg, writes the
   `start` marker.
4. Runner loads the compiled demo module (`dist/demo/demos/<name>.demo.js`)
   and runs it. Each `stage.*` call pushes a `TimelineEvent`.
5. When the demo finishes (or throws), the timeline is persisted to
   `timeline.json`, VS Code exits.
6. Orchestrator stops ffmpeg, trims dead setup time off the front of the
   raw video, builds an ffmpeg `drawtext`/`drawbox` filter from the timeline,
   applies it, and converts the result to WebP (960×540 @ 12 fps, q=55).

## Dev-only isolation (recap)

Six layers prevent this tooling from leaking into the shipped VSIX:

1. `scripts/demo/**` not in `src/` — physical separation.
2. `.vscodeignore` blocks `scripts/**` from VSIX packaging.
3. `recorder-ext` (when built) has `"private": true` and a distinct
   `publisher` — never publishable to the Marketplace.
4. Runtime guard: `.kotlin-jump-dev-mode` marker file required for the
   recorder extension to activate.
5. Pre-publish check in `.publish` greps `vsce ls` output for any of
   `scripts/demo`, `recorder-ext`, or `kotlin-jump-demo-recorder` and
   aborts before uploading.
6. Unit test asserts no `src/` file imports from `scripts/demo/`.

## Known limitations (POC)

- **macOS only.** We use `screencapture` + AppleScript positioning, both
  Apple-specific. Linux would need x11grab + xdotool; Windows needs a
  different capture stack. Not implemented.
- **Window focus**: if another app is in front of VS Code on the same
  display region, the capture shows the front window. Close or minimize
  overlapping apps before recording.
- **Output size.** A 10-second demo produces a 1–3 MB WebP depending on
  content complexity. Fine for README, heavy for mobile connections.
- **No recorder extension yet.** The CodeLens "▶ Record demo" trigger
  inside VS Code is planned but not implemented — for now use the CLI.
- **Welcome tab.** On first launch with a clean userDataDir, VS Code
  shows a Welcome walkthrough. The runner calls
  `workbench.action.closeAllEditors` at demo start to hide it, but the
  first ~500 ms of the raw capture may show it briefly.
