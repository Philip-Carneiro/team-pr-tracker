import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAllPRs, fetchPRComments, RateLimitError } from '../githubClient.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeJsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
  };
}

const sampleGitHubPR = {
  id: 1001,
  number: 42,
  title: 'Fix the thing',
  html_url: 'https://github.com/org/repo/pull/42',
  user: { login: 'alice' },
  state: 'open',
  pull_request: { merged_at: null },
  created_at: '2026-04-01T10:00:00Z',
  updated_at: '2026-04-20T10:00:00Z',
  comments: 5,
};

function setupMockForSinglePR(
  pr: typeof sampleGitHubPR,
  buildState: string,
  requestedReviewers: { login: string }[] = [],
  reviews: { user: { login: string }; state: string }[] = [],
) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/search/issues')) {
      return Promise.resolve(makeJsonResponse({ items: [pr] }));
    }
    if (url.match(/\/pulls\/\d+\/requested_reviewers$/)) {
      return Promise.resolve(makeJsonResponse({ users: requestedReviewers }));
    }
    if (url.match(/\/pulls\/\d+\/reviews$/)) {
      return Promise.resolve(makeJsonResponse(reviews));
    }
    if (url.match(/\/pulls\/\d+$/)) {
      return Promise.resolve(makeJsonResponse({ head: { sha: 'abc123' } }));
    }
    if (url.includes('/commits/') && url.includes('/status')) {
      return Promise.resolve(makeJsonResponse({ state: buildState }));
    }
    return Promise.resolve(makeJsonResponse({}, false, 404));
  });
}

describe('fetchAllPRs', () => {
  it('fetches and enriches PRs for a single repo and author', async () => {
    setupMockForSinglePR(sampleGitHubPR, 'success');

    const prs = await fetchAllPRs(['org/repo'], ['alice'], 'fake-token', 'bob');

    expect(prs).toHaveLength(1);
    expect(prs[0].title).toBe('Fix the thing');
    expect(prs[0].author).toBe('alice');
    expect(prs[0].repo).toBe('org/repo');
    expect(prs[0].status).toBe('open');
    expect(prs[0].checkStatus).toBe('passed');
    expect(prs[0].reviewRelation).toBe('not_involved');
    expect(prs[0].number).toBe(42);
    expect(prs[0].commentCount).toBe(5);
  });

  it('detects merged PRs correctly', async () => {
    const mergedPR = {
      ...sampleGitHubPR,
      state: 'closed',
      pull_request: { merged_at: '2026-04-15T00:00:00Z' },
    };

    setupMockForSinglePR(mergedPR, 'success');

    const prs = await fetchAllPRs(['org/repo'], ['alice'], 'token');
    expect(prs[0].status).toBe('merged');
  });

  it('detects review relation: needs_my_review', async () => {
    setupMockForSinglePR(sampleGitHubPR, 'pending', [{ login: 'bob' }]);

    const prs = await fetchAllPRs(['org/repo'], ['alice'], 'token', 'bob');
    expect(prs[0].reviewRelation).toBe('needs_my_review');
  });

  it('maps failed build status', async () => {
    setupMockForSinglePR(sampleGitHubPR, 'failure');

    const prs = await fetchAllPRs(['org/repo'], ['alice'], 'token', 'bob');
    expect(prs[0].checkStatus).toBe('failed');
  });

  it('throws on rate limit when all repos fail', async () => {
    mockFetch.mockImplementation(() => {
      return Promise.resolve(makeJsonResponse({ message: 'rate limit' }, false, 403));
    });

    await expect(fetchAllPRs(['org/repo'], ['alice'], 'token')).rejects.toThrow();
  });

  it('handles partial failures across repos', async () => {
    let callIndex = 0;
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/search/issues') && url.includes('org%2Fbroken')) {
        return Promise.resolve(makeJsonResponse({}, false, 500));
      }
      if (url.includes('/search/issues')) {
        return Promise.resolve(makeJsonResponse({ items: [sampleGitHubPR] }));
      }
      if (url.match(/\/pulls\/\d+$/)) {
        return Promise.resolve(makeJsonResponse({ head: { sha: 'abc' } }));
      }
      if (url.includes('/status')) {
        return Promise.resolve(makeJsonResponse({ state: 'success' }));
      }
      if (url.includes('/requested_reviewers')) {
        return Promise.resolve(makeJsonResponse({ users: [] }));
      }
      if (url.includes('/reviews')) {
        return Promise.resolve(makeJsonResponse([]));
      }
      return Promise.resolve(makeJsonResponse({}, false, 404));
    });

    const prs = await fetchAllPRs(['org/repo', 'org/broken'], ['alice'], 'token');
    expect(prs).toHaveLength(1);
    expect(prs[0].repo).toBe('org/repo');
  });

  it('returns empty array when no PRs found', async () => {
    mockFetch.mockImplementation(() => {
      return Promise.resolve(makeJsonResponse({ items: [] }));
    });

    const prs = await fetchAllPRs(['org/repo'], ['alice']);
    expect(prs).toHaveLength(0);
  });
});

describe('fetchPRComments', () => {
  it('fetches and merges issue and review comments', async () => {
    const issueComments = [
      { id: 1, user: { login: 'bob' }, body: 'LGTM', created_at: '2026-04-02T10:00:00Z' },
    ];
    const reviewComments = [
      {
        id: 2,
        user: { login: 'carol' },
        body: 'Nit: rename var',
        created_at: '2026-04-01T10:00:00Z',
      },
    ];

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/issues/') && url.includes('/comments')) {
        return Promise.resolve(makeJsonResponse(issueComments));
      }
      if (url.includes('/pulls/') && url.includes('/comments')) {
        return Promise.resolve(makeJsonResponse(reviewComments));
      }
      return Promise.resolve(makeJsonResponse({}, false, 404));
    });

    const comments = await fetchPRComments('org/repo', 42, 'token');
    expect(comments).toHaveLength(2);
    expect(comments[0].author).toBe('carol');
    expect(comments[1].author).toBe('bob');
  });

  it('returns empty when fetch fails', async () => {
    mockFetch.mockImplementation(() => {
      return Promise.resolve(makeJsonResponse({}, false, 404));
    });

    const comments = await fetchPRComments('org/repo', 42, 'token');
    expect(comments).toHaveLength(0);
  });
});
