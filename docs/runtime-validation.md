# Runtime validation

Run `bun ci`, then `bunx --no-install puppeteer browsers install chrome` and
`bun run test:native`. Alternatively, set `CHROME_EXECUTABLE` to an installed
Chrome executable. No Shopify login or sibling theme checkout is required.

The command runs real custom-element, MutationObserver and visibility/listener
fixtures. It fails on browser errors, incomplete/failed functional reports, or
resource budgets and cleanup counts that differ from the verified bug-fix
runtime. Setup timings remain informational; these fixtures do not measure
storefront performance. CI stores reports even when validation fails.

Reports are written to `test-results/native/`. `RUNTIME_ARTIFACT_ROOT` overrides
the directory; `RUNTIME_FIXTURE` selects one of the three fixture filenames in
`tests/native/fixtures/`. `RUNTIME_SOURCE_ROOT` builds runtime source from another
checkout for prototype comparisons. Reports include the source commit and bundle
hash; the hash also distinguishes uncommitted source changes. Validate an existing
report with `node scripts/validate-native-report.mjs <report.json>`.

`bun run skills:check` runs the pinned Intent scanner for this package's shipped
skills. A valid report with stale skills succeeds and identifies them. Scanner or
schema failures fail the command. This does not audit globally installed skills.
