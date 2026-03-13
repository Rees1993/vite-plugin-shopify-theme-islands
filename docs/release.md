# Release

This repo uses the pre-Changesets release flow: the maintainer controls the version bump, tag, and GitHub Release format manually, and GitHub Actions publishes to npm after the GitHub Release is published.

## What the workflow does

- Trigger: publishing a GitHub Release.
- Verifies that `package.json` matches the release tag exactly.
- Runs the quality gates: typecheck, tests, lint, format check, and build.
- Publishes the package to npm with trusted publishing via GitHub Actions OIDC.

## Release steps

1. Make sure `main` is green in CI.
2. Update `package.json` to the release version.
3. Commit and push that version bump to `main`.
4. Create and push the matching tag.
5. Create the GitHub Release for that tag and publish it.
6. Wait for `.github/workflows/publish.yml` to finish.
7. Verify the npm publish.

## Stable release example

```bash
git checkout main
git pull origin main

npm version 0.7.3 --no-git-tag-version
git add package.json
git commit -m "chore: bump version to 0.7.3"
git push origin main

git tag v0.7.3
git push origin v0.7.3
```

Then publish the GitHub Release for `v0.7.3` in the GitHub UI.

## Prerelease example

```bash
git checkout main
git pull origin main

npm version 0.7.3-alpha.1 --no-git-tag-version
git add package.json
git commit -m "chore: bump version to 0.7.3-alpha.1"
git push origin main

git tag v0.7.3-alpha.1
git push origin v0.7.3-alpha.1
```

Then publish the GitHub Release for `v0.7.3-alpha.1` in the GitHub UI.

## Important rule

The workflow requires:

- `package.json` version = `0.7.3`
- tag = `v0.7.3`

If they do not match, npm publishing is blocked.

## npm publishing

The workflow uses npm trusted publishing via GitHub Actions OIDC.

Required setup in npm:

1. Open the package settings for `vite-plugin-shopify-theme-islands`.
2. Configure a Trusted Publisher for this repository.
3. Use workflow filename `publish.yml`.

No npm token is required once trusted publishing is configured.
