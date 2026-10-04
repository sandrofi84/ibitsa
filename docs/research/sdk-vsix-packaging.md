# Shipping the Claude Agent SDK inside a VSIX

Research for [#3](https://github.com/sandrofi84/ibitsa/issues/3), feeding [SPEC §13](../SPEC.md#13-development-workflow). Checked 2026-10-04 against `@anthropic-ai/claude-agent-sdk@0.3.289` (bundles Claude Code 2.1.289) and VS Code 1.140.

## Answer

- **The SDK needs a native Claude Code binary, and it brings its own.** It does not need a separately installed `claude` CLI or a separate Node.js for the CLI. The binary comes in through per-platform npm optional dependencies, each holding a roughly 230–250 MB executable.
- **Node version is not a constraint.** The SDK needs Node >= 18. The VS Code 1.140 extension host runs Electron 43.7.3, which ships Node 24.21.0. The CLI is a standalone native executable, so the extension host's Node never runs it.
- **Platform-specific VSIX packages are required** if we ship the bundled binary. That means one VSIX per target via `vsce package --target <t>`, and the same set published to Open VSX with `ovsx publish --packagePath <vsix…>`. The Open VSX target names are the same as VS Code's.
- **Keep the SDK external to esbuild**, as §13 already says. The SDK finds its binary with `createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude")`, so it has to stay in `node_modules` next to its platform package.

## Findings

### 1. What the SDK spawns

- The SDK "spawns and supervises a `claude` CLI subprocess" and talks to it over stdio. One session is one subprocess. ([Hosting](https://code.claude.com/docs/en/agent-sdk/hosting#the-subprocess-model))
- "The SDK bundles a native Claude Code binary for your platform as an optional dependency such as `@anthropic-ai/claude-agent-sdk-darwin-arm64`. Most installs need no separate Claude Code install. The SDK version tracks the bundled Claude Code version." ([TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript))
- "the spawned CLI needs no separate Node.js install." The binary "is pinned to the SDK package version, so updating the SDK is how you update the CLI." ([Hosting, Runtime dependencies](https://code.claude.com/docs/en/agent-sdk/hosting#runtime-dependencies))
- If optional dependencies were skipped, the SDK throws `Native CLI binary for <platform>-<arch> not found`. The `pathToClaudeCodeExecutable` option lets you point it at another `claude` binary instead. ([TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript))

### 2. What the npm package contains (`npm view` and the unpacked tarball, v0.3.289)

- `package.json`: `"type": "module"`, ESM only (`main: sdk.mjs`, exports `.`, `./core`, `./extract`, `./browser`, `./bridge`). `engines.node: ">=18.0.0"`. No `bin`. No regular `dependencies`. Its `claudeCodeVersion` is `2.1.289`.
- `peerDependencies`: `zod ^4.0.0`, `@anthropic-ai/sdk >=0.93.0`, `@modelcontextprotocol/sdk ^1.29.0`. The root entry inlines its own zod and MCP SDK. The `/core` entry imports them from `node_modules`. (README in the package)
- `optionalDependencies`, all pinned to the same version: `-darwin-arm64`, `-darwin-x64`, `-linux-x64`, `-linux-arm64`, `-linux-x64-musl`, `-linux-arm64-musl`, `-win32-x64`, `-win32-arm64`.
- Each platform package has `os`/`cpu` fields (libc for musl) and contains only `claude` (or `claude.exe`). `darwin-arm64` is a Mach-O arm64 executable of 229.6 MB, and its npm tarball is 100 MB. `manifest.json` in the main package lists sizes from 229.6 MB (darwin-arm64) to 249.5 MB (win32-x64).
- The main package alone is about 5.4 MB unpacked.
- How the binary is resolved, from `sdk.mjs`:
  - When `pathToClaudeCodeExecutable` is unset, the SDK does `createRequire(fileURLToPath(import.meta.url))` and resolves `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude[.exe]`.
  - On Linux it tries both `-musl` and glibc, putting the one matching the detected libc first.
  - A path that doesn't end in `.js/.mjs/.ts/.tsx/.jsx` is treated as a native binary and spawned directly, not through `node`.

### 3. Node version: SDK vs extension host

- The SDK needs Node >= 18 (`engines` field; [Hosting](https://code.claude.com/docs/en/agent-sdk/hosting#runtime-dependencies)).
- VS Code 1.140.0's `.npmrc` sets `runtime="electron"` and `target="43.7.3"`. `remote/.npmrc` (the remote/server extension host) sets `runtime="node"` and `target="24.21.0"`. ([microsoft/vscode@1.140.0 `.npmrc`](https://github.com/microsoft/vscode/blob/1.140.0/.npmrc))
- Electron 43.7.3 ships Node 24.21.0 ([releases.electronjs.org/releases.json](https://releases.electronjs.org/releases.json)).
- So the SDK's JS layer runs fine in the extension host. The CLI is a native executable and doesn't depend on that Node.
- ESM: the SDK is ESM only. The extension's CJS bundle loads it with `await import("@anthropic-ai/claude-agent-sdk")`. Node 24 also supports `require()` of ESM. (Inference; not tested in an extension host.)

### 4. Bundling with esbuild

- §13 says to keep the SDK external. The source confirms that this is required, not just tidy: binary lookup is relative to the SDK module's own `import.meta.url`.
  - If esbuild inlines the SDK into a CJS `extension.js`, `import.meta.url` becomes empty, and the platform package wouldn't sit next to it anyway.
  - Inference: lookup would fail with `Native CLI binary … not found` unless `pathToClaudeCodeExecutable` is passed. Not reproduced.
- The SDK docs offer a `/core` entry "if your application bundles the Agent SDK together with its own dependencies". Even then the binary must be on disk at a resolvable or explicit path. ([TypeScript reference, Bundling](https://code.claude.com/docs/en/agent-sdk/typescript))
- With the SDK external, `vsce` packages it from `node_modules` as a production dependency, so it must be in `dependencies`, and the VSIX file filter must keep `node_modules/@anthropic-ai/**`.

### 5. Platform-specific VSIX (VS Code Marketplace)

- Supported targets: `win32-x64, win32-arm64, linux-x64, linux-arm64, linux-armhf, alpine-x64, alpine-arm64, darwin-x64, darwin-arm64, web`. ([Publishing Extensions: Platform-specific extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions))
- Use `vsce package --target win32-x64`, then `vsce publish --packagePath <vsix>`. You can also run `vsce publish --target a b` directly. VS Code >= 1.61 picks the package matching the current platform. A package published without `--target` acts as the fallback for platforms that have no specific package. Platform-specific extensions need `engines.vscode >= 1.61.0`. (same page)
- Mapping SDK packages to VS Code targets:

  | SDK platform package | VS Code / Open VSX target |
  |---|---|
  | darwin-arm64 | darwin-arm64 |
  | darwin-x64 | darwin-x64 |
  | linux-x64 | linux-x64 |
  | linux-arm64 | linux-arm64 |
  | linux-x64-musl | alpine-x64 |
  | linux-arm64-musl | alpine-arm64 |
  | win32-x64 | win32-x64 |
  | win32-arm64 | win32-arm64 |
  | none | linux-armhf, web (not supported) |

- Producing each VSIX from one CI runner: npm's `--os/--cpu/--libc` config installs only the matching optional package. Tested on macOS with npm 12.2.0: `npm install @anthropic-ai/claude-agent-sdk --os=linux --cpu=x64 --libc=glibc` installed just `claude-agent-sdk-linux-x64`. So a CI matrix of `npm ci --os=… --cpu=… [--libc=musl]` followed by `vsce package --target …` works without per-OS runners.
- Precedent: Anthropic's own Claude Code extension (`Anthropic.claude-code` 2.1.289) is published as 8 per-platform VSIX packages. The targets are linux-x64, linux-arm64, alpine-x64, alpine-arm64, darwin-x64, darwin-arm64, win32-x64 and win32-arm64. The darwin-arm64 VSIX is 104 MB. ([Open VSX API](https://open-vsx.org/api/Anthropic/claude-code/2.1.289))
- Remote/WSL/Codespaces: the extension runs in the remote extension host (Node 24.21.0), and VS Code installs the VSIX for the remote's platform. That's usually linux-x64/arm64, which is covered.

### 6. Open VSX

- The server accepts the same targets plus `universal` and `win32-ia32` ([openvsx `TargetPlatform.java`](https://github.com/eclipse/openvsx/blob/master/server/src/main/java/org/eclipse/openvsx/util/TargetPlatform.java)).
- `ovsx@1.2.0`: `publish` has `-t, --target <targets...>` (when packaging from source) and `-i, --packagePath <paths...>` (publish prebuilt VSIX packages; `--target` is ignored for a prepackaged file, since the target is read from the VSIX). `unpublish`, `get`, `show` and `verify` also take `--target`. (ovsx `lib/main.js`, README)
- So the same per-target VSIX files built by `vsce package --target` can go to both registries.

### 7. Size

- Each per-target VSIX will be about 100 MB, mostly the binary (same as the Claude Code extension).
- Open VSX was reported to reject a 351 MB VSIX against a "250 MB limit" ([konveyor/editor-extensions#1494](https://github.com/konveyor/editor-extensions/issues/1494), secondhand). A 100 MB VSIX fits.
- The VS Code Marketplace limit is not documented on the publishing page. A web search answer claiming 25 MB is contradicted by the 104 MB Claude Code VSIX being published, so treat it as wrong.

## Options

1. **Ship the bundled binary (recommended).** Use 8 platform-specific VSIX packages built by a CI matrix and published to both registries with `--packagePath`. The SDK and CLI versions are locked together, and nothing needs installing beyond the extension. This matches Anthropic's own extension. Costs: about 100 MB per VSIX, 8 artifacts per release, and no `linux-armhf`/`web`.
2. **Universal VSIX, user-installed `claude`.** Install with `--omit=optional` (or delete the platform packages) and always pass `pathToClaudeCodeExecutable` found from the user's PATH or a setting. This gives a small single VSIX. But the user must install Claude Code, and the CLI version can drift from the SDK version, which the SDK docs tie together ("a feature … that requires a Claude Code version needs the SDK release with the same patch number or later").
3. **Hybrid.** Ship option 1, and also honour an `ibitsa.claudeCodePath` setting that is passed through as `pathToClaudeCodeExecutable` when a user wants their own build. This is cheap to add later.

## Recommendation

- Go with option 1, plus the override setting from option 3.
- Add a `universal` fallback VSIX only if we later want a degraded "bring your own `claude`" install on unsupported platforms.
- Update SPEC §13: the "if platform-specific binaries are involved" condition is met, so platform-specific VSIX packages are required. List the 8 targets and the `npm ci --os/--cpu/--libc` + `vsce package --target` matrix.

## Not verified

- Loading the SDK from an esbuild CJS bundle inside a real Extension Development Host (dynamic `import()` and binary resolution) was not run.
- The Open VSX and Marketplace size limits come from secondhand reports and precedent, not official docs.
- The Node version in forks (Cursor, Windsurf, VSCodium) was not checked. They are Electron-based and well above Node 18 in practice, but this is not confirmed.
- Whether Anthropic's terms allow redistributing the bundled binary inside a third-party VSIX was not checked. The platform packages are "© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements" ([legal](https://code.claude.com/docs/en/legal-and-compliance)). This overlaps SPEC §15 open question 9.
