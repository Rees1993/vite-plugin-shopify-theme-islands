# Skill Spec — vite-plugin-shopify-theme-islands

## Library

- **Name:** vite-plugin-shopify-theme-islands
- **Version target:** 1.0.2
- **Repository:** https://github.com/Rees1993/vite-plugin-shopify-theme-islands
- **Type:** Vite plugin (node) + browser runtime

## Structure

Flat — fewer than 5 skill domains, no framework adapters.
Each skill is standalone type `core`.

## Skills

| Skill | Path | Description |
|-------|------|-------------|
| setup | skills/setup/SKILL.md | Getting-started journey, plugin install, vite.config.ts, directories, debug, retry |
| writing-islands | skills/writing-islands/SKILL.md | Directory scanning, Island mixin, child cascade |
| directives | skills/directives/SKILL.md | client:visible/media/idle/defer, combining, per-element overrides |
| custom-directives | skills/custom-directives/SKILL.md | Register custom directives, signature, AND-latch |
| lifecycle | skills/lifecycle/SKILL.md | onIslandLoad/onIslandError helpers, DOM events, disconnect |

## Key Sources

- `src/index.ts` — plugin, types, virtual module generation
- `src/runtime.ts` — revive(), directive execution, built-in implementations
- `src/events.ts` — onIslandLoad, onIslandError
- `src/island.ts` — Island mixin
