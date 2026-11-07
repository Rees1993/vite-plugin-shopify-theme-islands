# Skill-health validation

`bun run skills:check` uses the pinned repository scanner. A successful scan with
stale skills succeeds and identifies them; scanner errors, malformed reports,
missing project results and unresolved published versions fail the command.
The workflow uses the same checked-in command before creating any review PR.

This checks the package's shipped skills, independently of runtime behavior and
agent skills installed outside this repository. CLI tests cover invalid reports
and valid clean/stale results through the actual workflow step.
