# vite-plugin-shopify-theme-islands

The domain language of a Vite plugin + runtime that lazily activates web components in Shopify Liquid themes using island architecture.

## Language

### Domain primitives

**Island**:
The definition of a lazily-activated web component — a custom-element Tag bound to a source file and a Directive policy.
_Avoid_: component, widget, element (when referring to the definition)

**Island element**:
A concrete DOM node that instantiates an Island's Tag (e.g. a `<product-form>` in the page).
_Avoid_: instance, node (when ambiguous)

**Tag**:
The custom-element name that identifies an Island both in Liquid markup and in the island map (e.g. `product-form`). Tag ownership is unique: `buildIslandMap` throws if two source files resolve to the same Tag.
_Avoid_: name, selector, element name

### Directives and Activation

**Directive**:
A `client:*` declaration that describes _when_ an Island should be activated (e.g. `client:visible`, `client:idle`, `client:defer`, `client:media`, `client:only`). Abstract — defines the kind of trigger, not its per-element binding.
_Avoid_: hint, trigger, attribute (when ambiguous)

**Built-in Directive** / **Custom Directive**:
Built-in Directives ship with the package; Custom Directives are registered by the consumer and receive a `ClientDirectiveContext` (`ctx.signal`, `ctx.onCleanup`).

**Gate**:
The resolved binding of a Directive to one Island element — a Directive name, its parsed attribute value, and the waiter that decides when to activate. Concrete counterpart to Directive.
_Avoid_: load gate, activation gate, directive instance, trigger

**Activation**:
The sequence triggered when an Island element's Gate opens — load the Island's module, ensure the custom element is registered, and run lifecycle hooks. After Activation, the element behaves as a normal upgraded custom element.
_Avoid_: hydration, mount, upgrade (when ambiguous), load

**Teardown**:
Dismantling an active Island element: cancelling pending Gate work, firing `ctx.signal`, and running any registered `ctx.onCleanup` callbacks. The dual of Activation.
_Avoid_: deactivation, unmount, detach, retire

### Runtime

**revive()**:
The runtime entry function (`vite-plugin-shopify-theme-islands/revive`). Boots the runtime singleton: scans the DOM, sets up observers, and registers Directives. Distinct from per-element Activation — `revive()` runs once for the page, Activation runs once per Island element.
_Avoid_: bootstrap, init, start (when referring to this function specifically)

**Activation session**:
The runtime's activation orchestrator. For one `revive()` call, coordinates Gate evaluation, module loading, retries, observability, and Teardown across all Island elements. The "session" boundary maps naturally to one document's lifetime: each page navigation in a Shopify (MPA) theme is a fresh document, a fresh `revive()`, and a fresh Activation session.
_Avoid_: orchestrator, engine, manager

**Observed root**:
A DOM Subtree the runtime is responsible for. Managed through `observe(root)` / `unobserve(root)`; the default Observed root is `document.body`. The runtime scans Observed roots for Island elements and tracks them for Activation and Teardown.
_Avoid_: owned root, ownership scope, watch root

**Runtime control verbs** (`scan`, `observe`, `unobserve`, `disconnect`):
The public API exposed by the `revive` entry. `observe(root)` adds an Observed root; `unobserve(root)` removes one; `scan(root?)` re-walks for new Island elements; `disconnect()` tears down the runtime entirely. Used by the Lifecycle bridge internally and available to consumers via the `/revive` import.
_Avoid_: watch, refresh, stop

### Shopify Theme integration

**Lifecycle bridge**:
The runtime adapter that listens to Shopify Theme Editor events (`shopify:section:*`, `shopify:block:*`) and translates them into Activation session calls — `observe` on section load, `unobserve` on section unload, `scan` on reorder/select/deselect — so Subtrees re-activate or tear down without a full page reload. On by default; harmless on non-Shopify pages because the events never fire.
_Avoid_: lifecycle handler, theme editor adapter, shopify integration

**Section** / **Block** (Shopify):
Shopify Theme primitives. A Section is a reusable Liquid template fragment that the Theme Editor can add, remove, reorder, or live-reload; a Block is a configurable child within a Section. The Lifecycle bridge watches `shopify:section:*` and `shopify:block:*` events to keep Activation in sync as the Theme Editor mutates these.
_Avoid_: component (collides with Island), region

**Subtree**:
The DOM rooted at a single Section or Block element. The Lifecycle bridge resolves each Theme Editor event to one Subtree and asks the runtime to scan, observe, or unobserve it — so changes are scoped, not page-wide.
_Avoid_: fragment, region

### Build-time

**Discovery**:
The plugin's build-time scan that collects the set of Island file paths to feed into Compile. Two sources: files inside configured Island directories, and files anywhere that import the Island marker.
_Avoid_: scan (when ambiguous), lookup

**Island inventory**:
The output of Discovery — the set of resolved Island file paths and their default Tags, ready for Compile.
_Avoid_: catalogue, registry, manifest

**Island directory**:
A configured directory that the plugin treats as containing Islands by default; every matching file is an Island without needing the Island marker.
_Avoid_: islands folder, islands path

**Island marker** (`Island()`):
A no-op class mixin imported from `vite-plugin-shopify-theme-islands/island`. Wrapping a custom element with `Island(HTMLElement)` marks that file as an Island so the plugin discovers it even when it lives outside the configured Island directories. Identity at runtime; meaningful only at build time.
_Avoid_: mixin (too generic), wrapper, decorator

**Resolved config**:
The validated plugin configuration with derivation methods (`runtimeOptions()`, `compileBootstrap()`) attached. Single source of truth for plugin behaviour after option resolution.
_Avoid_: policy, settings, options (when ambiguous)

**Compile** (plugin):
The plugin's build-time step that turns the Resolved config plus the Island inventory into a Plan, then emits the Plan as the virtual `/revive` module source. At runtime that emitted source runs once and calls `revive()`.
_Avoid_: bootstrap, build, codegen

**Plan**:
The intermediate data structure produced by Compile. Carries everything the emitted virtual module needs to run `revive()` correctly (island map, resolved tags, custom directive bindings, runtime options).
_Avoid_: blueprint, payload, bundle

## Relationships

- An **Island** is identified by exactly one **Tag** and backed by exactly one source file.
- An **Island element** is a DOM occurrence of an **Island**'s **Tag**; many Island elements may exist for one Island.
- A **Directive** is realised on a specific **Island element** as a **Gate**.
- **Discovery** produces an **Island inventory** from **Island directories** and **Island marker** imports.
- **Compile** consumes a **Resolved config** + **Island inventory** and emits a **Plan** as the virtual `/revive` module source.
- At runtime, **revive()** instantiates one **Activation session** that activates **Island elements** within all **Observed roots**.
- The **Lifecycle bridge** maps Shopify Theme Editor events on **Sections** / **Blocks** to **Subtree**-scoped runtime control verbs (`observe`, `unobserve`, `scan`).

## Example dialogue

> **Maintainer:** "When a customer drags a new Section in the Theme Editor, what does the runtime see?"
> **Domain expert:** "The Theme Editor fires a `shopify:section:load` event. The Lifecycle bridge resolves the event to the Section's DOM element — that's the Subtree — and calls `observe(subtree)` on the Activation session. The session walks the Subtree, finds any Island elements, evaluates each one's Gate, and runs Activation when a Gate opens."

> **Maintainer:** "What's the difference between `revive()` and Activation?"
> **Domain expert:** "`revive()` runs once for the document — it boots the singleton, sets up the IntersectionObserver, registers built-in Directives. Activation runs per Island element, after that element's Gate opens. One revive, many activations."

## Flagged ambiguities

- "island" was used to mean both the definition and the DOM instance — resolved: **Island** is the definition, **Island element** is the DOM occurrence.
- "ownership" is used in code (`RootOwnershipCoordinator`, `IslandLifecycle`) but is implementation-only — consumer-facing concept is **Observed root**.
