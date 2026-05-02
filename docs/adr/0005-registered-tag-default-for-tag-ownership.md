# `registeredTag` is the default Tag source in v2.0; `filename` remains as compatibility mode

In v2.0, Island Tag ownership defaults to the **Registered Tag**: the statically-readable custom-element Tag string passed to `customElements.define(...)`. Consumers may still opt into filename-based ownership with `tagSource: "filename"`, but omitting `tagSource` now behaves the same as `tagSource: "registeredTag"`.

This changes only how Compile derives an Island's default Tag. Discovery remains unchanged: files inside configured Island directories are still Islands by convention, and files outside those directories still become Islands via the `Island()` marker. `resolveTag()` remains the final override layer in both modes; the selected Tag source only changes the `defaultTag` that `resolveTag()` receives.

`registeredTag` mode is intentionally strict. Compile must be able to read exactly one static `customElements.define("...", ...)` Tag for each Island file. There is no fallback to the filename in that mode. This keeps the ownership model deterministic, matches the browser's own source of truth more closely, and lets consumers use non-kebab-case filenames such as `CardDrawer.ts` while still owning `<cart-drawer>`.

`filename` remains supported because it was the only ownership mode through v1.3.2 and is still a valid convention-first authoring model. Existing projects that want the prior behavior can keep it explicitly. New projects should prefer the default `registeredTag` model because it aligns the plugin's ownership story with the Tag that must already match Liquid markup for the custom element to upgrade correctly in the browser.

The filename-vs-`customElements.define(...)` mismatch warning only makes sense in `filename` mode. In `registeredTag` mode the filename is not part of ownership, so filename shape and casing are irrelevant as long as the Registered Tag is valid and statically readable.

This is a semantic breaking change and belongs in the v2.0 release line. A later release may revisit whether `filename` should remain indefinitely or eventually become legacy-only, but v2.0 keeps both modes available to avoid forcing a single authoring style on every consumer.

## Considered alternatives

- **Keep `filename` as the default and recommend `registeredTag` only in docs.** Rejected: it leaves the package default and the recommended practice pulling in different directions, which would make v2.0 harder to explain.
- **Make `tagSource` required.** Rejected: it would force every consumer to restate the default without adding safety; an omitted field intentionally means `registeredTag`.
- **Remove `filename` mode entirely in v2.0.** Rejected: projects upgrading from v1.3.2 need a compatibility escape hatch, and convention-first teams may still prefer filename ownership.
- **Allow `registeredTag` mode to fall back to filename when static analysis fails.** Rejected: mixed ownership sources inside one mode would be unpredictable and would hide real authoring mistakes.
