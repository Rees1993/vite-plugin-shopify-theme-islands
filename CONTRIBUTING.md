# Contributing

Thank you for your interest in contributing. This project is MIT licensed and open to contributions of all kinds — bug fixes, features, documentation, and more.

## Code of Conduct

Be respectful and constructive. This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

## Getting Started

```bash
git clone https://github.com/Rees1993/vite-plugin-shopify-theme-islands.git
cd vite-plugin-shopify-theme-islands
bun install
bun run build
bun run check
```

## Workflow

### 1. Open an issue first

For anything beyond a small bug fix, open an issue before writing code. This avoids duplicated effort and ensures the change aligns with the project direction.

- **Bug**: describe what happened, what you expected, and how to reproduce it
- **Feature**: describe the use case and why it belongs in this plugin

### 2. Fork and branch

Fork the repository, then create a branch from `main` using the following naming convention:

| Type | Branch name |
|---|---|
| Bug fix | `fix/short-description` |
| New feature | `feat/short-description` |
| Documentation | `docs/short-description` |
| Refactor / maintenance | `chore/short-description` |

### 3. Make your changes

- Run `bun run build` to compile
- Run `bun run check` to type check
- Keep changes focused — one concern per PR

### 4. Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

<optional body>
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`

Examples:
```
feat: add client:load directive
fix: handle missing island file gracefully
docs: add example for custom pathPrefix
```

### 5. Open a pull request

Push your branch and open a PR against `main`. In the PR description:

- Reference the issue it closes (e.g. `Closes #12`)
- Describe what changed and why
- Note any breaking changes

PRs require one approval before merging.

### 5. Add a changeset

Run the following and follow the prompts to describe your change:

```bash
bunx changeset
```

Select the bump type:
- `patch` — bug fixes, internal refactors with no API change
- `minor` — new features, new directives, new options (backward-compatible)
- `major` — breaking changes

Write a one-sentence summary — this becomes the public changelog entry. Commit the generated `.changeset/*.md` file with your PR.

> **Not sure if your change needs a changeset?** Docs-only and CI-only changes don't need one. If in doubt, include one.

## Release Process

Releases are managed automatically via [Changesets](https://github.com/changesets/changesets).

When PRs with changeset files are merged to `main`, a **"chore: version packages"** PR is automatically created (or updated) by CI. It contains:
- The computed semver bump based on all pending changesets
- An updated `CHANGELOG.md` with entries for each change

When the maintainer merges the Version PR, CI publishes to npm and creates a GitHub Release automatically. No manual `npm publish` or version bumping is required.

## Questions

Open a [GitHub Discussion](https://github.com/Rees1993/vite-plugin-shopify-theme-islands/discussions) for questions that aren't bugs or feature requests.
