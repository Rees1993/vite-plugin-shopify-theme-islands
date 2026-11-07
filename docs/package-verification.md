# Package verification

Run `bun run test:package` before publishing. It builds from source, creates a real
npm tarball, and verifies the files a consumer would receive. CI runs the same
command on pull requests and pushes to main with read-only repository permissions.

The check requires every public export target, built file, skill and skill
reference. It rejects development directories and skill-authoring artifacts.
It installs the tarball into a temporary consumer, checks public JavaScript
exports, compiles TypeScript usage (including the type-only `/revive` entry), and
checks that the native skill CLI discovers every shipped skill from that install.

Packing and installation run offline with lifecycle scripts disabled. The consumer
uses the locked local Vite peer and local compiler/skill CLI; the library itself
comes from the tarball. This verifies the package contract, not a clean registry
install or browser runtime behavior. Temporary tarballs, consumers and caches are
removed on success and failure. The command reports its checks as JSON and exits
nonzero on failure. Nothing is published.

Integration tests exercise missing exports, omitted skills/references, leaked
files, broken imports/types, discovery failures and disabled lifecycle hooks
through the verification CLI.
