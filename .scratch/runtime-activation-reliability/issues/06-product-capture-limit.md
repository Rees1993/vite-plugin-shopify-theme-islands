Status: ready-for-agent
Category: investigation

# Resolve or explicitly bound product-page performance capture

## Evidence

All three 45-second Lighthouse product captures returned numeric metrics with the warning: "The page loaded too slowly to finish within the time limit. Results may be incomplete."

A separate 90-second capture retained the same warning. Its numbers are diagnostic evidence, not a fourth sample mixed into the original median.

Separate native browser navigations load the document and expose the buy box and header controls successfully, so the audit warning alone is not evidence that shoppers cannot use the page.

## Acceptance

- [ ] Identify which load/quiet condition prevents clean Lighthouse completion using sanitized local diagnostics.
- [ ] Do not alter the storefront or silently block third parties simply to produce a green audit.
- [ ] Either collect clean matched before/after captures, or define and disclose a fixed-window measurement protocol before comparison.
- [ ] Keep simulated Lighthouse metrics, normal-speed readiness observations, and field INP distinct.
- [ ] Do not claim a full product-page performance baseline or performance improvement while this limitation is unresolved.

This blocks unqualified product performance claims, not the independently established correctness fixes.
