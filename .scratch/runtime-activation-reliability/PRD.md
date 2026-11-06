# Activation reliability: prerequisites and implementation brief

Baseline revision: `af71a36d58fa21163dd9f5637a7a069132ef93d8` (2.0.1).

Preserve first-observed occurrence Gate ownership; transfer only when pending ownership is cancelled. This brief covers runtime correctness and its validation.

## Intended outcome

Make shared Tag Activation reliable across eligible Island elements, cancellation, later successful recovery, and nested Observed roots. Preserve one shared module load, configured retry budgets, built-in Directive ordering, per-element AND semantics, parent-before-child cascade, and Teardown.

The product justification is correctness: pending work must not remain stranded when its owning occurrence disappears; earlier observed parent roots must recover after later success; nested inclusion must govern cancellation consistently. Page-speed improvement is a hypothesis until matched before/after measurements exist.

## Scope

1. Release or transfer pending Tag work when its initiating Island element is removed.
2. Rewalk all still-observed earlier same-Tag parent Subtrees after a later successful load, including recovery after an exhausted attempt.
3. Respect the nearest include/exclude Observed root policy for both membership and pending Gate cancellation.

The shared ownership and settlement policy should concentrate behind a deep module's interface. Keep real DOM and timer adapters; do not consolidate files merely to reduce file count. Runtime surface and debug observability remain separate (ADR-0002). Compile ownership tracking and Discovery optimization are later work, not prerequisites for these correctness changes.

## Required semantics

- Built-in Gates remain sequential: visible → media → idle → defer → interaction, then Custom Directives.
- Each occurrence must satisfy its own complete Gate policy. A partly satisfied Gate from one occurrence must never combine with another occurrence's policy.
- The first observed occurrence owns the Tag’s pending Gate policy. Later occurrences retain roots for cascade/recovery without running additional Gates. Cancellation may transfer ownership to the next still-observed occurrence. Never overlap loader calls or bypass an active retry budget.
- Removing one pending occurrence must not strand another observed occurrence of its Tag.
- Cancelling an Island element's pending Gate is not a loader error. Keep existing error-event distinctions.
- A final failure stops automatic attempts. Existing parked occurrences do not get free retries. A fresh element may initiate a new activation, as documented in README.md:557.
- Once that later attempt succeeds, earlier observed same-Tag Subtrees must receive the normal child cascade. This does not grant additional parent-loader attempts.
- A queued ancestor still holds child Activation until the ancestor's load succeeds.
- On success, dispose active Gate work, timers, listeners, Custom Directive signals and cleanup callbacks exactly once as applicable. Parked same-Tag occurrences allocate no additional Gate resources.
- Unobserving a parent must preserve pending work in an explicitly included child root. Disconnect must cancel the entire session, including nested included roots.
- Detached, excluded, or disconnected Subtrees must not be revived by a late completion. A stale callback from an earlier attempt must not evict or settle a newer same-Tag attempt.
- Preserve per-attempt `islands:load` / `islands:error` details and retry attempt numbering. Debug must not change behavior (ADR-0001).

## Evidence and test surface

Run the opt-in red regression pack separately from the current passing suite:

```sh
bun test ./.scratch/runtime-activation-reliability/checks/runtime-regressions.check.ts
```

The pack covers three correctness regressions and three controls. It uses `.check.ts` for separate execution; the standard public-runtime suite contains the expanded acceptance coverage.

The checks use the actual `revive()` interface with deterministic observer/timer adapters. Their fake loaders avoid happy-dom's element-identity replacement during custom-element registration. Native registration must also pass:

```sh
sh .scratch/runtime-activation-reliability/scripts/serve-recovery.sh
```

Open the printed localhost URL. Baseline native matrix: initial success PASS; exhaustion/no new element PASS; automatic retry PASS; later fresh-element success FAIL; later success plus explicit scan PASS. Verified twice before implementation. In native DOM, original parent identities remain stable. `evict()` discards waiting roots at final failure; a later attempt does not recover them.

## Browser smoke-test matrix after implementation

Use Golfballs homepage, `/collections/golf-balls`, `/products/titleist-pro-v1-golf-balls-p01155`, and `/search?q=Pro+V1` at 412 × 823 mobile and 1440 × 900 desktop.

- Homepage mobile menu opens/closes with the existing first-observed Gate policy.
- Desktop mega-menu keyboard opening/closing works on a fresh desktop load.
- Collection filtering updates count and product cards; sorting updates URL and order; replacement cards remain usable.
- Product quantity changes update total; gallery modal opens/closes; current customization route remains intact.
- Search modal, predictive results, and full search submission work.
- Empty cart drawer opens/closes; do not purchase, submit customer forms, or leave test cart changes behind.
- Exercise Sections loaded/unloaded and nested included roots in the deterministic runtime checks, rather than pretending a storefront page reproduces Theme Editor events.

## Performance baseline and comparison

Use the pinned local Lighthouse and Puppeteer dependencies already installed in Golfballs. No dependency installation or theme deployment is authorized by this brief.

```sh
node .scratch/runtime-activation-reliability/scripts/measure.mjs
```

The script launches an isolated headed Chrome profile in `/tmp/islands-mobile-baseline`, waits for store unlock, and uses the authenticated page for audits. No cookies/passwords are exported. Override `ARTIFACT_ROOT`, `THEME_ROOT`, `CHROME_EXECUTABLE`, and `BASELINE_RUNS` if needed.

- Three sequential round-robin samples per route; mobile Lighthouse simulated Slow 4G with its recorded CPU setting.
- Clear HTTP cache before each run while preserving authentication and consent. Record settings, Chrome/Lighthouse versions, route, sample time, and local revisions.
- Record LCP, CLS, TBT, FCP, Speed Index, JavaScript transfer bytes, and total transfer bytes. TBT is not field INP.
- Separate unthrottled navigations collect DOM registration readiness; this is not proof a control's event handlers work. Pair these measurements with browser interactions above.
- Persist selected numeric summaries only. Full Lighthouse results can contain session URLs; do not commit cookies, Chrome profiles, HARs, or unsanitized traces.
- Verify deployed theme ID and script asset paths. Local theme commit alone does not prove which code Shopify serves. A before/after comparison is invalid if the deployed baseline cannot be matched to the candidate.
- Report each sample, median, and range. Treat three samples as directional lab evidence, not statistically conclusive field performance.
- A speed improvement claim requires a matched candidate deployment, identical settings/routes/consent, and repeated samples beyond run-to-run noise.
- Correctness is a hard acceptance gate. Investigate any metric regression outside the baseline range; do not bless arbitrary percentage thresholds as proof of no regression.

## Delivery gates

- Current standard suite, type check, and lint baseline recorded.
- The three bug regressions turn green without breaking controls. Broaden transfer, retry and cleanup coverage for the changed paths.
- Native recovery matrix passes all five cases.
- First-occurrence Gate ownership and cancellation transfer, one shared in-flight import, Custom Directive cleanup, exhaustion without free retries, late completion after disconnect, and excluded/detached roots receive meaningful coverage.
- Matched browser functional checks pass. Performance results and their limitations are attached before making performance claims.
- No publishing, package-version bump, deployment, or unrelated Compile/Discovery refactor in prerequisite work.

## Runtime-only setup comparison

```sh
node .scratch/runtime-activation-reliability/scripts/measure-runtime.mjs
```

This separately measures five native-browser setup samples for one, 100 and 1,000 repeated visible Islands, 100 distinct Tags, and 1,000 same-Tag interaction occurrences. It counts actual IntersectionObservers, observations and element interaction-listener additions/removals, including disconnect cleanup. Targets are hidden to hold visibility Gates closed.

These fixtures establish setup and cleanup costs for the accepted per-Tag runtime. They are synthetic setup measurements at normal CPU speed, not storefront performance or a guarantee that matching counts are required after implementation. Prefer shared observers/delegation where measured overhead warrants it; preserve semantics first.

## Driver validity

The first readiness automation used immediate clicks while drawers were animating and could fail while a drawer had actually opened. Those outcomes are rejected as driver failures, not attributed to the site. The corrected driver uses Puppeteer's stable-element locators and is rerun independently of Lighthouse. Keep the rejected run metadata for traceability.

For a later candidate, write results to a separate `ARTIFACT_ROOT`, summarize them into a separate `EVIDENCE_ROOT`, and compare both `mobile-baseline.json` files with `scripts/compare-baseline.mjs`. Never overwrite the before-change evidence. `BASELINE_PHASE=readiness` runs only interactive registration checks; `BASELINE_PHASE=audit` runs only Lighthouse; `BASELINE_MAX_WAIT_MS` records an explicit capture limit. A capture-limit warning remains visible even when numeric metrics exist.
