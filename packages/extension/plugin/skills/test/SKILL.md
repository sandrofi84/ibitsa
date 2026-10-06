---
name: test
description: Run the tests and fix what fails
argument-hint: "[filter]"
disable-model-invocation: true
ibitsa-target: hero
---
Run this project's tests.

Use the project's own test command (from its package.json scripts, Makefile or README). Don't pipe the run through tail, head or grep: its exit status has to reach you.

If tests fail, fix the cause in the code, not the tests, unless a test is clearly wrong; then say why you changed it. Run the tests again until they pass, then report in a few lines what failed and what you changed.

Only these tests if given: $ARGUMENTS
