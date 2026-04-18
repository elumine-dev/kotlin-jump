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

## Multi-display / fullscreen app gotcha

ffmpeg's avfoundation capture is **per-physical-display**, but AppleScript
window positions are in **global desktop coordinates**. On a multi-monitor
setup the mapping between "Capture screen N" and a specific display is not
stable — it depends on your System Settings → Displays arrangement.

If the produced WebP shows the wrong content (e.g. a game that was
fullscreened on another display, or your usual editor), override via
env vars:

| Variable | Meaning | Typical value |
|---|---|---|
| `KJ_DEMO_SCREEN_INDEX` | avfoundation index of the display to record | `2` = main display on most setups |
| `KJ_DEMO_WINDOW_X` | X position where VS Code will be moved (global coords) | `0` |
| `KJ_DEMO_WINDOW_Y` | Y position for VS Code | `0` |
| `KJ_DEMO_CAPTURE_OFFSET_X` | Global x origin of the captured display | `0` (main) or the main-display width if you capture a secondary display arranged to its right |
| `KJ_DEMO_CAPTURE_OFFSET_Y` | Global y origin of the captured display | `0` |
| `KJ_DEMO_KEEP_TMP` | Keep `raw.mp4`, `annotated.mp4`, `timeline.json` for debugging | `1` |

Run `ffmpeg -f avfoundation -list_devices true -i ""` once to see the
screen indices on your machine — the main display is almost always
`Capture screen 0`.

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

- **macOS only.** avfoundation is Apple-specific; Linux would need
  x11grab / Xvfb. Windows GDI grab. Not implemented.
- **Multi-display gotcha**: see "Multi-display" section above.
- **Output size.** A 10-second demo produces a 1–3 MB WebP depending on
  content complexity. Fine for README, heavy for mobile connections.
- **No recorder extension yet.** The CodeLens "▶ Record demo" trigger
  inside VS Code is planned but not implemented — for now use the CLI.
- **No text cursor highlight.** Screencast mode shows clicks but not
  cursor position in the editor. Add `stage.caption()` to narrate when
  it matters.
