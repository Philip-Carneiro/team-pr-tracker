import * as vscode from 'vscode';
import type { CachedState, PullRequest } from './types.js';

export function detectStalePRs(
  prs: PullRequest[],
  staleDays: number,
  cachedState: CachedState,
): PullRequest[] {
  const now = Date.now();
  const staleThresholdMs = staleDays * 24 * 60 * 60 * 1000;
  const alreadyNotified = new Set(cachedState.notifiedStalePrIds);

  return prs.filter((pr) => {
    if (pr.status !== 'open') return false;
    if (alreadyNotified.has(pr.id)) return false;
    const updatedAt = new Date(pr.updatedAt).getTime();
    return now - updatedAt >= staleThresholdMs;
  });
}

export function isStale(pr: PullRequest, staleDays: number): boolean {
  if (pr.status !== 'open') return false;
  const now = Date.now();
  const staleThresholdMs = staleDays * 24 * 60 * 60 * 1000;
  const updatedAt = new Date(pr.updatedAt).getTime();
  return now - updatedAt >= staleThresholdMs;
}

export async function notifyStalePRs(stalePRs: PullRequest[]): Promise<void> {
  if (stalePRs.length === 0) return;

  if (stalePRs.length === 1) {
    const pr = stalePRs[0];
    const action = await vscode.window.showWarningMessage(
      `Stale PR: "${pr.title}" by ${pr.author} has not been updated recently`,
      'Open in Browser',
    );
    if (action === 'Open in Browser') {
      vscode.env.openExternal(vscode.Uri.parse(pr.url));
    }
  } else {
    await vscode.window.showWarningMessage(
      `${stalePRs.length} PRs have not been updated in a while`,
    );
  }
}

export function daysSinceUpdate(pr: PullRequest): number {
  const now = Date.now();
  const updatedAt = new Date(pr.updatedAt).getTime();
  return Math.floor((now - updatedAt) / (24 * 60 * 60 * 1000));
}
