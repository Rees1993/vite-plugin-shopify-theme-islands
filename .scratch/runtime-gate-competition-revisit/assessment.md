# Next improvement assessment — 2026-11-06

Review reference: 77856c7; main implementation through 72ffe94 plus reviewed
validation provenance fixes. No activation behavior changed during this assessment.

## Current Golfballs reproduction

Actual local development theme 193189904701, http://127.0.0.1:9293, 412×823.
The local Vite preview uses this repo's dist/runtime.js. Fresh navigation:

1. The menu's accordion-rows has client:media="(max-width: 63.9375rem)".
   Opening the menu succeeds, but the accordion Tag remains undefined.
2. The main FAQ and footer declare client:visible. An immediate jump to the
   footer puts its accordion at viewport top 394px; all three remain undefined.
   The FAQ is then above the viewport at -1195px.
3. Scrolling the main FAQ into view (327px) causes all three accordion elements
   to become defined. See golfballs-development-evidence.json.

This revises the older issue's location-specific evidence: activation currently
waits for the main FAQ, not merely any visible footer occurrence. Source traversal
can encounter a later occurrence while the earlier menu subtree is held by its
pending parent. "First observed owner" need not mean first in markup.

The shopper can already open native details and the menu. AccordionRows.ts adds
closing-animation support; delayed enhancement is not a broken basic menu. No
Safari animation comparison or broader revenue/conversion benefit was established.

## Recommendation

Revisit issue 02 as an isolated design/prototype, preserving current production
behavior until its complete policy and cost requirements pass. The desired change
is that an eligible occurrence can activate the shared Tag even while its current
owner waits elsewhere. It must not combine partial Gates from different elements.

Compare grouped/delegated subscriptions against per-occurrence Gate allocation.
The previous design installed 3,000 interaction listeners for 1,000 occurrences
instead of 3 and measurably slowed setup; do not restore that implementation.
Prototype candidates must account for total listeners (including document-level
ones), observer targets as well as observer counts, cleanup, complete per-element
AND policies, ordered Gates, retries, parent ordering and reentrant cancellation.

Use the now-validated fast-path runtime as the new comparison baseline. Require
matched repeated native setup/mutation/resource checks and an actual local Golfballs
reproduction before accepting a design. Report any trade-off explicitly; do not
infer that a single shared observer makes observing 1,000 targets free.

A theme-specific policy adjustment is a smaller alternative if this remains only
an optional animation delay on Golfballs. It would load some helper code earlier
and must be assessed in the theme separately. No theme policy or plugin behavior
was changed here. The generic library feature still needs evidence beyond this
one optional enhancement to justify its additional machinery.

## Captured experiment

The first isolated experiment is committed on `prototype/gate-competition`
at `a119bf4b82763e069264787e0bb4ce1532c0e74a`. Its EXPERIMENT.md, standalone
prototype.html and raw native evidence are the primary source. Pooling document
listeners/visibility observers alone was rejected: it fixed early readiness on
Golfballs but retained per-occurrence controllers/pipelines, slowed setup/teardown,
and changed stopImmediatePropagation behavior. Main retains its verified runtime.
See the issue 02 prototype-outcome comment for measured values and constraints.
