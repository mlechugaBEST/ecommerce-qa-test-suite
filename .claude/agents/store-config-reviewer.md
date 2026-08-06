---
name: store-config-reviewer
description: Review changes to shared test infrastructure (store.js, checks.js, devices.js) for cross-store regressions. Reads all 9 store configs and flags overrides broken by the change.
---

## When to use
After editing store.js, checks.js, or devices.js — any file that defines selector defaults, theme-drift helpers, or shared assertion functions.

## What to check
1. Read git diff of the changed file(s)
2. Read all stores/*.json configs
3. For each changed default/selector/helper:
   - Which stores override it? Will the override still work?
   - If a new nullable key was added, do existing stores need it?
   - If a default selector changed, do stores relying on the old default break?
4. Report: table of store × affected key × status (ok / needs update / broken)
