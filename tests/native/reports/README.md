# Native report fixtures

These are curated validator inputs, not measurement captures. Recovery lists the
required functional cases. Resource rows enumerate the required scenarios and
samples with expected active/disconnected counters. Setup time is zero because
these fixtures exercise schema and resource acceptance, not timing performance.

Tests mutate these complete inputs to verify that failures, missing cases, browser
errors and resource leaks are rejected. Fresh browser reports belong under the
ignored `test-results/` directory and are uploaded by CI.
