// Bitbucket API Response Types
export interface BitbucketPullRequestsResponse {
  values: PullRequestData[];
  size: number;
  limit: number;
  start: number;
  isLastPage: boolean;
  nextPageStart: number | null;
}

export interface BitbucketCommentsResponse {
  values: CommentData[];
  size: number;
  limit: number;
  start: number;
  isLastPage: boolean;
  nextPageStart: number | null;
}

// Pull Request Data Types
export interface PullRequestData {
  id: number;
  version: number;
  title: string;
  description: string;
  state: string;
  status: string;
  open: boolean;
  closed: boolean;
  createdDate: number;
  updatedDate: number;
  date: string;
  pr_id: number;
  branchName: string;
  numberOfComments: number;
  repositoryURL: string;
  fromRef: {
    id: string;
    displayId: string;
    latestCommit: string;
    repository: {
      id: number;
      name: string;
      slug: string;
      project: {
        key: string;
        name: string;
      };
    };
  };
  toRef: {
    id: string;
    displayId: string;
    latestCommit: string;
    repository: {
      id: number;
      name: string;
      slug: string;
      project: {
        key: string;
        name: string;
      };
    };
  };
  locked: boolean;
  author: {
    user: {
      name: string;
      emailAddress: string;
      id: number;
      displayName: string;
      active: boolean;
      slug: string;
      type: string;
      links: {
        self: Array<{ href: string }>;
      };
    };
    role: string;
    approved: boolean;
    status: string;
  };
  reviewers: Array<{
    user: {
      name: string;
      emailAddress: string;
      id: number;
      displayName: string;
      active: boolean;
      slug: string;
      type: string;
      links: {
        self: Array<{ href: string }>;
      };
    };
    role: string;
    approved: boolean;
    status: string;
  }>;
  participants: Array<{
    user: {
      name: string;
      emailAddress: string;
      id: number;
      displayName: string;
      active: boolean;
      slug: string;
      type: string;
      links: {
        self: Array<{ href: string }>;
      };
    };
    role: string;
    approved: boolean;
    status: string;
  }>;
  links: {
    self: Array<{ href: string }>;
  };
  properties?: {
    commentCount?: number;
    openTaskCount?: number;
    resolvedTaskCount?: number;
    mergeResult?: {
      outcome: string;
      current: boolean;
    };
  };
}

export interface PullRequestDataWithRepo {
  pr_id: number;
  branchName: string;
  sourceBranchName: string;
  destinationBranchName: string;
  date: string;
  numberOfComments: number;
  repositoryURL: string;
  prUrl: string;
  status: string;
  projectKey: string;
  repositorySlug: string;
}

export interface PullRequestDataPartial {
  pr_id: number;
  branchName: string;
  sourceBranchName: string;
  destinationBranchName: string;
  date: string;
  numberOfComments: number;
  repositoryURL: string;
  status: string;
}

// Comment Data Types
export interface CommentData {
  id: number;
  version: number;
  text: string;
  author: {
    user: {
      name: string;
      emailAddress: string;
      id: number;
      displayName: string;
      active: boolean;
      slug: string;
      type: string;
      links: {
        self: Array<{ href: string }>;
      };
    };
    role: string;
    approved: boolean;
    status: string;
  };
  createdDate: number;
  updatedDate: number;
  comments: CommentData[];
  permalink: string;
  severity: string;
  state: string;
  fixed: boolean;
  properties: {
    repositoryId: number;
  };
}

// Configuration Types
export interface BitbucketConfig {
  username: string;
  password: string;
  baseUrl: string;
  token?: string;
  projectKey?: string;
  repositorySlug?: string;
}

export interface RepositoryConfig {
  projectKey: string;
  repositorySlug: string;
  name?: string;
  displayName?: string;
}

export interface MultiBitbucketConfig {
  repositories: RepositoryConfig[];
  username: string;
  password: string;
  baseUrl: string;
  token?: string;
}

// Error Types
export interface BitbucketError {
  errors: Array<{
    context?: string;
    message?: string;
    exceptionName?: string;
  }>;
}

export interface BitbucketDuplicatePRError {
  errors: Array<{
    existingPullRequest: PullRequestData;
  }>;
}

// Statistics Types
export interface PullRequestStats {
  total: number;
  byStatus: Record<string, number>;
  byProject: Record<string, number>;
  byRepository: Record<string, number>;
  totalComments: number;
  averageCommentsPerPR: number;
}

export interface RepositoryStats {
  projectKey: string;
  repoName: string;
  count: number;
}
