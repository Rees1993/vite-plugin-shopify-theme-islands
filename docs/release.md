# Release

This repo uses the pre-Changesets release flow: the maintainer controls the version bump, tag, and GitHub Release format manually, and GitHub Actions publishes to npm after the GitHub Release is published.

## What the workflow does

- Trigger: publishing a GitHub Release.
- Verifies that `package.json` matches the release tag exactly.
- Runs the quality gates: typecheck, tests, lint, format check, build, and any
  repo-level validation already wired into the release prep flow.
- Publishes the package to npm with trusted publishing via GitHub Actions OIDC.

## Release steps

1. Make sure `main` is green in CI.
2. Update `package.json` to the release version.
3. Update `library_version` in shipped Intent skills under `skills/*/SKILL.md`.
4. Run the local release gates:
   - `bun test`
   - `bun run check`
   - `bun run lint`
   - `bun run build`
   - `npx @tanstack/intent validate`
5. Commit and push the version bump to `main`.
6. Create and push the matching tag.
7. Create the GitHub Release for that tag and publish it.
8. Wait for `.github/workflows/publish.yml` to finish.
9. Verify the npm publish.

## Stable release example

```bash
git checkout main
git pull origin main

npm version 2.0.0 --no-git-tag-version
git add package.json skills/*/SKILL.md
git commit -m "chore: bump version to 2.0.0"
git push origin main

git tag v2.0.0
git push origin v2.0.0
```

Then publish the GitHub Release for `v2.0.0` in the GitHub UI.

## Prerelease example

```bash
git checkout main
git pull origin main

npm version 2.0.0-rc.1 --no-git-tag-version
git add package.json skills/*/SKILL.md
git commit -m "chore: bump version to 2.0.0-rc.1"
git push origin main

git tag v2.0.0-rc.1
git push origin v2.0.0-rc.1
```

Then publish the GitHub Release for `v2.0.0-rc.1` in the GitHub UI.

## Important rule

The workflow requires:

- `package.json` version = release version (for example `2.0.0`)
- tag = the same release prefixed with `v` (for example `v2.0.0`)

If they do not match, npm publishing is blocked.

## npm publishing

The workflow uses npm trusted publishing via GitHub Actions OIDC.

Required setup in npm:

1. Open the package settings for `vite-plugin-shopify-theme-islands`.
2. Configure a Trusted Publisher for this repository.
3. Use workflow filename `publish.yml`.

No npm token is required once trusted publishing is configured.
