import * as vscode from 'vscode';
import {
  fetchAllPRs,
  fetchAuthorLastCommitDate,
  fetchLatestExternalActivity,
  normalizeUsername,
  RateLimitError,
  RequestCache,
} from './githubClient.js';
import { PrTreeProvider } from './prTreeProvider.js';
import { MyPrsTreeProvider, detectNeedsAttention } from './myPrsTreeProvider.js';
import type { MyPrActivity } from './myPrsTreeProvider.js';
import { StalePrsTreeProvider } from './stalePrsTreeProvider.js';
import {
  buildUpdatedNotificationState,
  checkForNewComments,
  detectNewPRs,
  notifyNewComments,
  notifyNewPRs,
} from './notifier.js';
import { detectStalePRs, notifyStalePRs } from './stalePrDetector.js';
import type { CachedState, PullRequest, TrackerConfig } from './types.js';

const CACHED_STATE_KEY = 'teamPrTracker.cachedState';
const AUTHOR_FILTER_KEY = 'teamPrTracker.authorFilter';

const MIN_POLLING_MINUTES = 3;
const MAX_POLLING_MINUTES = 10;

const DEFAULT_CACHED_STATE: CachedState = {
  pullRequests: [],
  lastRefresh: null,
  notifiedPrIds: [],
  notifiedCommentIds: [],
  notifiedStalePrIds: [],
};

function clampPollingInterval(minutes: number): number {
  return Math.max(MIN_POLLING_MINUTES, Math.min(MAX_POLLING_MINUTES, minutes));
}

function readConfig(): TrackerConfig {
  const config = vscode.workspace.getConfiguration('teamPrTracker');
  const rawUsername = config.get<string>('githubUsername', '');
  const rawWatchedUsers = config.get<string[]>('watchedUsers', []);
  const rawPollingInterval = config.get<number>('pollingIntervalMinutes', MIN_POLLING_MINUTES);

  return {
    githubUsername: rawUsername ? normalizeUsername(rawUsername) : '',
    watchedRepos: config.get<string[]>('watchedRepos', []),
    watchedUsers: rawWatchedUsers.map(user => normalizeUsername(user)),
    stalePrDays: config.get<number>('stalePrDays', 3),
    pollingIntervalMinutes: clampPollingInterval(rawPollingInterval),
  };
}

function getCachedState(context: vscode.ExtensionContext): CachedState {
  return context.globalState.get<CachedState>(CACHED_STATE_KEY) ?? DEFAULT_CACHED_STATE;
}

async function saveCachedState(
  context: vscode.ExtensionContext,
  state: CachedState,
): Promise<void> {
  await context.globalState.update(CACHED_STATE_KEY, state);
}

async function buildMyPrsActivityMap(
  prs: PullRequest[],
  githubUsername: string,
  token?: string,
  cache?: RequestCache,
): Promise<Map<number, MyPrActivity>> {
  const activityMap = new Map<number, MyPrActivity>();
  if (!githubUsername) return activityMap;

  const userLower = githubUsername.toLowerCase();
  const myPRs = prs.filter(
    (pr) => pr.author.toLowerCase() === userLower && pr.status === 'open',
  );

  const results = await Promise.allSettled(
    myPRs.map(async (pr) => {
      const [lastCommitDate, externalActivity] = await Promise.all([
        fetchAuthorLastCommitDate(pr.repo, pr.number, githubUsername, token, cache),
        fetchLatestExternalActivity(pr.repo, pr.number, githubUsername, token, cache),
      ]);

      const detection = detectNeedsAttention(lastCommitDate, externalActivity);
      const activity: MyPrActivity = { ...detection, prId: pr.id };
      return { prId: pr.id, activity };
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      activityMap.set(result.value.prId, result.value.activity);
    }
  }

  return activityMap;
}

export function activate(context: vscode.ExtensionContext): void {
  const treeProvider = new PrTreeProvider();
  const myPrsProvider = new MyPrsTreeProvider();
  const stalePrsProvider = new StalePrsTreeProvider();

  const treeView = vscode.window.createTreeView('teamPrTracker.prList', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  const myPrsView = vscode.window.createTreeView('teamPrTracker.myPrs', {
    treeDataProvider: myPrsProvider,
    showCollapseAll: true,
  });

  const stalePrsView = vscode.window.createTreeView('teamPrTracker.stalePrs', {
    treeDataProvider: stalePrsProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(treeView, myPrsView, stalePrsView);

  const savedFilter = context.globalState.get<string[]>(AUTHOR_FILTER_KEY, []);
  if (savedFilter.length > 0) {
    treeProvider.setAuthorFilter(savedFilter);
  }

  const cachedState = getCachedState(context);
  if (cachedState.pullRequests.length > 0) {
    const config = readConfig();
    treeProvider.updateData(cachedState.pullRequests, config.stalePrDays, cachedState.lastRefresh);
    stalePrsProvider.updateData(cachedState.pullRequests, config.stalePrDays);
    myPrsProvider.updateData(
      cachedState.pullRequests,
      config.githubUsername,
      config.stalePrDays,
      new Map(),
    );
  }

  let isRefreshing = false;
  let pollingIntervalId: ReturnType<typeof setInterval> | undefined;

  function startPolling(intervalMinutes: number): void {
    if (pollingIntervalId) {
      clearInterval(pollingIntervalId);
    }
    const intervalMs = clampPollingInterval(intervalMinutes) * 60 * 1000;
    pollingIntervalId = setInterval(() => doRefresh(true), intervalMs);
  }

  function stopPolling(): void {
    if (pollingIntervalId) {
      clearInterval(pollingIntervalId);
      pollingIntervalId = undefined;
    }
  }

  async function doRefresh(silent = false): Promise<void> {
    if (isRefreshing) return;

    const config = readConfig();

    if (config.watchedRepos.length === 0 || config.watchedUsers.length === 0) {
      if (!silent) {
        vscode.window.showWarningMessage(
          'Team PR Tracker: Configure watched repos and users in Settings first.',
        );
      }
      return;
    }

    const token = await context.secrets.get('teamPrTracker.githubToken');
    if (!token && !silent) {
      const action = await vscode.window.showWarningMessage(
        'Team PR Tracker: No GitHub token set. API rate limits will be very low.',
        'Set Token',
      );
      if (action === 'Set Token') {
        vscode.commands.executeCommand('teamPrTracker.setToken');
        return;
      }
    }

    isRefreshing = true;

    const progressOptions: vscode.ProgressOptions = {
      location: vscode.ProgressLocation.Window,
      title: 'Team PR Tracker',
    };

    await vscode.window.withProgress(progressOptions, async (progress) => {
      const previousState = getCachedState(context);
      const cache = new RequestCache();

      try {
        progress.report({
          message: `Fetching PRs from ${config.watchedRepos.length} repo${config.watchedRepos.length !== 1 ? 's' : ''}...`,
        });

        const prs = await fetchAllPRs(
          config.watchedRepos,
          config.watchedUsers,
          token,
          config.githubUsername || undefined,
          cache,
        );

        progress.report({ message: 'Checking for new activity...' });

        const newPRs = detectNewPRs(prs, previousState);
        const stalePRs = detectStalePRs(prs, config.stalePrDays, previousState);

        let newComments: { prTitle: string; commentId: number; author: string }[] = [];
        if (config.githubUsername) {
          newComments = await checkForNewComments(prs, previousState, config.githubUsername, token, cache);
        }

        const updatedState = buildUpdatedNotificationState(
          prs,
          newComments.map((c) => c.commentId),
          stalePRs.map((pr) => pr.id),
          previousState,
        );
        await saveCachedState(context, updatedState);

        progress.report({ message: 'Updating views...' });

        treeProvider.updateData(prs, config.stalePrDays, updatedState.lastRefresh);
        stalePrsProvider.updateData(prs, config.stalePrDays);

        let activityMap = new Map<number, MyPrActivity>();
        if (config.githubUsername) {
          activityMap = await buildMyPrsActivityMap(prs, config.githubUsername, token, cache);
        }
        myPrsProvider.updateData(prs, config.githubUsername, config.stalePrDays, activityMap);

        if (previousState.lastRefresh !== null) {
          await notifyNewPRs(newPRs);
          await notifyNewComments(newComments);
          await notifyStalePRs(stalePRs);
        }

        if (!silent) {
          vscode.window.showInformationMessage(
            `Team PR Tracker: Found ${prs.length} PR${prs.length !== 1 ? 's' : ''} across ${config.watchedRepos.length} repo${config.watchedRepos.length !== 1 ? 's' : ''}.`,
          );
        }
      } catch (err) {
        if (err instanceof RateLimitError) {
          vscode.window.showErrorMessage(
            'Team PR Tracker: GitHub API rate limit exceeded. Set a token to increase limits.',
          );
        } else {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          vscode.window.showErrorMessage(`Team PR Tracker: Refresh failed — ${msg}`);
        }
      } finally {
        cache.clear();
        isRefreshing = false;
      }
    });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('teamPrTracker.refreshNow', async () => {
      await doRefresh(false);
      startPolling(readConfig().pollingIntervalMinutes);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('teamPrTracker.setToken', async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Enter your GitHub Personal Access Token (leave empty to clear)',
        password: true,
        placeHolder: 'ghp_xxxxxxxxxxxx',
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (value && !value.startsWith('ghp_') && !value.startsWith('github_pat_')) {
            return 'GitHub tokens typically start with "ghp_" or "github_pat_"';
          }
          return null;
        },
      });

      if (token !== undefined) {
        if (token) {
          await context.secrets.store('teamPrTracker.githubToken', token);
          vscode.window.showInformationMessage('Team PR Tracker: GitHub token saved securely.');
        } else {
          await context.secrets.delete('teamPrTracker.githubToken');
          vscode.window.showInformationMessage('Team PR Tracker: GitHub token cleared.');
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('teamPrTracker.resetToken', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Are you sure you want to reset your GitHub token?',
        { modal: true },
        'Yes, Reset',
        'Cancel',
      );

      if (confirm === 'Yes, Reset') {
        await context.secrets.delete('teamPrTracker.githubToken');
        vscode.window.showInformationMessage('Team PR Tracker: GitHub token has been reset.');
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('teamPrTracker.viewTokenStatus', async () => {
      const token = await context.secrets.get('teamPrTracker.githubToken');
      if (token) {
        const maskedToken = `${token.substring(0, 7)}...${token.substring(token.length - 4)}`;
        const action = await vscode.window.showInformationMessage(
          `Team PR Tracker: Token configured (${maskedToken})`,
          'Update Token',
          'Reset Token',
        );
        if (action === 'Update Token') {
          vscode.commands.executeCommand('teamPrTracker.setToken');
        } else if (action === 'Reset Token') {
          vscode.commands.executeCommand('teamPrTracker.resetToken');
        }
      } else {
        const action = await vscode.window.showWarningMessage(
          'Team PR Tracker: No GitHub token configured. API rate limits will be very low (60 requests/hour).',
          'Set Token Now',
        );
        if (action === 'Set Token Now') {
          vscode.commands.executeCommand('teamPrTracker.setToken');
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('teamPrTracker.openPr', (arg: unknown) => {
      let url: string | undefined;

      if (typeof arg === 'string') {
        url = arg;
      } else if (arg && typeof arg === 'object' && 'pr' in arg) {
        url = (arg as { pr: { url: string } }).pr.url;
      }

      if (url) {
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('teamPrTracker.filterByAuthor', async () => {
      const availableAuthors = treeProvider.getAvailableAuthors();

      if (availableAuthors.length === 0) {
        vscode.window.showInformationMessage(
          'Team PR Tracker: No PRs loaded yet. Refresh first.',
        );
        return;
      }

      const currentFilter = treeProvider.getAuthorFilter();
      const currentFilterSet = new Set(currentFilter.map((a) => a.toLowerCase()));

      const items: vscode.QuickPickItem[] = [
        {
          label: 'All Authors',
          description: currentFilter.length === 0 ? '(currently selected)' : '',
          picked: currentFilter.length === 0,
        },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
        ...availableAuthors.map((author) => ({
          label: author,
          picked: currentFilterSet.has(author.toLowerCase()),
        })),
      ];

      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: 'Select authors to show (leave empty for all)',
        title: 'Filter PRs by Author',
      });

      if (selected === undefined) return;

      const hasAllAuthors = selected.some((item) => item.label === 'All Authors');
      const selectedAuthors = hasAllAuthors
        ? []
        : selected
            .filter((item) => item.label !== 'All Authors' && item.label !== '')
            .map((item) => item.label);

      treeProvider.setAuthorFilter(selectedAuthors);
      await context.globalState.update(AUTHOR_FILTER_KEY, selectedAuthors);
    }),
  );

  doRefresh(true);

  const config = readConfig();
  startPolling(config.pollingIntervalMinutes);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('teamPrTracker')) {
        const updatedConfig = readConfig();
        startPolling(updatedConfig.pollingIntervalMinutes);
        doRefresh(true);
      }
    }),
  );

  context.subscriptions.push({
    dispose: () => stopPolling(),
  });
}

export function deactivate(): void {
  // cleanup handled by subscriptions
}
