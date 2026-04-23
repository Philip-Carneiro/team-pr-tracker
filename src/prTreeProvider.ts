import * as vscode from 'vscode';
import type { CheckStatus, PRStatus, PullRequest, ReviewRelation } from './types.js';
import { isStale, daysSinceUpdate } from './stalePrDetector.js';

type TreeElement = RepoGroup | PrTreeItem;

export class PrTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private pullRequests: PullRequest[] = [];
  private staleDays = 3;
  private lastRefresh: string | null = null;
  private authorFilter: string[] = [];

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  updateData(prs: PullRequest[], staleDays: number, lastRefresh: string | null): void {
    this.pullRequests = prs;
    this.staleDays = staleDays;
    this.lastRefresh = lastRefresh;
    this.refresh();
  }

  setAuthorFilter(authors: string[]): void {
    this.authorFilter = authors;
    this.refresh();
  }

  getAuthorFilter(): string[] {
    return this.authorFilter;
  }

  getAvailableAuthors(): string[] {
    const authors = new Set<string>();
    for (const pr of this.pullRequests) {
      authors.add(pr.author);
    }
    return [...authors].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) {
      return this.getRootElements();
    }

    if (element instanceof RepoGroup) {
      return element.children;
    }

    return [];
  }

  private getFilteredPRs(): PullRequest[] {
    if (this.authorFilter.length === 0) {
      return this.pullRequests;
    }
    const filterSet = new Set(this.authorFilter.map((a) => a.toLowerCase()));
    return this.pullRequests.filter((pr) => filterSet.has(pr.author.toLowerCase()));
  }

  private getRootElements(): TreeElement[] {
    const filteredPRs = this.getFilteredPRs();

    if (filteredPRs.length === 0) {
      return [];
    }

    const grouped = new Map<string, PullRequest[]>();
    for (const pr of filteredPRs) {
      const existing = grouped.get(pr.repo) ?? [];
      existing.push(pr);
      grouped.set(pr.repo, existing);
    }

    const repoGroups: RepoGroup[] = [];
    for (const [repo, prs] of grouped) {
      const sorted = [...prs].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

      const children = sorted.map((pr) => new PrTreeItem(pr, this.staleDays));
      repoGroups.push(new RepoGroup(repo, children));
    }

    return repoGroups.sort((a, b) => a.repoName.localeCompare(b.repoName));
  }
}

export class RepoGroup extends vscode.TreeItem {
  children: PrTreeItem[];
  readonly repoName: string;

  constructor(repo: string, children: PrTreeItem[]) {
    super(repo, vscode.TreeItemCollapsibleState.Expanded);
    this.repoName = repo;
    this.children = children;
    this.iconPath = new vscode.ThemeIcon('repo');
    this.description = `${children.length} PR${children.length !== 1 ? 's' : ''}`;
    this.contextValue = 'repoGroup';
  }
}

function getStatusIcon(status: PRStatus): vscode.ThemeIcon {
  switch (status) {
    case 'open':
      return new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('charts.green'));
    case 'closed':
      return new vscode.ThemeIcon('git-pull-request-closed', new vscode.ThemeColor('charts.red'));
    case 'merged':
      return new vscode.ThemeIcon('git-merge', new vscode.ThemeColor('charts.purple'));
  }
}

export function formatRelativeDate(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
}

export class PrTreeItem extends vscode.TreeItem {
  constructor(
    public readonly pr: PullRequest,
    staleDays: number,
  ) {
    super(pr.title, vscode.TreeItemCollapsibleState.None);

    const stale = isStale(pr, staleDays);
    const days = daysSinceUpdate(pr);

    this.iconPath = getStatusIcon(pr.status);

    const parts: string[] = [`@${pr.author}`];
    parts.push(`updated ${formatRelativeDate(pr.updatedAt)}`);
    if (stale) parts.push(`STALE (${days}d)`);
    this.description = parts.join(' · ');

    const tooltipLines = [
      pr.title,
      `Author: ${pr.author}`,
      `Repo: ${pr.repo}`,
      `Status: ${pr.status}`,
      `Build: ${pr.checkStatus}`,
      `Review: ${pr.reviewRelation.replace(/_/g, ' ')}`,
      `Created: ${new Date(pr.createdAt).toLocaleDateString()}`,
      `Updated: ${new Date(pr.updatedAt).toLocaleDateString()}`,
      `Comments: ${pr.commentCount}`,
    ];
    if (stale) tooltipLines.push(`** STALE — no updates for ${days} days **`);
    this.tooltip = new vscode.MarkdownString(tooltipLines.join('\n\n'));

    this.contextValue = 'pullRequest';

    this.command = {
      command: 'teamPrTracker.openPr',
      title: 'Open PR',
      arguments: [pr.url],
    };

    if (stale) {
      this.iconPath = new vscode.ThemeIcon(
        'warning',
        new vscode.ThemeColor('editorWarning.foreground'),
      );
    }
  }
}
