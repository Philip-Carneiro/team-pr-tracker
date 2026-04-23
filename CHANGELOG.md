# Changelog

All notable changes to **Team PR Tracker** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-23

First stable release.

### Added

- **Sidebar Panel** with three views: All PRs, My PRs, and Stale PRs
- **GitHub API integration** to fetch open PRs from watched repositories and users
- **Notifications** for new PRs, new comments on your PRs, and stale PRs
- **Build status indicators** (passed, failed, pending, none) for each PR
- **Review relation detection** (needs my review, changes requested, approved, not involved)
- **Stale PR detection** with configurable threshold (default: 3 days)
- **Author filtering** via quick pick menu in the All PRs view
- **Auto-refresh polling** with configurable interval (3-10 minutes, default: 3)
- **Secure token storage** using VS Code's built-in SecretStorage API
- **Offline support** with cached data persisted via VS Code globalState
- **RequestCache** to deduplicate API calls within a single refresh cycle, reducing API usage by ~33%
- **Progress indicator** in the status bar during refresh operations
- **Manual refresh resets timer** to prevent overlapping auto-refresh cycles
- **Polling interval validation** with clamping (min: 3, max: 10 minutes)
- **Username normalization** — `@username` and `username` both accepted
- **Partial failure resilience** — refresh succeeds even if some repos fail
- **Token management commands** — Set, View Status, and Reset token
- **Open PR in browser** from TreeView click or context menu
- MIT License
- Comprehensive README with usage instructions

### Fixed

- GitHub API authorization header now uses `token` prefix (correct for PATs) instead of `Bearer`
- Manual refresh button no longer causes overlapping refresh cycles
- Opening PR from TreeView context menu now works correctly (handles both string URL and TreeItem object)
- Refresh no longer throws "All fetches failed" on partial repo failures

## [Unreleased]

_Nothing yet._
