---
name: tidy
description: Run the linter and formatter and fix what they report
disable-model-invocation: true
ibitsa-target: hero
---
Run this project's linter and formatter, using its own configured commands (from package.json scripts, a Makefile or the README). Apply automatic fixes, then fix what remains by hand.

Change only what they report: no unrelated refactoring. Run them again until they're clean, then report in a few lines what changed.
