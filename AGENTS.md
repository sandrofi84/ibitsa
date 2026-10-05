# Ibitsa

Quest for Ibitsa: a VS Code extension that presents work with AI coding agents as a pixel-art RPG.

- **Spec:** `docs/SPEC.md` is the source of truth for product and architecture. Update it when a decision changes it.
- **Vocabulary:** use the terms in `GLOSSARY.md`. In particular, a **task** is the unit of work in a plan; a **ticket** is only an item in an outside ticket system.
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org), enforced by commitlint on the `commit-msg` hook. Optional scope: a package (`core`, `game`, …) or `spec`, `adr`, `glossary`, `ci`, `deps`, `repo` (`commitlint.config.js`). Spec edits are `docs(spec): …`.
- **Parameters:** a function takes at most two parameters; with more, take one object instead. Enforced by Biome (`complexity/useMaxParams`, max 2) for functions, methods and constructors. Biome doesn't check interface and type signatures, so follow the rule there by hand. The only exception is a signature a library dictates (e.g. Connect's `(req, res, next)`), marked with a `biome-ignore` that says why.
- **Open decisions:** being worked through on the GitHub issue labelled `wayfinder:map`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `sandrofi84/ibitsa`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
