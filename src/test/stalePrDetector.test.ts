import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectStalePRs, isStale, daysSinceUpdate } from '../stalePrDetector.js';
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
    commentCount: 0,
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

afterEach(() => {
  vi.useRealTimers();
});

describe('isStale', () => {
  it('returns true when PR has not been updated for longer than staleDays', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T10:00:00Z'));

    const pr = makePR({ updatedAt: '2026-04-20T10:00:00Z' });
    expect(isStale(pr, 3)).toBe(true);
  });

  it('returns false when PR was recently updated', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T10:00:00Z'));

    const pr = makePR({ updatedAt: '2026-04-20T10:00:00Z' });
    expect(isStale(pr, 3)).toBe(false);
  });

  it('returns false for closed PRs regardless of age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T10:00:00Z'));

    const pr = makePR({ status: 'closed', updatedAt: '2026-04-01T10:00:00Z' });
    expect(isStale(pr, 3)).toBe(false);
  });

  it('returns false for merged PRs regardless of age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T10:00:00Z'));

    const pr = makePR({ status: 'merged', updatedAt: '2026-04-01T10:00:00Z' });
    expect(isStale(pr, 3)).toBe(false);
  });
});

describe('daysSinceUpdate', () => {
  it('calculates correct number of days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T10:00:00Z'));

    const pr = makePR({ updatedAt: '2026-04-20T10:00:00Z' });
    expect(daysSinceUpdate(pr)).toBe(5);
  });

  it('returns 0 for same day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T15:00:00Z'));

    const pr = makePR({ updatedAt: '2026-04-20T10:00:00Z' });
    expect(daysSinceUpdate(pr)).toBe(0);
  });
});

describe('detectStalePRs', () => {
  it('finds stale PRs that have not been notified', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T10:00:00Z'));

    const stalePR = makePR({ id: 1, updatedAt: '2026-04-15T10:00:00Z' });
    const freshPR = makePR({ id: 2, updatedAt: '2026-04-24T10:00:00Z' });
    const state = makeEmptyState();

    const result = detectStalePRs([stalePR, freshPR], 3, state);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('excludes already-notified stale PRs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T10:00:00Z'));

    const stalePR = makePR({ id: 1, updatedAt: '2026-04-15T10:00:00Z' });
    const state = makeEmptyState({ notifiedStalePrIds: [1] });

    const result = detectStalePRs([stalePR], 3, state);
    expect(result).toHaveLength(0);
  });

  it('excludes closed PRs even if old', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T10:00:00Z'));

    const closedPR = makePR({ id: 1, status: 'closed', updatedAt: '2026-04-01T10:00:00Z' });
    const state = makeEmptyState();

    const result = detectStalePRs([closedPR], 3, state);
    expect(result).toHaveLength(0);
  });
});
