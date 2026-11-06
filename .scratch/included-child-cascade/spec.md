# Retain included children across excluded ancestor completion

Fix the P2 found while reviewing `fix/runtime-reliability-and-performance` against
main (`af71a36`). Reference before this fix: `9219586`.

Through public `revive()` controls, explicitly observe a child root while its
ancestor Island import is pending, then unobserve the parent root. The child must
remain blocked until that import settles, then activate without a manual scan.
Excluded siblings must stay inactive. A detached or subsequently excluded child,
or a disconnected session, must not activate. Preserve Gate policies, shared
Tag import/retry behavior, and nearest-root membership; no Gate competition.

Use the already agreed seams: public runtime DOM/loader outcomes and native
Chromium fixtures; CLI exit status and complete reports enforce native acceptance.
Record red before green, run targeted/type checks, full checks at completion,
independent Standards/Spec review, and authenticated Golfballs local development
flows with the rebuilt local plugin and verified response fingerprints. Do not
change the original theme checkout or publish. Commit on the existing fix branch.

Native resource budgets and paired runtime setup measurements must be checked.
Timings are diagnostic evidence rather than flaky pass/fail thresholds.
