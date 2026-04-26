# Contributing to Kotlin Jump

## Build from source

```bash
git clone https://github.com/elumine-dev/kotlin-jump
cd kotlin-jump && npm install
node esbuild.js --production && npx @vscode/vsce package --no-dependencies
code --install-extension kotlin-jump-*.vsix
```

## Run the test suite

```bash
npm test                   # unit tests (vitest)
npm run test:integration   # VS Code integration tests
```

## Issues & PRs

- Bugs and feature requests: [github.com/elumine-dev/kotlin-jump/issues](https://github.com/elumine-dev/kotlin-jump/issues)
- Pull requests welcome — small, focused changes preferred.
