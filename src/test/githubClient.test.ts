import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAllPRs, fetchPRComments, normalizeUsername, RateLimitError, RequestCache } from '../githubClient.js';

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

  it('uses RequestCache to avoid duplicate requests', async () => {
    setupMockForSinglePR(sampleGitHubPR, 'success');
    const cache = new RequestCache();

    const prs = await fetchAllPRs(['org/repo'], ['alice'], 'token', 'bob', cache);
    expect(prs).toHaveLength(1);

    const callCount = mockFetch.mock.calls.length;

    const prs2 = await fetchAllPRs(['org/repo'], ['alice'], 'token', 'bob', cache);
    expect(prs2).toHaveLength(1);

    // The search/issues call is NOT cached (uses raw fetch), but enrichment calls should be cached
    // The second fetchAllPRs call will make a new search call, but cached enrichment calls
    // won't hit fetch again. So total calls should be less than 2x the original.
    expect(mockFetch.mock.calls.length).toBeLessThan(callCount * 2);

    cache.clear();
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

  it('uses RequestCache to deduplicate comment fetches', async () => {
    const issueComments = [
      { id: 1, user: { login: 'bob' }, body: 'LGTM', created_at: '2026-04-02T10:00:00Z' },
    ];
    const reviewComments = [
      { id: 2, user: { login: 'carol' }, body: 'Fix', created_at: '2026-04-01T10:00:00Z' },
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

    const cache = new RequestCache();

    const comments1 = await fetchPRComments('org/repo', 42, 'token', cache);
    expect(comments1).toHaveLength(2);
    const callsAfterFirst = mockFetch.mock.calls.length;

    const comments2 = await fetchPRComments('org/repo', 42, 'token', cache);
    expect(comments2).toHaveLength(2);

    // Second call should not make any new fetch requests (URLs are cached)
    expect(mockFetch.mock.calls.length).toBe(callsAfterFirst);

    cache.clear();
  });
});

describe('normalizeUsername', () => {
  it('removes @ prefix from username', () => {
    expect(normalizeUsername('@alice')).toBe('alice');
    expect(normalizeUsername('@Philip-Carneiro')).toBe('Philip-Carneiro');
  });

  it('keeps username without @ unchanged', () => {
    expect(normalizeUsername('alice')).toBe('alice');
    expect(normalizeUsername('Philip-Carneiro')).toBe('Philip-Carneiro');
  });

  it('trims whitespace', () => {
    expect(normalizeUsername('  alice  ')).toBe('alice');
    expect(normalizeUsername('  @alice  ')).toBe('alice');
  });

  it('handles empty string', () => {
    expect(normalizeUsername('')).toBe('');
    expect(normalizeUsername('   ')).toBe('');
  });
});

describe('RequestCache', () => {
  it('returns cached result for same URL', async () => {
    const cache = new RequestCache();
    let fetchCount = 0;

    mockFetch.mockImplementation(() => {
      fetchCount++;
      return Promise.resolve(makeJsonResponse({ data: 'test' }));
    });

    const headers = { Accept: 'application/json' };
    const result1 = await cache.fetchJsonCached('https://api.example.com/test', headers);
    const result2 = await cache.fetchJsonCached('https://api.example.com/test', headers);

    expect(result1).toEqual({ data: 'test' });
    expect(result2).toEqual({ data: 'test' });
    expect(fetchCount).toBe(1);
  });

  it('makes separate requests for different URLs', async () => {
    const cache = new RequestCache();
    let fetchCount = 0;

    mockFetch.mockImplementation((url: string) => {
      fetchCount++;
      return Promise.resolve(makeJsonResponse({ url }));
    });

    const headers = { Accept: 'application/json' };
    await cache.fetchJsonCached('https://api.example.com/a', headers);
    await cache.fetchJsonCached('https://api.example.com/b', headers);

    expect(fetchCount).toBe(2);
  });

  it('clears cache correctly', async () => {
    const cache = new RequestCache();
    let fetchCount = 0;

    mockFetch.mockImplementation(() => {
      fetchCount++;
      return Promise.resolve(makeJsonResponse({ data: 'test' }));
    });

    const headers = { Accept: 'application/json' };
    await cache.fetchJsonCached('https://api.example.com/test', headers);
    expect(fetchCount).toBe(1);

    cache.clear();

    await cache.fetchJsonCached('https://api.example.com/test', headers);
    expect(fetchCount).toBe(2);
  });

  it('handles concurrent requests to the same URL', async () => {
    const cache = new RequestCache();
    let fetchCount = 0;

    mockFetch.mockImplementation(() => {
      fetchCount++;
      return new Promise((resolve) =>
        setTimeout(() => resolve(makeJsonResponse({ data: 'concurrent' })), 10),
      );
    });

    const headers = { Accept: 'application/json' };
    const [r1, r2, r3] = await Promise.all([
      cache.fetchJsonCached('https://api.example.com/same', headers),
      cache.fetchJsonCached('https://api.example.com/same', headers),
      cache.fetchJsonCached('https://api.example.com/same', headers),
    ]);

    expect(r1).toEqual({ data: 'concurrent' });
    expect(r2).toEqual({ data: 'concurrent' });
    expect(r3).toEqual({ data: 'concurrent' });
    expect(fetchCount).toBe(1);
  });
});
