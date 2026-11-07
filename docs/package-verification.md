# Package verification

Run `bun run test:package` before publishing. It builds from source, creates a real
npm tarball, and verifies the files a consumer would receive. CI runs the same
command on pull requests and pushes to main with read-only repository permissions.

The check uses npm's pack inventory to require the runtime asset, built files,
skills and references, and reject development directories and skill-authoring
artifacts. It installs the tarball into a temporary consumer and runs the exact
pinned publint release against the installed package with warnings treated as
errors. Publint owns the standard metadata and export-target checks; it does not
repack the checkout.

The ordinary source files in `scripts/fixtures/package-consumer/` check public
JavaScript exports and compile TypeScript usage with full declaration checking
(including the type-only `/revive` entry). The native skill CLI must discover every
shipped skill from that install. These package-specific checks complement publint,
which does not verify our API usage or skill discovery. The CLI runs named stages;
command failures identify the stage and preserve stdout/stderr diagnostics.

Packing and installation run offline with lifecycle scripts disabled. The consumer
uses the locked local Vite peer and local compiler/skill CLI; the library itself
comes from the tarball. This verifies the package contract, not a clean registry
install or browser runtime behavior. Temporary tarballs, consumers and caches are
removed on success and failure. The command reports its checks as JSON and exits
nonzero on failure. Nothing is published.

Integration tests exercise missing exports, omitted skills/references, leaked
files, broken imports/types and package metadata, discovery failures, disabled
lifecycle hooks and actionable compiler diagnostics through the verification CLI.

## Tool choice

[publint 0.3.25](https://publint.dev/docs/javascript-api) passes this package in
strict mode without suppressions and rejects invalid metadata that an exports-only
file check misses. It replaces the custom manifest-target walker. The dependency
is development-only and lockfile-pinned. Compiler and native skill-discovery checks
remain explicit because publint does not provide those guarantees.
