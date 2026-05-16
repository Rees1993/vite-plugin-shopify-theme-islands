Status: ready-for-agent

# Registered Tag Default In v2.0

## Goal

Make `registeredTag` the default Tag source in v2.0 while keeping `tagSource: "filename"` as an explicit compatibility mode.

## Settled decisions

- `tagSource` supports `"registeredTag"` and `"filename"`.
- `tagSource` stays optional.
- Omitting `tagSource` behaves the same as `tagSource: "registeredTag"`.
- Discovery stays unchanged.
- Compile owns Tag derivation.
- `resolveTag()` still runs in both modes; only `defaultTag` changes.
- `registeredTag` mode has no fallback to filename.
- `registeredTag` mode only supports direct static `customElements.define("...", ...)`.
- `registeredTag` mode ignores filename shape and casing entirely.
- Filename-vs-registered-tag mismatch warnings only apply in `filename` mode.
- Dev invalidation remains semantic: invalidate `/revive` only when effective Island ownership metadata changes.

## Implementation checklist

### 1. Public API and config

- Update [src/options.ts](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/options.ts) to add:
  - `tagSource?: "registeredTag" | "filename"`
  - docs that describe `registeredTag` as the v2.0 default and `filename` as compatibility mode
- Update [src/resolved-config.ts](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/resolved-config.ts) so resolved config carries the selected Tag source into Compile inputs.
- Validate `tagSource` centrally during config resolution.

### 2. Compile-time Tag derivation

- Update [src/revive-compile.ts](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/revive-compile.ts) so Tag derivation branches on `tagSource`.
- Keep Discovery untouched; Compile should still receive the same Island file set.
- In `filename` mode:
  - preserve current behavior
  - preserve current mismatch warning against static `customElements.define(...)`
- In `registeredTag` mode:
  - derive `defaultTag` from a statically-readable `customElements.define("...", ...)` call
  - require exactly one readable Registered Tag per Island file
  - fail compile if no static Registered Tag can be read
  - fail compile if multiple static Registered Tags are found in a single Island file
  - skip filename-shape validation and filename mismatch warnings
- Keep duplicate final Tag ownership errors exactly as strict as today.

### 3. Static analysis boundary

- Keep the supported syntax intentionally narrow for v2.0:
  - `customElements.define("cart-drawer", CartDrawer)`
- Do not expand v2.0 support to:
  - `window.customElements.define(...)`
  - `globalThis.customElements.define(...)`
  - helper wrappers
  - variables or computed strings
  - scoped registries / `someRegistry.define(...)`
- Treat wider forms as future follow-up work, not part of this release.

### 4. Contract and plan emission

- Update [src/contract.ts](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/contract.ts) comments/examples so they no longer imply filename is always the source of default Tag ownership.
- Ensure resolved Tag emission still works the same way for runtime payloads; the change should only affect how Compile computes the resolved/default Tag.
- Review [src/revive-module.ts](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/revive-module.ts) comments for any filename-only assumptions.

### 5. Dev invalidation

- Refine [src/discovery.ts](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/discovery.ts) and/or [src/index.ts](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/index.ts) so dev invalidation is semantic, not blanket.
- Introduce per-file Island ownership metadata sufficient to answer:
  - is this file an Island?
  - what effective Tag does it own after `tagSource` and `resolveTag()`?
  - is it excluded?
- Only invalidate `/revive` when that metadata changes.
- Normal implementation edits inside an Island file should remain regular HMR and should not invalidate `/revive`.

### 6. Tests

- Add config tests for the new `tagSource` option in [src/__tests__/resolved-config.test.ts](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/__tests__/resolved-config.test.ts).
- Add compile/plugin tests that cover:
  - omitted `tagSource` defaults to `registeredTag`
  - explicit `tagSource: "filename"` preserves old behavior
  - `registeredTag` mode accepts CamelCase filenames when Registered Tag is valid
  - `registeredTag` mode throws when no static Registered Tag is found
  - `registeredTag` mode throws when multiple static Registered Tags are found
  - `registeredTag` mode suppresses filename mismatch warnings
  - duplicate final Tag ownership still throws in both modes
- Add dev invalidation tests around metadata changes vs ordinary implementation edits in [src/__tests__/plugin.test.ts](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/src/__tests__/plugin.test.ts).
- Keep at least one integration-style test that mirrors a Kona-like layout using `theme/frontend/islands/`.

### 7. Documentation

- Update [README.md](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/README.md):
  - new default is `registeredTag`
  - `filename` is compatibility mode
  - examples should show that `CardDrawer.ts` can own `<cart-drawer>` in `registeredTag` mode
  - explain that new projects should prefer the default `registeredTag` model
- Update [skills/setup/SKILL.md](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/skills/setup/SKILL.md) and [skills/writing-islands/SKILL.md](/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/skills/writing-islands/SKILL.md) to match the v2.0 default.
- Remove or rewrite docs that say Tag ownership is always path-based.
- Add a short migration note for users coming from `1.3.2`:
  - `2.0` now defaults to `registeredTag`
  - set `tagSource: "filename"` to preserve old ownership behavior

### 8. Release and migration notes

- Include this as a breaking change in the v2.0 release notes.
- Call out the most important migration risk explicitly:
  - projects whose filenames and `customElements.define(...)` tags currently disagree may change ownership on upgrade
- Provide one clear before/after snippet showing how to opt back into legacy behavior with `tagSource: "filename"`.

## Future follow-ups

- Consider widening static analysis in a later release to support:
  - `window.customElements.define(...)`
  - `globalThis.customElements.define(...)`
- Revisit whether `filename` should remain indefinitely or become legacy-only after real-world usage of `registeredTag`.
- Evaluate whether scoped custom element registries need their own ownership model rather than being treated as syntax variants of the current global-registry design.
