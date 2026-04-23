# Release Process

This document describes how to create a new release of **Team PR Tracker**.

---

## Prerequisites

### GitHub Repository Settings

Before your first release, configure the `production` environment in your GitHub repository:

1. Go to **Settings > Environments** in your GitHub repository
2. Click **New environment**
3. Name it `production`
4. Enable **Required reviewers** and add yourself (or your team)
5. Click **Save protection rules**

This ensures every release requires manual approval before the `.vsix` is published.

### Secrets (Optional)

If you want to publish to the VS Code Marketplace automatically:

1. Generate a Personal Access Token (PAT) from [Azure DevOps](https://dev.azure.com/)
   - Organization: `All accessible organizations`
   - Scopes: `Marketplace > Manage`
2. Go to **Settings > Secrets and variables > Actions** in your GitHub repository
3. Add a new secret named `VSCE_PAT` with your token
4. Uncomment the "Publish to VS Code Marketplace" step in `.github/workflows/release.yml`

---

## Release Steps

### 1. Update the CHANGELOG

Edit `CHANGELOG.md` and move items from `[Unreleased]` to a new version section:

```markdown
## [1.1.0] - 2026-05-01

### Added

- New feature description

### Fixed

- Bug fix description

## [Unreleased]

_Nothing yet._
```

### 2. Update the Version in package.json

```bash
npm version <major|minor|patch> --no-git-tag-version
```

Or manually edit `package.json`:

```json
{
  "version": "1.1.0"
}
```

### 3. Commit the Changes

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "Prepare release v1.1.0"
```

### 4. Create and Push the Tag

```bash
git tag v1.1.0
git push origin main
git push origin v1.1.0
```

Pushing the tag triggers the release workflow automatically.

### 5. Approve the Release

1. Go to **Actions** in your GitHub repository
2. Find the **Release** workflow run triggered by your tag
3. The `validate` job (tests, lint, format) runs first
4. After validation passes, the `release` job waits for approval
5. Click **Review deployments** and approve the `production` environment
6. The workflow builds the `.vsix`, extracts release notes from the CHANGELOG, and creates a GitHub Release

### 6. Verify the Release

1. Go to **Releases** in your GitHub repository
2. Confirm the new release exists with:
   - Correct tag name
   - Release notes matching the CHANGELOG section
   - `.vsix` file attached as an asset
3. Download the `.vsix` and test it locally:
   ```bash
   code --install-extension team-pr-tracker-1.1.0.vsix
   ```

---

## Manual Trigger

You can also trigger a release manually from an existing tag:

1. Go to **Actions > Release** in your GitHub repository
2. Click **Run workflow**
3. Enter the tag name (e.g., `v1.1.0`) — the tag must already exist
4. The same validation and approval flow applies

This is useful for re-running a failed release or releasing from a tag that was created before the workflow existed.

---

## Version Validation

The workflow verifies that the version in `package.json` matches the git tag. If they differ, the release fails with an error:

```
package.json version (1.0.0) does not match tag (1.1.0)
```

Always update `package.json` before creating the tag.

---

## Troubleshooting

### Release workflow not triggered

- Ensure the tag follows the `v*` pattern (e.g., `v1.0.0`, not `1.0.0`)
- Verify the tag was pushed: `git ls-remote --tags origin`
- Check that the workflow file exists on the default branch (`main`)

### Validation fails (tests/lint)

- Fix the issue locally, amend the release commit, and recreate the tag:
  ```bash
  git tag -d v1.1.0
  git push origin :refs/tags/v1.1.0
  # Fix the issue, commit
  git tag v1.1.0
  git push origin v1.1.0
  ```

### Release notes are empty

- Ensure `CHANGELOG.md` has a section matching the version: `## [1.1.0]`
- The version in the header must match exactly (without `v` prefix)
- Test locally: `node scripts/extract-release-notes.js 1.1.0`

### Version mismatch error

- Update `package.json` to match the tag version before tagging
- Use `npm version <patch|minor|major> --no-git-tag-version` to update consistently

### .vsix not attached to release

- Check the build step output for errors
- Ensure `npm run package` produces a `.vsix` file at the repository root
- Verify that `@vscode/vsce` is in `devDependencies`

### Approval not requested

- Verify the `production` environment exists in **Settings > Environments**
- Ensure it has **Required reviewers** enabled
- Check that you (or your team) are listed as required reviewers

---

## Rollback

If a release has issues after publishing:

### Option 1: Delete and Recreate

1. Delete the GitHub Release from the **Releases** page
2. Delete the tag:
   ```bash
   git tag -d v1.1.0
   git push origin :refs/tags/v1.1.0
   ```
3. Fix the issue, commit, and create a new release following the standard process

### Option 2: Patch Release

1. Fix the issue on `main`
2. Create a patch release (e.g., `v1.1.1`) following the standard process
3. Mark the broken release as a pre-release or add a note pointing to the fix

### VS Code Marketplace Rollback

If the extension was published to the Marketplace:

```bash
npx @vscode/vsce unpublish PhilipCarneiro.team-pr-tracker
```

Or publish a patched version — the Marketplace will serve the latest version automatically.

---

## Release Checklist

```
[ ] CHANGELOG.md updated with new version section
[ ] package.json version matches the tag
[ ] All tests pass locally (npm test)
[ ] Lint passes (npm run lint)
[ ] Changes committed and pushed to main
[ ] Tag created and pushed (git tag v1.x.x && git push origin v1.x.x)
[ ] Workflow approved in GitHub Actions
[ ] GitHub Release created with .vsix attached
[ ] Release notes are correct
[ ] (Optional) VS Code Marketplace updated
```
