# Team PR Tracker

A VS Code / Cursor extension to track Pull Requests across repositories and team members.

## Features

- TreeView panel showing all open PRs from watched repos and users
- Notifications for new PRs, new comments, and stale PRs
- Build status indicators
- Configurable polling interval
- Works offline with cached data

## Setup

1. Set your GitHub token: `Cmd+Shift+P` > "Team PR Tracker: Set GitHub Token"
2. Configure watched repos and users in VS Code Settings
3. PRs will appear in the sidebar panel

## Development

```bash
npm install
npm run watch
# Press F5 to launch Extension Development Host
```
