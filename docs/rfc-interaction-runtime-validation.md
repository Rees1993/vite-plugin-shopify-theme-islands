# RFC: Runtime Validation For `client:interaction`

## Summary

Align runtime handling of per-element `client:interaction` attribute values with
the package-owned interaction event policy introduced in `v1.3.0`.

Today the typed config surface is strict:

- `directives.interaction.events` only accepts `mouseenter`
- `directives.interaction.events` only accepts `touchstart`
- `directives.interaction.events` only accepts `focusin`
- empty arrays are rejected

But the raw HTML attribute surface is still runtime text:

```html
<cart-flyout client:interaction="mouseenter click foo"></cart-flyout>
```

The runtime currently accepts those tokens as-is and attaches listeners for
whatever strings are present. This RFC proposes a runtime-side policy so the
docs, typed config, and browser behavior tell a more coherent story.

## Problem

The package now has two different interaction-event stories:

1. Config policy is narrow and package-owned.
2. HTML attribute values are effectively unconstrained.

That creates several problems:

- The docs have to explain a stricter config policy than the runtime actually
  enforces.
- Invalid per-element attribute values fail silently.
- A user can think they are opting into a supported interaction event when they
  are really attaching a listener for an unsupported or mistyped token.
- The runtime behavior is harder to explain than it needs to be.

The goal is not to make Liquid type-safe. The goal is to make runtime behavior
more intentional and easier to reason about.

## Goals

- Keep the package-owned interaction vocabulary coherent across config and
  runtime.
- Give users runtime feedback when per-element tokens drift from the supported
  set.
- Preserve the existing default interaction behavior.
- Avoid surprising hard runtime failures for existing markup on the first pass.

## Non-goals

- IDE type safety for Liquid or HTML templates.
- Expanding the allowed interaction-event vocabulary.
- Replacing the current default events.
- Introducing a breaking runtime rejection policy in the first rollout.

## Current Behavior

Global config:

```ts
shopifyThemeIslands({
  directives: {
    interaction: { events: ["mouseenter"] },
  },
});
```

This is validated through the shared interaction-event policy.

Per-element markup:

```html
<cart-flyout client:interaction="mouseenter click foo"></cart-flyout>
```

This is not validated. Runtime parsing currently:

- splits on whitespace
- keeps any non-empty token
- attaches listeners for each token
- only falls back to defaults when the value is empty or whitespace-only

## Options Considered

### Option A: Warning-only validation with fallback

Behavior:

- Parse tokens from `client:interaction`
- Keep only tokens in the curated interaction-event set
- If some tokens are invalid, warn and ignore the invalid ones
- If no valid tokens remain, warn and fall back to the configured default
  interaction events
- Keep whitespace-only behavior as a warning + fallback

Example:

```html
<cart-flyout client:interaction="mouseenter click"></cart-flyout>
```

Result:

- warn about `click`
- use `mouseenter`

Example:

```html
<cart-flyout client:interaction="click submit"></cart-flyout>
```

Result:

- warn that the value has no supported tokens
- fall back to default interaction events

Pros:

- safest rollout
- good user feedback
- keeps pages working
- aligns runtime behavior with package policy without becoming punitive

Cons:

- still more permissive than typed config
- invalid markup does not hard fail

### Option B: Silent normalization

Behavior:

- filter to supported tokens
- no warning for dropped tokens
- fall back to defaults when no valid tokens remain

Pros:

- smallest runtime change
- minimal console noise

Cons:

- weak feedback
- users may never realize their markup is wrong

### Option C: Strict runtime rejection

Behavior:

- any unsupported token aborts activation and dispatches `islands:error`

Pros:

- strongest consistency story
- easiest rule to explain

Cons:

- highest compatibility risk
- turns template mistakes into broken runtime behavior
- too aggressive for the first rollout

## Recommendation

Choose **Option A: warning-only validation with fallback**.

This is the best first step because it gives the runtime one coherent
interaction vocabulary without turning existing user markup into hard failures.

Recommended runtime policy:

- supported per-element tokens:
  - `mouseenter`
  - `touchstart`
  - `focusin`
- mixed valid/invalid tokens:
  - warn
  - ignore invalid tokens
  - use valid tokens
- all invalid tokens:
  - warn
  - fall back to configured default events
- empty or whitespace-only values:
  - keep current warning/fallback behavior

## Proposed Design

Use the existing [`src/interaction-events.ts`](../src/interaction-events.ts)
module as the source of truth.

Implementation shape:

1. Extend `src/interaction-events.ts`

- add a helper that filters runtime tokens against the curated set
- return enough information to distinguish:
  - valid tokens
  - invalid tokens
  - empty result

Possible shape:

```ts
interface InteractionTokenParseResult {
  valid: InteractionEventName[];
  invalid: string[];
}

export function partitionInteractionEventTokens(
  tokens: readonly string[],
): InteractionTokenParseResult;
```

2. Update `src/directive-orchestration.ts`

Replace the current raw token handling in the `client:interaction` branch with:

- split + trim tokens
- partition tokens through the shared helper
- warn on invalid tokens
- use valid tokens if any remain
- otherwise warn and fall back to `directives.interaction.events`

3. Keep config validation unchanged

The stricter config policy introduced in `v1.3.0` remains as-is.

4. Update docs

- README
- skills/directives
- skills/setup

The docs should explicitly distinguish:

- config is curated and validated
- HTML is runtime-validated with warning/fallback behavior

## Testing

Add runtime tests for:

1. mixed valid and invalid tokens

- input: `client:interaction="mouseenter click"`
- expected:
  - warning emitted
  - load triggered by `mouseenter`
  - `click` ignored

2. all invalid tokens

- input: `client:interaction="click submit"`
- expected:
  - warning emitted
  - fallback to default interaction events

3. whitespace-only value

- keep existing coverage

4. all valid curated tokens

- no warning
- exact tokens used

## Semver

Recommended release target: **patch**.

Reasoning:

- no public API expansion
- no typed surface tightening beyond what already shipped in `v1.3.0`
- behavior becomes more intentional, but in a compatibility-preserving way
- invalid runtime tokens degrade to warning + fallback rather than hard failure

This should be reconsidered only if the design changes to strict rejection.

## Rollout Plan

1. implement warning-only runtime validation
2. add focused runtime tests
3. update README and skills
4. release as patch if behavior stays warning/fallback only

## Open Question

Should runtime warnings include the full unsupported token list in one message,
or emit one warning per invalid token?

Recommendation:

- emit one warning per element/value
- include both the invalid tokens and the supported set

That keeps the console readable while still being actionable.
