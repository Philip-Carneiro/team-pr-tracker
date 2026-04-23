export type PRStatus = 'open' | 'closed' | 'merged';

export type CheckStatus = 'passed' | 'failed' | 'pending' | 'none';

export type ReviewRelation =
  | 'needs_my_review'
  | 'changes_requested_by_me'
  | 'approved_by_me'
  | 'not_involved';

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  url: string;
  author: string;
  repo: string;
  status: PRStatus;
  checkStatus: CheckStatus;
  reviewRelation: ReviewRelation;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
}

export interface PrComment {
  id: number;
  prId: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface TrackerConfig {
  githubUsername: string;
  watchedRepos: string[];
  watchedUsers: string[];
  stalePrDays: number;
  pollingIntervalMinutes: number;
}

export interface CachedState {
  pullRequests: PullRequest[];
  lastRefresh: string | null;
  notifiedPrIds: number[];
  notifiedCommentIds: number[];
  notifiedStalePrIds: number[];
}
