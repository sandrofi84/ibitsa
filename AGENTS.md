# Ibitsa

Quest for Ibitsa: a VS Code extension that presents work with AI coding agents as a pixel-art RPG.

- **Spec:** `docs/SPEC.md` is the source of truth for product and architecture. Update it when a decision changes it.
- **Vocabulary:** use the terms in `GLOSSARY.md`. In particular, a **task** is the unit of work in a plan; a **ticket** is only an item in an outside ticket system.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org), enforced by commitlint on the `commit-msg` hook. Optional scope: a package (`core`, `game`, `agent-claude-sdk`, …) or `spec`, `adr`, `glossary`, `ci`, `deps`, `repo` (`commitlint.config.js`). Spec edits are `docs(spec): …`.
- **Parameters:** a function takes at most two parameters; with more, take one object instead. Enforced by Biome (`complexity/useMaxParams`, max 2) for functions, methods and constructors. Biome doesn't check interface and type signatures, so follow the rule there by hand. The only exception is a signature a library dictates (e.g. Connect's `(req, res, next)`), marked with a `biome-ignore` that says why.
- **Types and schemas:** a component `foo.ts` keeps its types in `foo.types.ts` (types only) and its Valibot schemas, with the types derived from them, in `foo.schema.ts`. Other source files declare no types. Tests, `*.d.ts` and tool configs are exempt. Checked by `pnpm conventions` (`scripts/check-conventions.mjs`).
- **Barrels:** each package's `src/index.ts` re-exports everything other packages use (`export type { … }` for types). Other packages import only from `@ibitsa/<package>`, never a file inside it (Biome `noRestrictedImports`; fixture data is the one exception). Inside a package, import files directly, never your own barrel.
- **Domains, not utilities:** behaviour belongs to the domain that owns the concept (core: `Quest`, `Hero`, `NeedsYou`; ADR 0002). No `utils` modules; a helper lives in its domain's file and only moves out once a second domain needs it.
- **Coverage:** `pnpm check` and CI run Vitest with coverage floors per package (`vitest.config.ts`). Coverage may rise but never drop; when a change raises a package's numbers, raise its floor in the same PR. Coverage shows code ran, not that it was checked: behaviour still needs real assertions.
- **Open decisions:** being worked through on the GitHub issue labelled `wayfinder:map`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `sandrofi84/ibitsa`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
