import * as vscode from 'vscode';
import type { CachedState, PullRequest } from './types.js';
import { fetchPRComments, type RequestCache } from './githubClient.js';

export interface NotificationResult {
  newPrIds: number[];
  newCommentIds: number[];
}

export function detectNewPRs(
  currentPRs: PullRequest[],
  cachedState: CachedState,
): PullRequest[] {
  const previousIds = new Set(cachedState.notifiedPrIds);
  return currentPRs.filter((pr) => !previousIds.has(pr.id));
}

export async function checkForNewComments(
  prs: PullRequest[],
  cachedState: CachedState,
  myUsername: string,
  token?: string,
  cache?: RequestCache,
): Promise<{ prTitle: string; commentId: number; author: string }[]> {
  const knownCommentIds = new Set(cachedState.notifiedCommentIds);
  const newComments: { prTitle: string; commentId: number; author: string }[] = [];

  const myPRs = prs.filter(
    (pr) => pr.status === 'open' && pr.author.toLowerCase() === myUsername.toLowerCase(),
  );

  for (const pr of myPRs) {
    try {
      const comments = await fetchPRComments(pr.repo, pr.number, token, cache);
      for (const comment of comments) {
        if (
          !knownCommentIds.has(comment.id) &&
          comment.author.toLowerCase() !== myUsername.toLowerCase()
        ) {
          newComments.push({
            prTitle: pr.title,
            commentId: comment.id,
            author: comment.author,
          });
        }
      }
    } catch {
      // skip PRs where comment fetch fails
    }
  }

  return newComments;
}

export async function notifyNewPRs(newPRs: PullRequest[]): Promise<void> {
  for (const pr of newPRs) {
    const action = await vscode.window.showInformationMessage(
      `New PR: "${pr.title}" by ${pr.author} in ${pr.repo}`,
      'Open in Browser',
    );
    if (action === 'Open in Browser') {
      vscode.env.openExternal(vscode.Uri.parse(pr.url));
    }
  }
}

export async function notifyNewComments(
  comments: { prTitle: string; commentId: number; author: string }[],
): Promise<void> {
  if (comments.length === 0) return;

  if (comments.length === 1) {
    await vscode.window.showInformationMessage(
      `New comment by ${comments[0].author} on "${comments[0].prTitle}"`,
    );
  } else {
    await vscode.window.showInformationMessage(
      `${comments.length} new comments on your PRs`,
    );
  }
}

export function buildUpdatedNotificationState(
  currentPRs: PullRequest[],
  newCommentIds: number[],
  stalePrIds: number[],
  previousState: CachedState,
): CachedState {
  return {
    pullRequests: currentPRs,
    lastRefresh: new Date().toISOString(),
    notifiedPrIds: currentPRs.map((pr) => pr.id),
    notifiedCommentIds: [...previousState.notifiedCommentIds, ...newCommentIds],
    notifiedStalePrIds: [...new Set([...previousState.notifiedStalePrIds, ...stalePrIds])],
  };
}
