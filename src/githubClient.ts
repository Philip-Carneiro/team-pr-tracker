import type {
  CheckStatus,
  PRStatus,
  PrComment,
  PullRequest,
  ReviewRelation,
} from './types.js';

interface GitHubPR {
  id: number;
  number: number;
  title: string;
  html_url: string;
  user: { login: string } | null;
  state: string;
  pull_request?: { merged_at: string | null };
  created_at: string;
  updated_at: string;
  comments: number;
}

interface GitHubCombinedStatus {
  state: 'success' | 'failure' | 'pending' | 'error';
}

interface GitHubReview {
  user: { login: string } | null;
  state: string;
  submitted_at?: string;
}

interface GitHubRequestedReviewers {
  users: { login: string }[];
}

interface GitHubIssueComment {
  id: number;
  user: { login: string } | null;
  body: string;
  created_at: string;
}

interface GitHubReviewComment {
  id: number;
  user: { login: string } | null;
  body: string;
  created_at: string;
}

interface GitHubCommit {
  sha: string;
  commit: {
    author: { date: string } | null;
    committer: { date: string } | null;
  };
  author: { login: string } | null;
}

export class RequestCache {
  private cache = new Map<string, Promise<unknown>>();

  fetchJsonCached<T>(url: string, headers: Record<string, string>): Promise<T | null> {
    const existing = this.cache.get(url);
    if (existing) {
      return existing as Promise<T | null>;
    }
    const promise = fetchJson<T>(url, headers);
    this.cache.set(url, promise as Promise<unknown>);
    return promise;
  }

  clear(): void {
    this.cache.clear();
  }
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    // GitHub API uses 'token' prefix for Personal Access Tokens, not 'Bearer'
    headers['Authorization'] = `token ${token}`;
  }
  return headers;
}

function resolvePRStatus(item: GitHubPR): PRStatus {
  if (item.pull_request?.merged_at) return 'merged';
  if (item.state === 'closed') return 'closed';
  return 'open';
}

function mapCheckState(state: string): CheckStatus {
  switch (state) {
    case 'success':
      return 'passed';
    case 'failure':
    case 'error':
      return 'failed';
    case 'pending':
      return 'pending';
    default:
      return 'none';
  }
}

async function fetchJson<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        throw new RateLimitError();
      }
      return null;
    }
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    return null;
  }
}

function fetchWithCache<T>(
  url: string,
  headers: Record<string, string>,
  cache?: RequestCache,
): Promise<T | null> {
  if (cache) {
    return cache.fetchJsonCached<T>(url, headers);
  }
  return fetchJson<T>(url, headers);
}

export class RateLimitError extends Error {
  constructor() {
    super('GitHub API rate limit exceeded. Try again later or set a GitHub token.');
    this.name = 'RateLimitError';
  }
}

/**
 * Normalizes a GitHub repository URL or path to owner/repo format
 * Examples:
 * - "https://github.com/owner/repo" -> "owner/repo"
 * - "https://github.com/owner/repo/" -> "owner/repo"
 * - "owner/repo" -> "owner/repo"
 */
function normalizeRepoUrl(repoInput: string): string {
  const trimmed = repoInput.trim().replace(/\/+$/, ''); // Remove trailing slashes

  // If it's a GitHub URL, extract owner/repo
  const urlMatch = trimmed.match(/github\.com[/:]([\w-]+\/[\w-]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  // If it's already in owner/repo format
  const directMatch = trimmed.match(/^([\w-]+\/[\w-]+)$/);
  if (directMatch) {
    return directMatch[1];
  }

  throw new Error(`Invalid repository format: ${repoInput}. Use "owner/repo" or "https://github.com/owner/repo"`);
}

/**
 * Normalizes a GitHub username by removing @ prefix if present
 * Examples:
 * - "@username" -> "username"
 * - "username" -> "username"
 * - "@Philip-Carneiro" -> "Philip-Carneiro"
 */
export function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, '');
}

async function fetchCommitStatus(
  repo: string,
  prNumber: number,
  token?: string,
  cache?: RequestCache,
): Promise<CheckStatus> {
  const headers = buildHeaders(token);

  const prData = await fetchWithCache<{ head?: { sha: string } }>(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
    headers,
    cache,
  );
  if (!prData?.head?.sha) return 'none';

  const statusData = await fetchWithCache<GitHubCombinedStatus>(
    `https://api.github.com/repos/${repo}/commits/${prData.head.sha}/status`,
    headers,
    cache,
  );
  if (!statusData) return 'none';

  return mapCheckState(statusData.state);
}

async function fetchReviewRelation(
  repo: string,
  prNumber: number,
  myUsername: string,
  token?: string,
  cache?: RequestCache,
): Promise<ReviewRelation> {
  const headers = buildHeaders(token);

  const reviewersData = await fetchWithCache<GitHubRequestedReviewers>(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}/requested_reviewers`,
    headers,
    cache,
  );

  if (reviewersData?.users?.some((u) => u.login.toLowerCase() === myUsername.toLowerCase())) {
    return 'needs_my_review';
  }

  const reviews = await fetchWithCache<GitHubReview[]>(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews`,
    headers,
    cache,
  );
  if (!reviews) return 'not_involved';

  const myReviews = reviews.filter(
    (r) => r.user?.login.toLowerCase() === myUsername.toLowerCase(),
  );
  if (myReviews.length === 0) return 'not_involved';

  const latestReview = myReviews[myReviews.length - 1];
  if (latestReview.state === 'CHANGES_REQUESTED') return 'changes_requested_by_me';
  if (latestReview.state === 'APPROVED') return 'approved_by_me';

  return 'not_involved';
}

export async function fetchPRsForRepo(
  repo: string,
  authors: string[],
  token?: string,
  myUsername?: string,
  cache?: RequestCache,
): Promise<PullRequest[]> {
  const normalizedRepo = normalizeRepoUrl(repo);
  const normalizedMyUsername = myUsername ? normalizeUsername(myUsername) : undefined;
  const allPRs: PullRequest[] = [];
  const headers = buildHeaders(token);

  for (const author of authors) {
    const normalizedAuthor = normalizeUsername(author);
    const url =
      `https://api.github.com/search/issues?q=` +
      encodeURIComponent(`repo:${normalizedRepo} type:pr author:${normalizedAuthor} is:open`) +
      `&per_page=100&sort=created&order=desc`;

    const response = await fetch(url, { headers });

    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        throw new RateLimitError();
      }
      throw new Error(`Failed to fetch PRs for ${normalizedRepo}: ${response.status}`);
    }

    const data = (await response.json()) as { items?: GitHubPR[] };
    const items: GitHubPR[] = data.items ?? [];

    const basePRs = items.map((item) => ({
      id: item.id,
      number: item.number,
      title: item.title,
      url: item.html_url,
      author: item.user?.login ?? 'unknown',
      repo: normalizedRepo,
      status: resolvePRStatus(item),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      commentCount: item.comments ?? 0,
    }));

    const enriched = await Promise.all(
      basePRs.map(async (pr) => {
        const [checkStatus, reviewRelation] = await Promise.all([
          fetchCommitStatus(normalizedRepo, pr.number, token, cache).catch(() => 'none' as CheckStatus),
          normalizedMyUsername && pr.status === 'open'
            ? fetchReviewRelation(normalizedRepo, pr.number, normalizedMyUsername, token, cache).catch(
                () => 'not_involved' as ReviewRelation,
              )
            : Promise.resolve('not_involved' as ReviewRelation),
        ]);

        return { ...pr, checkStatus, reviewRelation };
      }),
    );

    allPRs.push(...enriched);
  }

  return allPRs;
}

export async function fetchAllPRs(
  repos: string[],
  authors: string[],
  token?: string,
  myUsername?: string,
  cache?: RequestCache,
): Promise<PullRequest[]> {
  const results = await Promise.allSettled(
    repos.map((repo) => fetchPRsForRepo(repo, authors, token, myUsername, cache)),
  );

  const allPRs: PullRequest[] = [];
  const errors: string[] = [];
  let hasRateLimitError = false;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      allPRs.push(...result.value);
    } else {
      const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`${repos[index]}: ${errorMsg}`);

      if (result.reason instanceof RateLimitError) {
        hasRateLimitError = true;
      }
    }
  });

  // Only throw if ALL repos failed
  if (errors.length > 0 && allPRs.length === 0) {
    if (hasRateLimitError) {
      throw new RateLimitError();
    }
    throw new Error(`All fetches failed:\n${errors.join('\n')}`);
  }

  // If we have partial success with rate limit errors, log but don't throw
  if (errors.length > 0) {
    console.warn(`Partial fetch failure (${errors.length}/${repos.length} repos failed):`, errors);
  }

  return allPRs;
}

export async function fetchPRComments(
  repo: string,
  prNumber: number,
  token?: string,
  cache?: RequestCache,
): Promise<PrComment[]> {
  const headers = buildHeaders(token);

  const [issueComments, reviewComments] = await Promise.all([
    fetchWithCache<GitHubIssueComment[]>(
      `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`,
      headers,
      cache,
    ),
    fetchWithCache<GitHubReviewComment[]>(
      `https://api.github.com/repos/${repo}/pulls/${prNumber}/comments?per_page=100`,
      headers,
      cache,
    ),
  ]);

  const comments: PrComment[] = [];

  if (issueComments) {
    comments.push(
      ...issueComments.map((c) => ({
        id: c.id,
        prId: prNumber,
        author: c.user?.login ?? 'unknown',
        body: c.body,
        createdAt: c.created_at,
      })),
    );
  }

  if (reviewComments) {
    comments.push(
      ...reviewComments.map((c) => ({
        id: c.id,
        prId: prNumber,
        author: c.user?.login ?? 'unknown',
        body: c.body,
        createdAt: c.created_at,
      })),
    );
  }

  return comments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/**
 * Fetches the date of the last commit by a specific author on a PR.
 * Returns null if no commits by the author are found or if the fetch fails.
 */
export async function fetchAuthorLastCommitDate(
  repo: string,
  prNumber: number,
  authorUsername: string,
  token?: string,
  cache?: RequestCache,
): Promise<string | null> {
  const normalizedAuthor = normalizeUsername(authorUsername);
  const headers = buildHeaders(token);

  const commits = await fetchWithCache<GitHubCommit[]>(
    `https://api.github.com/repos/${repo}/pulls/${prNumber}/commits?per_page=100`,
    headers,
    cache,
  );

  if (!commits || commits.length === 0) return null;

  const authorCommits = commits.filter(
    (c) => c.author?.login.toLowerCase() === normalizedAuthor.toLowerCase(),
  );

  if (authorCommits.length === 0) return null;

  const lastCommit = authorCommits[authorCommits.length - 1];
  return lastCommit.commit.committer?.date ?? lastCommit.commit.author?.date ?? null;
}

/**
 * Fetches the latest review or comment activity on a PR from users other than the author.
 * Returns the most recent date of any review or comment by other users, or null if none found.
 */
export async function fetchLatestExternalActivity(
  repo: string,
  prNumber: number,
  authorUsername: string,
  token?: string,
  cache?: RequestCache,
): Promise<{ date: string; hasChangesRequested: boolean } | null> {
  const normalizedAuthor = normalizeUsername(authorUsername);
  const headers = buildHeaders(token);

  const [issueComments, reviewComments, reviews] = await Promise.all([
    fetchWithCache<GitHubIssueComment[]>(
      `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`,
      headers,
      cache,
    ),
    fetchWithCache<GitHubReviewComment[]>(
      `https://api.github.com/repos/${repo}/pulls/${prNumber}/comments?per_page=100`,
      headers,
      cache,
    ),
    fetchWithCache<GitHubReview[]>(
      `https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews`,
      headers,
      cache,
    ),
  ]);

  const authorLower = normalizedAuthor.toLowerCase();
  let latestDate: string | null = null;
  let hasChangesRequested = false;

  const updateLatest = (date: string): void => {
    if (!latestDate || new Date(date).getTime() > new Date(latestDate).getTime()) {
      latestDate = date;
    }
  };

  if (issueComments) {
    for (const c of issueComments) {
      if (c.user?.login.toLowerCase() !== authorLower) {
        updateLatest(c.created_at);
      }
    }
  }

  if (reviewComments) {
    for (const c of reviewComments) {
      if (c.user?.login.toLowerCase() !== authorLower) {
        updateLatest(c.created_at);
      }
    }
  }

  if (reviews) {
    for (const r of reviews) {
      if (r.user?.login.toLowerCase() !== authorLower && r.submitted_at) {
        updateLatest(r.submitted_at);
        if (r.state === 'CHANGES_REQUESTED') {
          hasChangesRequested = true;
        }
      }
    }
  }

  if (!latestDate) return null;

  return { date: latestDate, hasChangesRequested };
}
