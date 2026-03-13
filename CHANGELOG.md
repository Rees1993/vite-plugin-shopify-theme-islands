# vite-plugin-shopify-theme-islands

## 0.7.1

### Patch Changes

- Expose `disconnect` from the generated revive virtual module — users who `import "…/revive"` can now call `disconnect()` during SPA teardown; fixes the previously empty `revive.d.ts` declaration
- Add lint and format-check steps to CI so formatting/lint regressions fail the build
- Internal: extract `walkDir` helper in `index.ts`, eliminating duplicated directory-walking code; simplify `runtime.ts` (single `getAttribute` calls, IO callback destructuring)

## 0.7.0

### Minor Changes

- **Child island cascade** — child islands nested inside a parent island now automatically wait for the parent's module to load before activating. The runtime re-walks the parent subtree on success — no directive or configuration needed.
- **`revive()` teardown** — `revive()` now returns a `() => void` disconnect function that stops the MutationObserver. Useful for cleaning up in SPA-style navigations or test teardown.
- **Warn on empty `client:media`** — `client:media=""` (empty value) now logs a console warning and skips the media check rather than silently passing an empty query to `matchMedia`. The island still loads.
- **Debug logging improvements** — when `debug: true`: the init walk is wrapped in a `console.groupCollapsed` labelled `[islands] ready — N island(s)`; islands with directives log their waiting state inside that group; the outcome (`triggered`, `aborted`, etc.) appears in the collapsed group label; dynamically added islands skip the waiting log.
- **Dev tooling** — added `.oxlintrc.json` enabling the `node` and `promise` oxlint plugins.

## 0.6.1

### Patch Changes

- Added oxlint and oxfmt for linting and formatting (`bun run lint`, `bun run format`)
- Skip output directories in island scan (`dist`, `build`, `public`, `assets`, `.cache`, `node_modules`)
- Scan timing logged when `debug: true`
- De-queue on load failure — island retries if element is re-inserted after a failed load

## 0.6.0

### Minor Changes

- **Custom client directives** — register your own loading conditions via `directives.custom`. A custom directive receives a `load` callback and decides when to call it. Custom directives run after all built-in conditions have been met.
- **Per-element attribute overrides** — `client:visible` and `client:idle` now accept a value that overrides the global option for that element only (e.g. `client:visible="0px"`, `client:idle="2000"`).
- `ClientDirective` and `ClientDirectiveOptions` types are now exported from the main package entrypoint.
- Debug logging: grouped browser console output and improved terminal island list at build time.

### Patch Changes

- Warn to the console when multiple custom directives are present on the same element — previously the first registered one would silently win.

## 0.5.0

### Minor Changes

- **`client:defer` directive** — loads an island after a fixed delay. The delay in milliseconds is read from the attribute value (e.g. `client:defer="3000"`). Unlike `client:idle`, always waits exactly the specified duration. Configurable via `directives.defer.delay` (default: `3000`).
- **Per-directive configuration** — all directives now expose their underlying browser API options: `directives.visible` (`rootMargin`, `threshold`), `directives.idle` (`timeout`), `directives.defer` (`delay`).
- **Runtime debug logging** — set `debug: true` to log directive lifecycle events to the browser console.
- Default `client:idle` timeout raised from 200ms to 500ms. Default `client:defer` fallback delay is 3000ms.

### Breaking Changes

- Directive attribute options have been restructured into a nested `directives` config object. Flat options (`directiveVisible`, `directiveMedia`, `directiveIdle`) are removed. See the README for the updated config shape.

### Patch Changes

- `IntersectionObserver` callback now iterates all batched entries (MDN: callbacks may receive multiple entries per invocation)
- `requestIdleCallback` now receives `{ timeout }` so the callback fires even on busy pages
- Fixed hanging `IntersectionObserver` when an element is removed before becoming visible
- `client:defer="0"` correctly uses a 0ms delay instead of falling back to the default
- Invalid `client:defer` values now warn to the console instead of failing silently

## 0.4.1

### Patch Changes

- Fixed Windows path incompatibility — `URL.pathname` produced a leading slash on Windows paths; now uses `fileURLToPath` for correct platform paths
- Scoped `sideEffects` to `["./dist/runtime.js"]` to prevent bundlers incorrectly tree-shaking the runtime
- Fixed `revive.d.ts` to use a proper ambient module declaration instead of `export {}`
- Added `debug` option to the README options table; added npm version, downloads, and license badges
- Added full `bun:test` suite covering plugin hooks and runtime behaviour (24 tests)
- Added GitHub Actions CI workflow — type checking and tests run on every push to `main` and all pull requests

## 0.4.0

### Minor Changes

- **Debug mode** — add `debug: true` to the plugin options for visibility into island scanning, directive config, and HMR events at startup.
- **Non-hyphenated filename warning** — if an island filename has no hyphen it can never match a valid custom element tag name; now warns in the browser console rather than silently doing nothing.

### Patch Changes

- Island mixin files already covered by a scanned directory are no longer included as redundant duplicates in the generated virtual module
- Fixed a path normalisation bug where root-relative directory paths were compared against absolute file paths, causing the deduplication check to never match
- Publish workflow now uses `[published]` trigger, `--provenance`, and `--access public`

## 0.3.0

### Minor Changes

- **Island mixin auto-discovery** — a new `./island` subpath lets you mark any custom element as an island with a single import (`import Island from 'vite-plugin-shopify-theme-islands/island'`), without moving it into a dedicated islands directory. The plugin detects the import at build time and includes the file as a lazy island chunk automatically.
- **Improved HMR** — island files created or modified during a dev session are now picked up immediately without restarting the dev server.

### Breaking Changes

- `revive` is now a side-effect import — `import 'vite-plugin-shopify-theme-islands/revive'` (no function call needed).

### Patch Changes

- Fixed 404s when used with `vite-plugin-shopify` (Cloudflare tunnel / `base: './'`) — island mixin files now use `import.meta.glob` so Vite handles base URL rewriting correctly.

## 0.2.0

### Minor Changes

- Plugin injects `import.meta.glob` automatically — the path and glob are always in sync, no manual glob needed in your entrypoint.
- Multi-directory support via `directories` array.
- Subdirectory support — islands scanned recursively.
- Vite alias resolution via `configResolved`.
- `DOMContentLoaded` guard before walking the DOM.
- Deduplication prevents duplicate `customElements.define` calls.
- Native `TreeWalker` DOM traversal (faster, no stack overflow risk).

### Breaking Changes

- Import path changed: `vite-plugin-shopify-theme-islands/revive` → `/islands`
- Option renamed: `pathPrefix` → `directories` (accepts `string | string[]`)
- Manual `import.meta.glob` in your entrypoint is no longer needed or supported

## 0.1.3

### Patch Changes

- Fixed `TypeError: readFileSync is not a function` when loading vite config — virtual module now resolves the runtime via file path instead of reading it at plugin instantiation time

## 0.1.2

### Patch Changes

- Fixed CI authentication for `bun publish` (`BUN_AUTH_TOKEN` → `NPM_CONFIG_TOKEN`)

## 0.1.1

### Patch Changes

- Fixed incorrect import path in JSDoc comment (`virtual:shopify-theme-islands/revive` → `vite-plugin-shopify-theme-islands/revive`)

## 0.1.0

### Minor Changes

- Initial release — island architecture for Shopify themes. Lazily hydrate custom elements using loading directives (`client:visible`, `client:idle`, `client:media`). Directives can be combined.
