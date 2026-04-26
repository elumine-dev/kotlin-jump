# Android Setup

## Monorepos and multi-flavor projects

When the auto-detector can't find your app module — or you have multiple apps in one workspace — declare them explicitly in `.vscode/settings.json`.

This is also needed when your `applicationId` lives in a **build-logic convention plugin** (the auto-detector doesn't read those).

```jsonc
// .vscode/settings.json
{
  "kotlinJump.androidProjects": [
    {
      "name": "Mobile",
      "module": "mobile/app",
      "package": "com.example.mobile.debug",
      "variant": "Debug"
    },
    {
      "name": "TV",
      "module": "tv/app",
      "package": "com.example.tv.debug",
      "variant": "TvDebug"
    }
  ]
}
```

| Field | Description |
|---|---|
| `name` | Label shown in button and picker |
| `module` | Path to app module — `"app"` or `"mobile/app"` |
| `package` | Debug application ID |
| `variant` | Build variant → `install{Variant}` (default: `"Debug"`) |

A `$(chevron-down)` button appears next to **Run** when multiple apps are configured. Click to switch between them.

## Reset

If detection or configuration gets stuck, run:

**Cmd+Shift+P → Kotlin Jump: Reset Android Run Config**

## Related settings

| Setting | Default | Use |
|---|---|---|
| `kotlinJump.androidRunEnabled` | `true` | Show / hide the Run button |
| `kotlinJump.androidVariant` | `"Debug"` | Fallback variant when task discovery finds nothing |
| `kotlinJump.androidSkipLaunch` | `false` | Set `true` to build-only (skip `adb` launch) |
