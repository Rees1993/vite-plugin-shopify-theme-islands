# Release

This repo uses a tag-driven release flow modeled on `t3code`, adapted for a single npm package.

## What the workflow does

- Trigger: push a tag matching `v*.*.*`, or run the workflow manually with a version input.
- Validates the version string from the tag or manual input.
- Runs the quality gates first: typecheck, tests, lint, and format check.
- Publishes the package to npm with the version derived from the tag.
- Creates a GitHub Release for the tag.
- Commits the `package.json` version bump back to `main` after a successful release.

## Release steps

1. Make sure `main` is green in CI.
2. Create a tag:
   - stable: `git tag v1.2.3`
   - prerelease: `git tag v1.2.3-alpha.1`
3. Push the tag:
   - `git push origin v1.2.3`
4. Wait for `.github/workflows/release.yml` to finish.
5. Verify the npm publish and GitHub Release.

## Prereleases

- Plain `vX.Y.Z` tags publish a normal npm release on the `latest` dist-tag and mark the GitHub Release as latest.
- Tags with a prerelease suffix, such as `vX.Y.Z-alpha.1`, publish to npm using the `next` dist-tag and create a GitHub prerelease.

## Dry run

Use a test prerelease tag to exercise the workflow without publishing a stable release:

```bash
git tag v0.0.0-test.1
git push origin v0.0.0-test.1
```

## npm publishing

The workflow uses npm trusted publishing via GitHub Actions OIDC.

Required setup in npm:

1. Open the package settings for `vite-plugin-shopify-theme-islands`.
2. Configure a Trusted Publisher for this repository.
3. Point it at `.github/workflows/release.yml`.

No npm token is required once trusted publishing is configured.
