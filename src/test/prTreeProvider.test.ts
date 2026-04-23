import { describe, it, expect, vi, afterEach } from 'vitest';
import { PrTreeProvider, RepoGroup, PrTreeItem } from '../prTreeProvider.js';
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

describe('PrTreeProvider', () => {
  describe('author filter', () => {
    it('shows all PRs when no filter is set', () => {
      const provider = new PrTreeProvider();
      provider.updateData(
        [
          makePR({ id: 1, author: 'alice' }),
          makePR({ id: 2, author: 'bob' }),
        ],
        3,
        null,
      );

      const roots = provider.getChildren();
      expect(roots).toHaveLength(1);
      const group = roots[0] as RepoGroup;
      expect(group.children).toHaveLength(2);
    });

    it('filters PRs by selected author', () => {
      const provider = new PrTreeProvider();
      provider.updateData(
        [
          makePR({ id: 1, author: 'alice' }),
          makePR({ id: 2, author: 'bob' }),
          makePR({ id: 3, author: 'alice' }),
        ],
        3,
        null,
      );

      provider.setAuthorFilter(['alice']);

      const roots = provider.getChildren();
      expect(roots).toHaveLength(1);
      const group = roots[0] as RepoGroup;
      expect(group.children).toHaveLength(2);
      expect(group.children.every((item) => (item as PrTreeItem).pr.author === 'alice')).toBe(true);
    });

    it('filters by multiple authors', () => {
      const provider = new PrTreeProvider();
      provider.updateData(
        [
          makePR({ id: 1, author: 'alice' }),
          makePR({ id: 2, author: 'bob' }),
          makePR({ id: 3, author: 'carol' }),
        ],
        3,
        null,
      );

      provider.setAuthorFilter(['alice', 'carol']);

      const roots = provider.getChildren();
      const group = roots[0] as RepoGroup;
      expect(group.children).toHaveLength(2);
      const authors = group.children.map((item) => (item as PrTreeItem).pr.author);
      expect(authors).toContain('alice');
      expect(authors).toContain('carol');
      expect(authors).not.toContain('bob');
    });

    it('is case-insensitive', () => {
      const provider = new PrTreeProvider();
      provider.updateData([makePR({ id: 1, author: 'Alice' })], 3, null);

      provider.setAuthorFilter(['alice']);

      const roots = provider.getChildren();
      expect(roots).toHaveLength(1);
    });

    it('returns empty when filter matches no authors', () => {
      const provider = new PrTreeProvider();
      provider.updateData([makePR({ id: 1, author: 'alice' })], 3, null);

      provider.setAuthorFilter(['unknown-user']);

      const roots = provider.getChildren();
      expect(roots).toHaveLength(0);
    });

    it('clears filter when set to empty array', () => {
      const provider = new PrTreeProvider();
      provider.updateData(
        [
          makePR({ id: 1, author: 'alice' }),
          makePR({ id: 2, author: 'bob' }),
        ],
        3,
        null,
      );

      provider.setAuthorFilter(['alice']);
      expect(provider.getChildren()).toHaveLength(1);
      const filteredGroup = provider.getChildren()[0] as RepoGroup;
      expect(filteredGroup.children).toHaveLength(1);

      provider.setAuthorFilter([]);
      const roots = provider.getChildren();
      const group = roots[0] as RepoGroup;
      expect(group.children).toHaveLength(2);
    });
  });

  describe('getAvailableAuthors', () => {
    it('returns sorted unique authors', () => {
      const provider = new PrTreeProvider();
      provider.updateData(
        [
          makePR({ id: 1, author: 'carol' }),
          makePR({ id: 2, author: 'alice' }),
          makePR({ id: 3, author: 'bob' }),
          makePR({ id: 4, author: 'alice' }),
        ],
        3,
        null,
      );

      const authors = provider.getAvailableAuthors();
      expect(authors).toEqual(['alice', 'bob', 'carol']);
    });

    it('returns empty array when no PRs loaded', () => {
      const provider = new PrTreeProvider();
      expect(provider.getAvailableAuthors()).toEqual([]);
    });
  });

  describe('getAuthorFilter', () => {
    it('returns current filter', () => {
      const provider = new PrTreeProvider();
      expect(provider.getAuthorFilter()).toEqual([]);

      provider.setAuthorFilter(['alice', 'bob']);
      expect(provider.getAuthorFilter()).toEqual(['alice', 'bob']);
    });
  });

  describe('grouping by repo', () => {
    it('groups PRs by repo with correct counts', () => {
      const provider = new PrTreeProvider();
      provider.updateData(
        [
          makePR({ id: 1, repo: 'org/repo-a' }),
          makePR({ id: 2, repo: 'org/repo-b' }),
          makePR({ id: 3, repo: 'org/repo-a' }),
        ],
        3,
        null,
      );

      const roots = provider.getChildren();
      expect(roots).toHaveLength(2);

      const repoA = roots.find((r) => (r as RepoGroup).repoName === 'org/repo-a') as RepoGroup;
      const repoB = roots.find((r) => (r as RepoGroup).repoName === 'org/repo-b') as RepoGroup;

      expect(repoA.children).toHaveLength(2);
      expect(repoB.children).toHaveLength(1);
    });

    it('sorts repos alphabetically', () => {
      const provider = new PrTreeProvider();
      provider.updateData(
        [
          makePR({ id: 1, repo: 'org/zebra' }),
          makePR({ id: 2, repo: 'org/alpha' }),
        ],
        3,
        null,
      );

      const roots = provider.getChildren();
      expect((roots[0] as RepoGroup).repoName).toBe('org/alpha');
      expect((roots[1] as RepoGroup).repoName).toBe('org/zebra');
    });
  });
});
