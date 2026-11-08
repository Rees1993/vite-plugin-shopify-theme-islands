# Package verification

Run `bun run test:package`. It builds the package, runs the pinned publint release
in strict mode for metadata and export targets, then checks npm's dry-run file
inventory. CI runs the same command with read-only repository permissions.

The small inventory check requires the runtime asset, built files, skills and
references, and rejects development directories and skill-authoring artifacts.
It disables pack lifecycle scripts and cleans its temporary cache on success and
failure. It does not install or execute a consumer or compile consumer examples.

Native skill validation remains separate: `bun run skills:check` validates skill
structure, links and code examples through the supported CLI and workflow.
