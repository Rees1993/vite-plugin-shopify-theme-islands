# Before-change baseline

Revision: af71a36d58fa21163dd9f5637a7a069132ef93d8. Local theme: ba0fc69b85d0914cf99afc42693748bf2d74b99e. Browser: Chrome/157.0.8103.38; Lighthouse 12.6.1; Puppeteer 24.43.1.

Three mobile Lighthouse samples per route, cold HTTP cache and retained store access/consent. Entries are median (min–max). Readiness interactions were collected separately at normal CPU/network speed, so they must not be compared directly with simulated Lighthouse timing. No field INP or after-change speedup is established. Product samples carry capture-limit warnings and are provisional.

| Route | LCP ms | CLS | TBT ms | JS KiB | Total KiB |
| --- | --- | --- | --- | --- | --- |
| home | 4120 (4047–4193) | 0.035 (0.035–0.046) | 398 (384–449) | 1019 (942–1031) | 3805 (3793–3843) |
| collection | 4421 (4419–4570) | 0.004 (0.004–0.004) | 404 (386–450) | 1028 (1024–1039) | 3717 (3526–3991) |
| product | 3971 (3960–4124) | 0.000 (0.000–0.005) | 373 (354–438) | 1032 (1032–1046) | 20503 (20457–23556) |
| search | 3969 (3967–4469) | 0.001 (0.001–0.001) | 380 (365–728) | 1025 (1022–1040) | 2896 (2764–2999) |

## Validity

- Post-run consent snapshot: {"marketing":"yes","analytics":"yes","preferences":"yes","sale_of_data":""}. Consent was not recorded per audit; match this state and do not label this a declined-consent baseline.
- 3 samples carry Lighthouse warnings; preserve them in mobile-baseline.json. Product capture-limit samples remain provisional.
- The earlier headed run failed with NO_FCP and is excluded. A headless smoke audit established capability; the table uses the subsequent predeclared three-round run only.
- 0 failed menu/search/cart checks across 36 separate interaction checks. See mobile-baseline.json for outcomes, per-sample settings and observed registration timings.
- Deployed theme and script fingerprints are in mobile-baseline.json. They were captured after the audits, not at every sample.
- Local source revision does not prove what plugin code Shopify serves. A matched candidate deployment is a later validation gate.
- Correctness: the standard baseline has 336 passing tests; type check and lint pass. The opt-in regression pack has 3 passing controls and 4 intended failures.
- Native recovery matrix was verified twice with real registration: four controls pass and later-success recovery fails.

## Repeat

Run scripts/measure.mjs with BASELINE_HEADLESS=true and an isolated unlocked PROFILE_ROOT, then scripts/fingerprint-deployment.mjs, then scripts/summarize-baseline.mjs. All scripts resolve installed dependencies from THEME_ROOT; no installation is performed. Credentials and Chrome profile remain outside the repository.

## Decision

Prioritize Activation reliability for correctness. Investigate measured page costs before attributing any LCP/TBT improvement to the runtime. Discovery's sub-millisecond local scan saving is not a storefront performance claim.
