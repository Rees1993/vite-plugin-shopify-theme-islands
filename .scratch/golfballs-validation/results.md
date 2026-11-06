# Golfballs integration validation — 2026-11-06

## Environment and scope

Two different integration environments were tested. They are not interchangeable.

| Check | Pages/data | Runtime delivery | Theme role |
| --- | --- | --- | --- |
| Paired production-mode measurements | Published Golfballs UAT storefront | Browser-only overrides from isolated baseline/candidate builds | main, 193546256701 |
| Local development interactions/HMR | Shopify local proxy, http://127.0.0.1:9293 | Vite localhost:5175, actual local plugin dist/runtime.js, no overrides | development, 193189904701 |

The published theme was not uploaded to or published. The local Shopify CLI did
synchronize the development theme, as its normal dev workflow requires. Original
Golfballs source remains clean; all configuration and probe edits use isolated
copies in /tmp/golfballs-validation. No checkout, order or cart-content mutation.

Plugin source commit: 670055f. Paired baseline: 50331f0. Both build the same clean
Golfballs source/dependencies. The local dev config explicitly imports this repo's
dist/index.js after `bun run build`; observed runtime requests use
http://localhost:5175/@fs/Users/alexrees/Documents/Lazer/vite-plugin-shopify-theme-islands/dist/runtime.js.
A separate uninstrumented production theme build also succeeds with that plugin.

## Real-page production-mode measurements

24 page loads: four routes × three rounds × two variants. Each requested bootstrap
was replaced with the expected fingerprinted build. All responses were HTTP 200;
no islands:error events occurred. Theme identity and consent remained constant.
Mobile 412×823, 4× CPU, cold browser HTTP cache, network unthrottled. Variant order
alternates each round. Identical temporary instrumentation measures the synchronous
public revive() call, including its scan, excluding asynchronous Gate completion.

| Route | Baseline median (range), ms | Updated median (range), ms |
| --- | ---: | ---: |
| Home | 12.6 (12.2–15.6) | 8.5 (8.1–10.2) |
| Collection | 18.7 (15.7–20.6) | 9.9 (9.5–13.4) |
| Product | 13.1 (12.2–13.4) | 8.6 (8.3–10.2) |
| Search | 13.1 (12.5–14.0) | 10.2 (9.2–11.2) |

This supports a small synchronous startup saving in real Golfballs markup. It does
not establish a noticeable whole-page or field Core Web Vitals improvement.
The short-window LCP measurements vary widely and are not used to claim a page-speed
win. Browser overhead, network variance, main-thread scheduling and three samples
per cell limit precision. Native/synthetic results are documented separately.

## Functional checks

Updated production-mode builds pass mobile menu/search/cart open-close on all four
routes. Baseline also passes except one initial homepage cart timeout; a repeated
cart test with a longer wait passes. Initial follow-up baseline homepage navigation
returned 304 and was rejected; a cold-cache retest returns 200 and passes.

Both variants pass PDP quantity increase/decrease without adding to cart. Collection
and search pass mobile filter-drawer open/close and desktop price-ascending sorting.
The focused sort confirmation verifies URL, selected option, ready state, actual
replacement of the old result card, and nonempty new results. Collection's first
item changes from Pro V1 ($36.95) to a joke ball ($3.99). Search results also change.

In the actual development theme, all four routes pass mobile menu, search and
repeated cart open/close. PDP quantity and both filter/sort flows pass. The local
homepage pass is recorded separately after initial server failures. These dev
checks do not intercept browser responses. Runtime module responses carry hashes
in evidence/local-dev-confirmation.json and local-home-confirmation.json.

The HMR check passes: changing a comment in the isolated MobileMenu.ts causes an
updated module request and a Vite hot update of the accepted revive virtual module.
Menu/search work before and after; the file is restored. The first probe incorrectly
expected full-page reload; source inspection confirmed import.meta.hot.accept() is
the intended behavior, so the final check verifies hot update instead.

## Findings and limits

- The unmodified deployed homepage, baseline and updated builds share an invalid-URL
  exception. Stacks pass through Shopify's web-pixel XMLHttpRequest wrapper and
  Pingdom. It is an existing integration finding, not a new runtime regression.
- The local proxy initially returned HTTP 500 before theme scripts on home and one
  collection navigation. Vite also reoptimized dependencies and reloaded during
  the first product check. The later product/collection/search checks pass; a home
  interaction retest passes. Normal, cache-clear, cache-disabled and combined
  homepage probes subsequently all return 200. The HTTP 500 cause remains unresolved;
  it is not presented as fixed. Failed attempts are retained in evidence/.
- No order, add-to-cart submission, design-studio purchase flow, customer login or
  Shopify Theme Editor save was tested. Dynamic result replacement and local HMR
  were tested; they do not cover every section lifecycle in the editor.
- No field data or deployment/rollout verification exists. Browser overrides tested
  production-mode JavaScript against published markup; local dev tested real Vite
  serving with debug enabled. The production theme build compiled successfully,
  but no built bundle was uploaded to a preview theme for these checks.

Evidence: the JSON files under evidence/ retain individual samples, fingerprints,
functional assertions, initial failures, confirmations and environment metadata.
