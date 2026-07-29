interface GitHubUser {
  login: string;
  email?: string;
}

interface GitHubRepository {
  name: string;
  owner: GitHubUser;
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
}

interface GitHubPRReviewCommentPayload {
  action: 'created' | 'edited' | 'deleted';
  comment: {
    body: string;
    user: GitHubUser;
  };
  pull_request: GitHubPullRequest;
  repository: GitHubRepository;
}

export { GitHubUser, GitHubRepository, GitHubPullRequest, GitHubPRReviewCommentPayload };
