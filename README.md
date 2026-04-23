# Team PR Tracker

A VS Code extension that helps you and your team stay on top of Pull Requests across multiple GitHub repositories. Get notified about new PRs, track stale reviews, and never miss a comment on your own PRs.

> **Note:** This extension currently supports **GitHub only**. Support for other source code platforms (GitLab, Bitbucket, etc.) will be added in future releases.

---

## Features

- **Sidebar Panel** — Dedicated activity bar with three views: All PRs, My PRs, and Stale PRs
- **Real-time Notifications** — Get notified when new PRs are opened, comments are added to your PRs, or PRs go stale
- **Build Status Indicators** — See CI/CD status (passed, failed, pending) at a glance
- **Review Tracking** — Know which PRs need your review, which have changes requested, and which you've approved
- **Stale PR Detection** — Configurable threshold to flag PRs that haven't been updated
- **Author Filtering** — Filter the PR list by specific authors
- **Auto-Refresh** — Configurable polling interval (3-10 minutes)
- **Secure Token Storage** — GitHub token stored via VS Code's SecretStorage (never in plain text)
- **Offline Support** — Cached data persists between sessions via VS Code's globalState
- **Smart API Usage** — Request deduplication within each refresh cycle to minimize API calls

---

## How to Use

### 1. Install the Extension

Install **Team PR Tracker** from the VS Code Marketplace, or load it manually via a `.vsix` file:

```
code --install-extension team-pr-tracker-1.0.0.vsix
```

### 2. Set Your GitHub Token

A GitHub Personal Access Token (PAT) is required for higher API rate limits (5,000 requests/hour vs. 60 without a token).

1. Open the Command Palette (`Cmd+Shift+P` on Mac / `Ctrl+Shift+P` on Windows/Linux)
2. Run **Team PR Tracker: Set GitHub Token**
3. Paste your token (starts with `ghp_` or `github_pat_`)

> Your token is stored securely using VS Code's built-in SecretStorage and is never written to `settings.json`.

**Required token scopes:** `repo` (for private repos) or `public_repo` (for public repos only).

### 3. Configure Watched Repos and Users

Open VS Code Settings (`Cmd+,` / `Ctrl+,`) and search for **Team PR Tracker**:

- **Watched Repos** — Add the repositories you want to monitor (format: `owner/repo`)
- **Watched Users** — Add the GitHub usernames whose PRs you want to track
- **GitHub Username** — Set your own GitHub username to enable "My PRs" and comment notifications

![Settings](docs/images/settings.png)

### 4. Start Tracking

Once configured, PRs will appear automatically in the sidebar panel. The extension refreshes on startup and then polls at the configured interval.

![Sidebar Panel](docs/images/sidebar.png)

---

## Commands

All commands are accessible via the Command Palette (`Cmd+Shift+P` on Mac / `Ctrl+Shift+P` on Windows/Linux):

| Command                                 | Description                                                |
| --------------------------------------- | ---------------------------------------------------------- |
| `Team PR Tracker: Refresh PRs`          | Force refresh all PRs (also resets the auto-refresh timer) |
| `Team PR Tracker: Set GitHub Token`     | Set or update your GitHub Personal Access Token            |
| `Team PR Tracker: Reset GitHub Token`   | Remove your stored GitHub token                            |
| `Team PR Tracker: View Token Status`    | Check if a token is configured and see a masked preview    |
| `Team PR Tracker: Open PR in Browser`   | Open the selected PR in your default browser               |
| `Team PR Tracker: Filter PRs by Author` | Filter the "All PRs" view by one or more authors           |

---

## Settings

| Setting                                | Type       | Default | Description                                                                             |
| -------------------------------------- | ---------- | ------- | --------------------------------------------------------------------------------------- |
| `teamPrTracker.githubUsername`         | `string`   | `""`    | Your GitHub username (enables My PRs view, review detection, and comment notifications) |
| `teamPrTracker.watchedRepos`           | `string[]` | `[]`    | Repositories to monitor (format: `owner/repo`)                                          |
| `teamPrTracker.watchedUsers`           | `string[]` | `[]`    | GitHub usernames whose PRs to track                                                     |
| `teamPrTracker.stalePrDays`            | `number`   | `3`     | Number of days without activity before a PR is considered stale                         |
| `teamPrTracker.pollingIntervalMinutes` | `number`   | `3`     | Auto-refresh interval in minutes (min: 3, max: 10)                                      |

![Settings Configuration](docs/images/settings-detail.png)

---

## Sidebar Views

### All PRs

Shows every open PR from your watched repos and users, grouped by repository. Each PR displays:

- Title and PR number
- Author
- Build status icon (check mark, X, clock, or dash)
- Review relation badge (if applicable)
- Stale indicator (if applicable)

Use the **filter icon** in the view title bar to filter by author.

### My PRs

Shows PRs authored by you (based on `githubUsername`). Includes "needs attention" detection:

- Flags PRs where external activity (comments, reviews) occurred after your last commit
- Helps you prioritize which PRs need a response

### Stale PRs

Shows PRs that haven't been updated within the configured `stalePrDays` threshold. Useful for identifying reviews that may have been forgotten.

---

## Notifications

The extension sends VS Code notifications for:

| Event           | When                                                        |
| --------------- | ----------------------------------------------------------- |
| **New PR**      | A watched user opens a new PR in a watched repo             |
| **New Comment** | Someone comments on one of your open PRs                    |
| **Stale PR**    | A PR exceeds the staleness threshold (notified once per PR) |

Notifications only trigger after the first successful refresh to avoid flooding on startup.

---

## Development

```bash
git clone https://github.com/Philip-Carneiro/team-pr-tracker.git
cd team-pr-tracker
npm install
npm run watch
# Press F5 in VS Code to launch Extension Development Host
```

### Scripts

| Script                 | Description                              |
| ---------------------- | ---------------------------------------- |
| `npm run build`        | Production build with esbuild            |
| `npm run watch`        | Watch mode for development               |
| `npm test`             | Run tests with Vitest                    |
| `npm run test:watch`   | Run tests in watch mode                  |
| `npm run package`      | Package as `.vsix` file                  |
| `npm run lint`         | Run ESLint on `src/`                     |
| `npm run lint:fix`     | Run ESLint with auto-fix                 |
| `npm run format`       | Format all files with Prettier           |
| `npm run format:check` | Check formatting without modifying files |

### Code Quality

This project uses **ESLint**, **Prettier**, and **Husky** to enforce consistent code quality:

- **ESLint** — TypeScript linting with `@typescript-eslint` recommended rules
- **Prettier** — Automatic code formatting (single quotes, trailing commas, 100 char width)
- **Husky + lint-staged** — Pre-commit hook that runs tests, Prettier, and ESLint on every commit

The pre-commit hook runs in this order:

1. **Tests** (`npm test`) — All tests must pass (blocks commit on any failure)
2. **Prettier** — Auto-formats staged files
3. **ESLint** — Lints staged `.ts`/`.tsx` files with `--max-warnings 0`

If your commit is blocked by failing tests, fix the tests first. If blocked by lint/format issues, run:

```bash
npm run lint:fix && npm run format
```

### Architecture

```
src/
  extension.ts            Entry point: activation, commands, polling
  githubClient.ts         GitHub API client with request caching
  prTreeProvider.ts       TreeDataProvider for "All PRs" view
  myPrsTreeProvider.ts    TreeDataProvider for "My PRs" view
  stalePrsTreeProvider.ts TreeDataProvider for "Stale PRs" view
  notifier.ts             Notification logic (new PRs, comments)
  stalePrDetector.ts      Stale PR detection
  types.ts                Shared TypeScript interfaces
  test/                   Test suite (Vitest)
```

---

## Open Source

This project is open source under the [MIT License](LICENSE). Contributions are welcome!

### How to Contribute

1. **Fork** the repository
2. **Create a branch** for your feature or fix (`git checkout -b feature/my-feature`)
3. **Make your changes** and add tests
4. **Run the test suite** (`npm test`)
5. **Submit a Pull Request**

If you find a bug or have a feature request, please [open an issue](https://github.com/Philip-Carneiro/team-pr-tracker/issues).

---

## License

[MIT](LICENSE) - Philip Colares Carneiro
