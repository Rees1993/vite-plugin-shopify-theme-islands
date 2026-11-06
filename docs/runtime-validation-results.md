# Runtime reliability and performance validation

The fixes cover shared Tag cancellation transfer, recovery of earlier parent
Subtrees after later success, nearest-root inclusion/exclusion, and explicitly
included children held behind an excluded ancestor's in-flight import. The first
observed occurrence's Gate policy and shared import/retry budgets are preserved.
Production events and error reporting remain independent of debug diagnostics.

## Automated acceptance

The scoped runtime branch passes 335 tests, type checking, lint, formatting and
the package build. The native-browser runner passes five recovery cases, four
root-policy cases and 25 resource samples. The included-child regression first
failed on the reference runtime, then passed with the fix. Resource checks enforce
observer/listener counts and disconnect cleanup; timings are informational.

Tests use public `revive()` controls, DOM changes, loader outcomes and events.
Curated report-validator fixtures live in `tests/native/reports/`, and reusable
browser/build fingerprint checks live in `scripts/validate-runtime-provenance.mjs`.
No tests or runtime tooling depend on the research archive or maintenance branch.

## Startup measurements

Paired production-mode measurements of the two fast paths used real storefront
markup and fingerprinted browser-only asset overrides. There were 24 page loads:
four routes, two variants, three rounds. Mobile viewport, 4× CPU throttling, cold
HTTP cache and alternating variant order. Synchronous `revive()` medians:

| Page | Reference | Updated | Saving |
| --- | ---: | ---: | ---: |
| Home | 12.6 ms | 8.5 ms | 4.1 ms |
| Collection | 18.7 ms | 9.9 ms | 8.8 ms |
| Product | 13.1 ms | 8.6 ms | 4.5 ms |
| Search | 13.1 ms | 10.2 ms | 2.9 ms |

This excludes asynchronous Gate completion and does not establish a whole-page
or field performance improvement. The later included-child fix's paired synthetic
1,000-child settlement check remains approximately 3.1 ms for both reference and
fix at 4× CPU, with 40 samples per variant after five warmup rounds. The final
native bundle hash is
`1b51b01ee7ca570a1d5288bb14392409f5442bebe05dfada91afd6c0d1cebda7`.

## Development integration

An actual development theme served the rebuilt local plugin without response
overrides. All 17 interaction checks across home, collection, product and search
passed: mobile menu/search/cart, product quantity, filter drawers, sorting and
replacement results. Four targeted included-child cases also passed with real
custom-element registration and verified runtime-response fingerprints. These
targeted cases use temporary fixture markup rather than claiming the storefront
naturally exercises every root-policy edge. No cart contents or orders changed.

Earlier intermittent HTTP 500 responses occurred before theme scripts loaded;
their cause remains unresolved and failed attempts are preserved. Final complete
development checks passed without navigation retries. No live-theme publication
or package release is part of this change.

## Evidence archive

Full specifications, measurement samples, historical failures, source patches and
review notes are preserved on
[archive/runtime-reliability-research](https://github.com/Rees1993/vite-plugin-shopify-theme-islands/tree/archive/runtime-reliability-research).
Its ancestry retains source revisions referenced by those measurements. These
records remain outside the implementation diff; new native output is ignored
under `test-results/` and uploaded by CI.
