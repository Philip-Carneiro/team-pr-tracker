import { describe, it, expect, vi, afterEach } from 'vitest';
import { MyPrsTreeProvider, detectNeedsAttention } from '../myPrsTreeProvider.js';
import type { MyPrActivity } from '../myPrsTreeProvider.js';
import { RepoGroup, PrTreeItem } from '../prTreeProvider.js';
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

describe('detectNeedsAttention', () => {
  it('returns needsAttention=false when no external activity', () => {
    const result = detectNeedsAttention('2026-04-20T10:00:00Z', null);
    expect(result.needsAttention).toBe(false);
    expect(result.lastCommitDate).toBe('2026-04-20T10:00:00Z');
    expect(result.lastExternalActivityDate).toBeNull();
  });

  it('returns needsAttention=true when external activity is newer than last commit', () => {
    const result = detectNeedsAttention('2026-04-18T10:00:00Z', {
      date: '2026-04-20T10:00:00Z',
      hasChangesRequested: false,
    });
    expect(result.needsAttention).toBe(true);
    expect(result.hasChangesRequested).toBe(false);
  });

  it('returns needsAttention=false when last commit is newer than external activity', () => {
    const result = detectNeedsAttention('2026-04-22T10:00:00Z', {
      date: '2026-04-20T10:00:00Z',
      hasChangesRequested: false,
    });
    expect(result.needsAttention).toBe(false);
  });

  it('returns needsAttention=true with hasChangesRequested when reviewer requested changes', () => {
    const result = detectNeedsAttention('2026-04-18T10:00:00Z', {
      date: '2026-04-20T10:00:00Z',
      hasChangesRequested: true,
    });
    expect(result.needsAttention).toBe(true);
    expect(result.hasChangesRequested).toBe(true);
  });

  it('returns hasChangesRequested=false even if changes were requested before last commit', () => {
    const result = detectNeedsAttention('2026-04-22T10:00:00Z', {
      date: '2026-04-20T10:00:00Z',
      hasChangesRequested: true,
    });
    expect(result.needsAttention).toBe(false);
    expect(result.hasChangesRequested).toBe(false);
  });

  it('returns needsAttention=true when no commit date but external activity exists', () => {
    const result = detectNeedsAttention(null, {
      date: '2026-04-20T10:00:00Z',
      hasChangesRequested: false,
    });
    expect(result.needsAttention).toBe(true);
  });

  it('handles same timestamp as not needing attention', () => {
    const result = detectNeedsAttention('2026-04-20T10:00:00Z', {
      date: '2026-04-20T10:00:00Z',
      hasChangesRequested: false,
    });
    expect(result.needsAttention).toBe(false);
  });
});

describe('MyPrsTreeProvider', () => {
  it('shows only PRs authored by githubUsername', () => {
    const provider = new MyPrsTreeProvider();
    provider.updateData(
      [
        makePR({ id: 1, author: 'alice' }),
        makePR({ id: 2, author: 'bob' }),
        makePR({ id: 3, author: 'alice' }),
      ],
      'alice',
      3,
      new Map(),
    );

    const roots = provider.getChildren();
    expect(roots).toHaveLength(1);
    const group = roots[0] as RepoGroup;
    expect(group.children).toHaveLength(2);
  });

  it('is case-insensitive for username matching', () => {
    const provider = new MyPrsTreeProvider();
    provider.updateData(
      [makePR({ id: 1, author: 'Alice' })],
      'alice',
      3,
      new Map(),
    );

    const roots = provider.getChildren();
    expect(roots).toHaveLength(1);
  });

  it('excludes closed and merged PRs', () => {
    const provider = new MyPrsTreeProvider();
    provider.updateData(
      [
        makePR({ id: 1, author: 'alice', status: 'open' }),
        makePR({ id: 2, author: 'alice', status: 'closed' }),
        makePR({ id: 3, author: 'alice', status: 'merged' }),
      ],
      'alice',
      3,
      new Map(),
    );

    const roots = provider.getChildren();
    expect(roots).toHaveLength(1);
    const group = roots[0] as RepoGroup;
    expect(group.children).toHaveLength(1);
  });

  it('returns empty when no githubUsername configured', () => {
    const provider = new MyPrsTreeProvider();
    provider.updateData(
      [makePR({ id: 1, author: 'alice' })],
      '',
      3,
      new Map(),
    );

    const roots = provider.getChildren();
    expect(roots).toHaveLength(0);
  });

  it('marks PRs needing attention with special tree items', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T10:00:00Z'));

    const activityMap = new Map<number, MyPrActivity>();
    activityMap.set(1, {
      prId: 1,
      needsAttention: true,
      lastCommitDate: '2026-04-18T10:00:00Z',
      lastExternalActivityDate: '2026-04-21T10:00:00Z',
      hasChangesRequested: false,
    });

    const provider = new MyPrsTreeProvider();
    provider.updateData(
      [makePR({ id: 1, author: 'alice' })],
      'alice',
      3,
      activityMap,
    );

    const roots = provider.getChildren();
    const group = roots[0] as RepoGroup;
    const item = group.children[0];
    expect(item.description).toContain('NEW ACTIVITY');
  });

  it('marks PRs with changes requested appropriately', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T10:00:00Z'));

    const activityMap = new Map<number, MyPrActivity>();
    activityMap.set(1, {
      prId: 1,
      needsAttention: true,
      lastCommitDate: '2026-04-18T10:00:00Z',
      lastExternalActivityDate: '2026-04-21T10:00:00Z',
      hasChangesRequested: true,
    });

    const provider = new MyPrsTreeProvider();
    provider.updateData(
      [makePR({ id: 1, author: 'alice' })],
      'alice',
      3,
      activityMap,
    );

    const roots = provider.getChildren();
    const group = roots[0] as RepoGroup;
    const item = group.children[0];
    expect(item.description).toContain('CHANGES REQUESTED');
  });

  it('uses standard PrTreeItem for PRs without activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T10:00:00Z'));

    const provider = new MyPrsTreeProvider();
    provider.updateData(
      [makePR({ id: 1, author: 'alice' })],
      'alice',
      3,
      new Map(),
    );

    const roots = provider.getChildren();
    const group = roots[0] as RepoGroup;
    const item = group.children[0];
    expect(item).toBeInstanceOf(PrTreeItem);
  });

  it('groups PRs by repo', () => {
    const provider = new MyPrsTreeProvider();
    provider.updateData(
      [
        makePR({ id: 1, author: 'alice', repo: 'org/repo-a' }),
        makePR({ id: 2, author: 'alice', repo: 'org/repo-b' }),
      ],
      'alice',
      3,
      new Map(),
    );

    const roots = provider.getChildren();
    expect(roots).toHaveLength(2);
  });
});
