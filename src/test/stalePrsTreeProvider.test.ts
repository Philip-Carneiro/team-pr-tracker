import { describe, it, expect, vi, afterEach } from 'vitest';
import { StalePrsTreeProvider } from '../stalePrsTreeProvider.js';
import { RepoGroup } from '../prTreeProvider.js';
import type { PullRequest } from '../types.js';

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

afterEach(() => {
  vi.useRealTimers();
});

describe('StalePrsTreeProvider', () => {
  it('shows only stale PRs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T10:00:00Z'));

    const provider = new StalePrsTreeProvider();
    provider.updateData(
      [
        makePR({ id: 1, updatedAt: '2026-04-15T10:00:00Z' }),
        makePR({ id: 2, updatedAt: '2026-04-24T10:00:00Z' }),
        makePR({ id: 3, updatedAt: '2026-04-10T10:00:00Z' }),
      ],
      3,
    );

    const roots = provider.getChildren();
    expect(roots).toHaveLength(1);
    const group = roots[0] as RepoGroup;
    expect(group.children).toHaveLength(2);
  });

  it('excludes closed PRs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T10:00:00Z'));

    const provider = new StalePrsTreeProvider();
    provider.updateData(
      [
        makePR({ id: 1, status: 'closed', updatedAt: '2026-04-10T10:00:00Z' }),
        makePR({ id: 2, status: 'open', updatedAt: '2026-04-10T10:00:00Z' }),
      ],
      3,
    );

    const roots = provider.getChildren();
    const group = roots[0] as RepoGroup;
    expect(group.children).toHaveLength(1);
  });

  it('excludes merged PRs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T10:00:00Z'));

    const provider = new StalePrsTreeProvider();
    provider.updateData(
      [makePR({ id: 1, status: 'merged', updatedAt: '2026-04-10T10:00:00Z' })],
      3,
    );

    const roots = provider.getChildren();
    expect(roots).toHaveLength(0);
  });

  it('returns empty when no PRs are stale', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T10:00:00Z'));

    const provider = new StalePrsTreeProvider();
    provider.updateData([makePR({ id: 1, updatedAt: '2026-04-21T10:00:00Z' })], 3);

    const roots = provider.getChildren();
    expect(roots).toHaveLength(0);
  });

  it('shows stale days in item description', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T10:00:00Z'));

    const provider = new StalePrsTreeProvider();
    provider.updateData([makePR({ id: 1, updatedAt: '2026-04-15T10:00:00Z' })], 3);

    const roots = provider.getChildren();
    const group = roots[0] as RepoGroup;
    const item = group.children[0];
    expect(item.description).toContain('10 days stale');
  });

  it('sorts stale PRs by staleness (most stale first)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T10:00:00Z'));

    const provider = new StalePrsTreeProvider();
    provider.updateData(
      [
        makePR({ id: 1, title: 'Newer stale', updatedAt: '2026-04-20T10:00:00Z' }),
        makePR({ id: 2, title: 'Older stale', updatedAt: '2026-04-10T10:00:00Z' }),
      ],
      3,
    );

    const roots = provider.getChildren();
    const group = roots[0] as RepoGroup;
    expect(group.children[0].label).toBe('Older stale');
    expect(group.children[1].label).toBe('Newer stale');
  });

  it('groups stale PRs by repo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T10:00:00Z'));

    const provider = new StalePrsTreeProvider();
    provider.updateData(
      [
        makePR({ id: 1, repo: 'org/repo-a', updatedAt: '2026-04-10T10:00:00Z' }),
        makePR({ id: 2, repo: 'org/repo-b', updatedAt: '2026-04-10T10:00:00Z' }),
      ],
      3,
    );

    const roots = provider.getChildren();
    expect(roots).toHaveLength(2);
  });

  it('respects custom stalePrDays threshold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T10:00:00Z'));

    const provider = new StalePrsTreeProvider();
    provider.updateData([makePR({ id: 1, updatedAt: '2026-04-20T10:00:00Z' })], 7);

    const roots = provider.getChildren();
    expect(roots).toHaveLength(0);

    provider.updateData([makePR({ id: 1, updatedAt: '2026-04-20T10:00:00Z' })], 3);

    const rootsAfter = provider.getChildren();
    expect(rootsAfter).toHaveLength(1);
  });
});
