import * as vscode from 'vscode';
import type { PullRequest } from './types.js';
import { PrTreeItem, RepoGroup, formatRelativeDate } from './prTreeProvider.js';
import { daysSinceUpdate } from './stalePrDetector.js';

export interface MyPrActivity {
  prId: number;
  needsAttention: boolean;
  lastCommitDate: string | null;
  lastExternalActivityDate: string | null;
  hasChangesRequested: boolean;
}

export class MyPrsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private pullRequests: PullRequest[] = [];
  private githubUsername = '';
  private staleDays = 3;
  private activityMap = new Map<number, MyPrActivity>();

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  updateData(
    prs: PullRequest[],
    githubUsername: string,
    staleDays: number,
    activityMap: Map<number, MyPrActivity>,
  ): void {
    this.pullRequests = prs;
    this.githubUsername = githubUsername;
    this.staleDays = staleDays;
    this.activityMap = activityMap;
    this.refresh();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (!element) {
      return this.getRootElements();
    }

    if (element instanceof RepoGroup) {
      return element.children;
    }

    return [];
  }

  private getMyPRs(): PullRequest[] {
    if (!this.githubUsername) return [];
    const userLower = this.githubUsername.toLowerCase();
    return this.pullRequests.filter(
      (pr) => pr.author.toLowerCase() === userLower && pr.status === 'open',
    );
  }

  private getRootElements(): vscode.TreeItem[] {
    const myPRs = this.getMyPRs();

    if (myPRs.length === 0) {
      return [];
    }

    const grouped = new Map<string, PullRequest[]>();
    for (const pr of myPRs) {
      const existing = grouped.get(pr.repo) ?? [];
      existing.push(pr);
      grouped.set(pr.repo, existing);
    }

    const repoGroups: RepoGroup[] = [];
    for (const [repo, prs] of grouped) {
      const sorted = [...prs].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

      const children = sorted.map((pr) => {
        const activity = this.activityMap.get(pr.id);
        if (activity?.needsAttention) {
          return new MyPrTreeItem(pr, this.staleDays, activity);
        }
        return new PrTreeItem(pr, this.staleDays);
      });

      repoGroups.push(new RepoGroup(repo, children));
    }

    return repoGroups.sort((a, b) => a.repoName.localeCompare(b.repoName));
  }
}

class MyPrTreeItem extends vscode.TreeItem {
  constructor(
    public readonly pr: PullRequest,
    staleDays: number,
    activity: MyPrActivity,
  ) {
    super(pr.title, vscode.TreeItemCollapsibleState.None);

    const _days = daysSinceUpdate(pr);

    const parts: string[] = [];

    if (activity.hasChangesRequested) {
      parts.push('CHANGES REQUESTED');
    } else {
      parts.push('NEW ACTIVITY');
    }

    parts.push(`updated ${formatRelativeDate(pr.updatedAt)}`);
    this.description = parts.join(' · ');

    this.iconPath = new vscode.ThemeIcon(
      activity.hasChangesRequested ? 'request-changes' : 'bell-dot',
      new vscode.ThemeColor(
        activity.hasChangesRequested
          ? 'editorWarning.foreground'
          : 'notificationsInfoIcon.foreground',
      ),
    );

    const tooltipLines = [
      `**${pr.title}**`,
      '',
      `Repo: ${pr.repo}`,
      `Status: ${pr.status}`,
      `Build: ${pr.checkStatus}`,
      `Comments: ${pr.commentCount}`,
      '',
      activity.hasChangesRequested
        ? '**Changes requested by a reviewer**'
        : '**New comments/reviews since your last commit**',
    ];

    if (activity.lastCommitDate) {
      tooltipLines.push(`Your last commit: ${new Date(activity.lastCommitDate).toLocaleString()}`);
    }
    if (activity.lastExternalActivityDate) {
      tooltipLines.push(
        `Latest activity: ${new Date(activity.lastExternalActivityDate).toLocaleString()}`,
      );
    }

    this.tooltip = new vscode.MarkdownString(tooltipLines.join('\n\n'));

    this.contextValue = 'pullRequest';

    this.command = {
      command: 'teamPrTracker.openPr',
      title: 'Open PR',
      arguments: [pr.url],
    };
  }
}

/**
 * Determines whether a PR needs attention based on comparing the author's last
 * commit date with the latest external activity (comments/reviews from others).
 */
export function detectNeedsAttention(
  lastCommitDate: string | null,
  externalActivity: { date: string; hasChangesRequested: boolean } | null,
): MyPrActivity & { prId: 0 } {
  if (!externalActivity) {
    return {
      prId: 0,
      needsAttention: false,
      lastCommitDate,
      lastExternalActivityDate: null,
      hasChangesRequested: false,
    };
  }

  if (!lastCommitDate) {
    return {
      prId: 0,
      needsAttention: true,
      lastCommitDate: null,
      lastExternalActivityDate: externalActivity.date,
      hasChangesRequested: externalActivity.hasChangesRequested,
    };
  }

  const commitTime = new Date(lastCommitDate).getTime();
  const activityTime = new Date(externalActivity.date).getTime();
  const needsAttention = activityTime > commitTime;

  return {
    prId: 0,
    needsAttention,
    lastCommitDate,
    lastExternalActivityDate: externalActivity.date,
    hasChangesRequested: needsAttention && externalActivity.hasChangesRequested,
  };
}
