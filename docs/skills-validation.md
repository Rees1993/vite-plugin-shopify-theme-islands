# Skill validation

`bun run skills:check` runs the repository's exact, lockfile-pinned Intent release
through its native `validate` command. It checks shipped skill structure, links
and code examples against the package API. Malformed skills return a failing exit
status. The CLI integration tests exercise valid and invalid package skills using
the actual installed binary.

The generated workflow pins its reusable jobs to the commit packaged with the
same release and owns skill validation and review reporting. Pull requests run read-only validation. Release/manual runs produce
read-only review reports. The separate publisher can create reminder PRs only
when the repository variable `INTENT_REVIEW_PULL_REQUESTS` is explicitly `true`. Mechanical repairs occur only in the CI checkout
and are uploaded as patches for review, never committed or published by validation.
The release-pinned analysis jobs use Node 22, matching this package's requirement.

For advisory staleness signals, run `bunx --no-install intent stale`. Staleness is
not a proof of incorrect guidance or a recorded semantic review. This repository
has no recorded maintainer-review state; validation discovers its existing skills
and `skills/_artifacts` rather than initializing or approving a new review history.
The generated caller therefore leaves the maintainer-specific `artifacts` input
empty. Source-aware maintenance can be adopted separately when reviews are ready
to be recorded with evidence.

Deliberately invalid examples use the supported expected-error fence syntax.
The two-file inheritance example is compiled together by a separate integration
test because isolated code-fence checking cannot resolve its sibling module.

To refresh the caller, move aside `.github/workflows/check-skills.yml`, run
`bunx --no-install intent setup`, and review the generated replacement. Setup
preserves an existing caller. Review dependency and workflow-pin updates together.
