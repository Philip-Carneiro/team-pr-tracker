import { describe, it, expect } from 'vitest';
import { detectNewPRs, buildUpdatedNotificationState } from '../notifier.js';
import type { CachedState, PullRequest } from '../types.js';

function makePR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 1001,
    number: 42,
    title: 'Fix something',
    url: 'https://github.com/org/repo/pull/42',
    author: 'alice',
    repo: 'org/repo',
    status: 'open',
    checkStatus: 'passed',
    reviewRelation: 'not_involved',
    createdAt: '2026-04-01T10:00:00Z',
    updatedAt: '2026-04-20T10:00:00Z',
    commentCount: 3,
    ...overrides,
  };
}

function makeEmptyState(overrides: Partial<CachedState> = {}): CachedState {
  return {
    pullRequests: [],
    lastRefresh: null,
    notifiedPrIds: [],
    notifiedCommentIds: [],
    notifiedStalePrIds: [],
    ...overrides,
  };
}

describe('detectNewPRs', () => {
  it('detects PRs not in the cached notified list', () => {
    const prs = [makePR({ id: 1 }), makePR({ id: 2 }), makePR({ id: 3 })];
    const state = makeEmptyState({ notifiedPrIds: [1, 2] });

    const newPRs = detectNewPRs(prs, state);
    expect(newPRs).toHaveLength(1);
    expect(newPRs[0].id).toBe(3);
  });

  it('returns all PRs when cache is empty', () => {
    const prs = [makePR({ id: 1 }), makePR({ id: 2 })];
    const state = makeEmptyState();

    const newPRs = detectNewPRs(prs, state);
    expect(newPRs).toHaveLength(2);
  });

  it('returns empty when all PRs are already known', () => {
    const prs = [makePR({ id: 1 }), makePR({ id: 2 })];
    const state = makeEmptyState({ notifiedPrIds: [1, 2] });

    const newPRs = detectNewPRs(prs, state);
    expect(newPRs).toHaveLength(0);
  });
});

describe('buildUpdatedNotificationState', () => {
  it('merges new comment IDs into existing state', () => {
    const prs = [makePR({ id: 1 }), makePR({ id: 2 })];
    const previousState = makeEmptyState({
      notifiedCommentIds: [100, 101],
      notifiedStalePrIds: [50],
    });

    const updated = buildUpdatedNotificationState(prs, [102, 103], [51], previousState);

    expect(updated.pullRequests).toHaveLength(2);
    expect(updated.notifiedPrIds).toEqual([1, 2]);
    expect(updated.notifiedCommentIds).toEqual([100, 101, 102, 103]);
    expect(updated.notifiedStalePrIds).toEqual([50, 51]);
    expect(updated.lastRefresh).toBeTruthy();
  });

  it('deduplicates stale PR IDs', () => {
    const previousState = makeEmptyState({ notifiedStalePrIds: [1, 2] });
    const updated = buildUpdatedNotificationState([], [], [2, 3], previousState);
    expect(updated.notifiedStalePrIds).toEqual([1, 2, 3]);
  });
});
