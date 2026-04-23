import * as vscode from 'vscode';
import type { PullRequest } from './types.js';
import { RepoGroup, formatRelativeDate } from './prTreeProvider.js';
import { isStale, daysSinceUpdate } from './stalePrDetector.js';

export class StalePrsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private pullRequests: PullRequest[] = [];
  private staleDays = 3;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  updateData(prs: PullRequest[], staleDays: number): void {
    this.pullRequests = prs;
    this.staleDays = staleDays;
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

  private getStalePRs(): PullRequest[] {
    return this.pullRequests.filter((pr) => isStale(pr, this.staleDays));
  }

  private getRootElements(): vscode.TreeItem[] {
    const stalePRs = this.getStalePRs();

    if (stalePRs.length === 0) {
      return [];
    }

    const grouped = new Map<string, PullRequest[]>();
    for (const pr of stalePRs) {
      const existing = grouped.get(pr.repo) ?? [];
      existing.push(pr);
      grouped.set(pr.repo, existing);
    }

    const repoGroups: RepoGroup[] = [];
    for (const [repo, prs] of grouped) {
      const sorted = [...prs].sort((a, b) => daysSinceUpdate(b) - daysSinceUpdate(a));

      const children = sorted.map((pr) => new StalePrTreeItem(pr, this.staleDays));
      repoGroups.push(new RepoGroup(repo, children));
    }

    return repoGroups.sort((a, b) => a.repoName.localeCompare(b.repoName));
  }
}

class StalePrTreeItem extends vscode.TreeItem {
  constructor(
    public readonly pr: PullRequest,
    staleDays: number,
  ) {
    super(pr.title, vscode.TreeItemCollapsibleState.None);

    const days = daysSinceUpdate(pr);

    this.iconPath = new vscode.ThemeIcon(
      'warning',
      new vscode.ThemeColor('editorWarning.foreground'),
    );

    const parts: string[] = [`@${pr.author}`];
    parts.push(`${days} days stale`);
    parts.push(`updated ${formatRelativeDate(pr.updatedAt)}`);
    this.description = parts.join(' · ');

    const tooltipLines = [
      `**${pr.title}**`,
      '',
      `Author: ${pr.author}`,
      `Repo: ${pr.repo}`,
      `Build: ${pr.checkStatus}`,
      `Review: ${pr.reviewRelation.replace(/_/g, ' ')}`,
      `Comments: ${pr.commentCount}`,
      '',
      `**STALE: No updates for ${days} days** (threshold: ${staleDays} days)`,
      `Last updated: ${new Date(pr.updatedAt).toLocaleString()}`,
    ];
    this.tooltip = new vscode.MarkdownString(tooltipLines.join('\n\n'));

    this.contextValue = 'pullRequest';

    this.command = {
      command: 'teamPrTracker.openPr',
      title: 'Open PR',
      arguments: [pr.url],
    };
  }
}
