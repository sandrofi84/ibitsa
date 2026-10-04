# Ibitsa

Quest for Ibitsa: a VS Code extension that presents work with AI coding agents as a pixel-art RPG.

- **Spec:** `docs/SPEC.md` is the source of truth for product and architecture. Update it when a decision changes it.
- **Vocabulary:** use the terms in `GLOSSARY.md`. In particular, a **task** is the unit of work in a plan; a **ticket** is only an item in an outside ticket system.
- **Open decisions:** being worked through on the GitHub issue labelled `wayfinder:map`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `sandrofi84/ibitsa`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
