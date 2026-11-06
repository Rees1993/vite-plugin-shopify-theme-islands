# Runtime quality gates and follow-up review

Reference: 77856c7bddfc29aa87b7bcadf089ea08122119cb. User authorized implementing retro recommendations 2/3, then reviewing the recommended common-path prototype and remaining suggestions. Approved test seams: CLI exit status/generated reports plus real native-browser runtime fixtures. Retest when relevant. No package release, deployment, remote workflow dispatch, or production application of the prototype is authorized.

## Implementation

- Fail closed on native functional failures, missing/malformed/partial results, resource-budget violations and cleanup leaks. Timings remain informational, never a noisy CI pass/fail threshold.
- Make native checks runnable from this checkout and Linux CI without sibling Golfballs dependencies or store authentication. Keep diagnostic artifacts and actionable failure exit status.
- Preserve the Intent CLI's valid stale-report behavior (successful scan may identify stale skills), but fail on subprocess errors, invalid JSON, invalid schema or missing expected project report. Publish no clean/stale output before full validation.
- Use the pinned repository Intent dependency, not a drifting global CLI; keep existing PR-creation behavior unchanged and do not invoke it locally.
- Use one red→green slice at a time through approved public seams. Run targeted tests/typecheck regularly, full standard suite at completion, native checks, review, then commit.

## Review

- Review prototype patch in research/patches/combined-common-path.patch against 77856c7 through independent Standards and Spec axes. Retest correctness and timing where justified; keep source changes isolated from main.
- Review remaining retro suggestions: scope/performance judgement standards, a shared local verification command/experiment tooling, skill and research-source durability. Apply only already authorized work; report additional recommendations separately from implementation.
- Preserve the approved glossary/config migration and existing research files. Do not erase unrelated staged/unstaged work.
