# Release Process

## How It Works

Releases are **automated** via GitHub Actions. When a tag `v*` is pushed, the workflow:

1. **Validates** — runs tests, lint, and format check
2. **Waits for approval** — the `release` job requires manual approval in the `production` environment
3. **Builds & publishes** — packages the `.vsix`, creates a GitHub Release, and publishes to the VS Code Marketplace

## Creating a Release

1. Update `CHANGELOG.md` with the new version section
2. Bump the version in `package.json` (must match the tag):
   ```bash
   npm version <major|minor|patch> --no-git-tag-version
   ```
3. Commit and push:
   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "Prepare release v1.x.x"
   git push origin main
   ```
4. Create and push the tag:
   ```bash
   git tag v1.x.x
   git push origin v1.x.x
   ```
