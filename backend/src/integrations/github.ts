export interface GitHubPublishInput {
  owner: string;
  repository: string;
  baseBranch?: string;
  title: string;
  body: string;
}

export interface GitHubPublishResult { branch: string; commitSha: string; pullRequestUrl: string }

export class GitHubIntegrationError extends Error {
  constructor(readonly code: 'not_configured' | 'repository_denied' | 'request_failed' | 'branch_failed' | 'pull_request_failed') {
    super(code);
    this.name = 'GitHubIntegrationError';
  }
}

function safeComponent(value: string) { return encodeURIComponent(value); }

export async function publishProjectPullRequest(
  input: GitHubPublishInput,
  files: Array<{ path: string; content: string }>,
  projectId: string,
  token: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<GitHubPublishResult> {
  if (!token) throw new GitHubIntegrationError('not_configured');
  const baseUrl = `https://api.github.com/repos/${safeComponent(input.owner)}/${safeComponent(input.repository)}`;
  const headers = { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' };
  const request = async <T>(url: string, method = 'GET', body?: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await fetcher(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
    } catch { throw new GitHubIntegrationError('request_failed'); }
    if (!response.ok) throw new GitHubIntegrationError('request_failed');
    return await response.json() as T;
  };

  const repository = await request<{ default_branch?: string; permissions?: { push?: boolean } }>(baseUrl);
  if (repository.permissions?.push !== true) throw new GitHubIntegrationError('repository_denied');
  const baseBranch = input.baseBranch || repository.default_branch;
  if (!baseBranch) throw new GitHubIntegrationError('request_failed');
  const baseRef = await request<{ object?: { sha?: string } }>(`${baseUrl}/git/ref/${safeComponent(`heads/${baseBranch}`)}`);
  const baseCommitSha = baseRef.object?.sha;
  if (!baseCommitSha) throw new GitHubIntegrationError('request_failed');
  const baseCommit = await request<{ tree?: { sha?: string } }>(`${baseUrl}/git/commits/${safeComponent(baseCommitSha)}`);
  const baseTreeSha = baseCommit.tree?.sha;
  if (!baseTreeSha) throw new GitHubIntegrationError('request_failed');

  const branch = `dguy/${projectId.slice(0, 12)}-${crypto.randomUUID().slice(0, 8)}`;
  try {
    const tree = await request<{ sha: string }>(`${baseUrl}/git/trees`, 'POST', {
      base_tree: baseTreeSha,
      tree: files.map((file) => ({ path: file.path, mode: '100644', type: 'blob', content: file.content })),
    });
    const commit = await request<{ sha: string }>(`${baseUrl}/git/commits`, 'POST', {
      message: input.title,
      tree: tree.sha,
      parents: [baseCommitSha],
    });
    await request(`${baseUrl}/git/refs`, 'POST', { ref: `refs/heads/${branch}`, sha: commit.sha });
    try {
      const pullRequest = await request<{ html_url: string }>(`${baseUrl}/pulls`, 'POST', {
        title: input.title,
        body: input.body,
        head: branch,
        base: baseBranch,
      });
      return { branch, commitSha: commit.sha, pullRequestUrl: pullRequest.html_url };
    } catch {
      // Remove the generated branch if GitHub rejected PR creation so the action has no partial branch side effect.
      try { await fetcher(`${baseUrl}/git/refs/heads/${safeComponent(branch)}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(20_000) }); } catch { /* the primary error remains authoritative */ }
      throw new GitHubIntegrationError('pull_request_failed');
    }
  } catch (error) {
    if (error instanceof GitHubIntegrationError && error.code === 'pull_request_failed') throw error;
    throw new GitHubIntegrationError('branch_failed');
  }
}
