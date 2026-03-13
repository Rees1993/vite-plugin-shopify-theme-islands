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

## Release Process

Releases are tag-driven.

See [docs/release.md](./docs/release.md) for the release checklist. In short:

- make sure `main` is green
- create a tag like `v1.2.3` or `v1.2.3-alpha.1`
- push the tag
- CI publishes to npm and creates the GitHub Release automatically

## Questions

Open a [GitHub Discussion](https://github.com/Rees1993/vite-plugin-shopify-theme-islands/discussions) for questions that aren't bugs or feature requests.
