# Restarted implementation

Previous implementation discarded on user request; tracked source restored to baseline af71a36d58fa21163dd9f5637a7a069132ef93d8. Prerequisite evidence retained.

User approved seams: public revive() API, DOM changes, loader outcomes, public runtime events; native-browser fixtures for real custom-element behavior.

Follow implement + tdd: one failing behavior test, smallest implementation, targeted checks, repeat. Typecheck regularly. Full suite at end. Review standards and spec independently against baseline, resolve findings, commit on current branch. No deployment or package version change.

Baseline restored: git diff empty; typecheck passes. Baseline standard suite evidence already recorded in prerequisite pack.

## Completed implementation

All previous implementation edits were discarded before this restart. The agreed public seam was used for new tests; external DOM observers, time, and module loaders have deterministic adapters. No internal production modules are mocked by the new suite.

Vertical slices (each red case run before its patch; controls already passed):

| Behavior | Initial result |
| --- | --- |
| First eligible occurrence beats an earlier closed visibility Gate | red |
| Immediate same-Tag replacement after cancellation | green control after first slice |
| Earlier parent children recover after fresh-element success | red |
| Included child's pending Gate survives parent exclusion | red |
| Losing custom Gate abort/cleanup | red |
| Success after disconnect | red |
| Late rejection after root exclusion | red |
| Exhaustion disposes parked Gates | red |
| Custom Gate repeated callback cannot bypass AND | red |
| Exhausted parent continues holding children | green control |
| Replacement shares an unabortable import | red |
| Late rejected removed custom Gate is ignored | red |
| Same element can be observed again after cancellation | red |
| Included descendant discovered through excluded parent | green control; also checked in native Chrome |
| Simultaneous Gate winners share one attempt | green control |
| Throwing cleanup does not skip remaining cleanup | red |
| Connected move into excluded root cancels Gate | red; spec review finding |
| Competing Gate rejection preserves sibling retry budget | red; spec review finding |
| Replacement shares an already-running retry | red |
| Pooled visibility respects target and complete policy | green control |
| All built-in Gates remain sequential before custom Gates | green control |
| Load-event unobserve cannot forget successful Tag | red |
| Cleanup disconnect suppresses subsequent load event | red; review reentrancy finding |
| Cleanup unobserve cannot forget successful Tag | green control after reentrancy fix |

Review-stage refactoring concentrated Tag state, retry scheduling, module loading, settlement, and recovery in Activation session. Element execution now evaluates Gates only; DOM lifecycle handles scans, current root policy, and cancellation. Debug observability remains separate from runtime surface. Four obsolete internal collaborator-mocking suites (36 tests) were replaced by the 24 public-seam cases and existing runtime suites, following codebase-design/DEEPENING.md's “replace, don't layer” instruction. Three existing insertion fixtures were corrected to attach their nodes before reporting insertion.

## Validation

- Full standard suite at completion: **324 pass, 0 fail**, 641 assertions, 23 files.
- Typecheck, lint (zero warnings/errors), package JavaScript/declaration build, and git diff whitespace check pass.
- Native Chrome 157 recovery matrix: **5/5 pass**, real customElements registration and MutationObserver.
- Native included-root policy fixture: **1/1 pass**.
- Candidate browser evidence identifies the exact runtime bundle SHA-256, not merely the unchanged pre-commit HEAD.
- No package version change, publishing, or deployment.

## Standards

Final independent reviewer: no remaining standards findings. Earlier duplicate settlement and obsolete ownership bookkeeping were removed. Cleanup reentrancy was corrected by detaching all cancellation watchers before consumer cleanup and checking session identity before event dispatch. No documented standard or ADR violation remains.

## Spec

Final independent reviewer: no unresolved finding from the spec reviews. The moved-membership and competing-Gate retry-budget failures were reproduced through revive() before fixing them. Matched storefront verification is still incomplete because the candidate has not been deployed.

Final review totals: Standards 0 unresolved; Spec 0 unresolved code findings, with candidate storefront verification still outstanding.

## Runtime setup cost

Five sequential native samples per fixture, normal CPU/network. All individual samples, ranges, browser version, runtime hash and cleanup counts are retained in `evidence/runtime-setup-candidate.json`; before samples remain unchanged in `runtime-setup-baseline.json`.

| Fixture | Before median (range), ms | Candidate median (range), ms | Before → candidate observers/listeners |
| --- | --- | --- | --- |
| 1 visible | 0.2 (0.1–1.0) | 0.1 (0.0–1.1) | 1 → 1 observer |
| 100 repeated visible | 0.5 (0.4–0.6) | 0.9 (0.9–1.5) | 1 → 1 observer, 100 targets now evaluated |
| 1,000 repeated visible | 2.5 (1.8–2.9) | 3.1 (2.7–6.8) | 1 → 1 observer, 1,000 targets now evaluated |
| 100 distinct visible | 1.6 (1.3–1.8) | 0.5 (0.3–0.6) | 100 → 1 observer |
| 1,000 repeated interaction | 1.4 (1.0–2.6) | 3.6 (2.7–5.0) | 3 → 3,000 listeners |

Investigation: evaluating each eligible occurrence necessarily creates more per-element work than the baseline's first-occurrence behavior. An intermediate implementation created 1,000 visibility observers; pooling reduced this to one per matching visibility configuration. Interaction listeners remain per-element, preserving direct event behavior; all 3,000 listeners are removed on disconnect. Interaction delegation remains a possible later optimization and would need coverage for non-bubbling mouseenter, propagation, and root changes. These increases exceed baseline ranges and are recorded as known setup overhead, not certified as a performance improvement. No arbitrary percentage threshold was used to dismiss them.

## Compatibility and remaining verification

Gate competition intentionally permits earlier module loading than DOM-order ownership. Every winning occurrence must satisfy its own complete policy; registration then upgrades matching elements normally. Consumers with same-Tag Gates that previously relied on first DOM occurrence timing may observe earlier initialization/events. This behavior merits an explicit release note and compatibility assessment before publishing; no release/version decision is made here.

The candidate has not been deployed to Golfballs. Existing storefront baseline interactions do not validate this candidate. Issue 05 retains mobile/desktop functional checks, candidate asset/theme identification and matched page-performance comparison. Baseline product Lighthouse capture warnings remain provisional. No storefront speed, field INP or conversion claim is made.
