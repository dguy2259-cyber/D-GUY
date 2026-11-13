import { describe, expect, it, vi } from 'vitest';
import { GitHubIntegrationError, publishProjectPullRequest } from './github.js';

const input = { owner: 'amora', repository: 'dguy-sites', baseBranch: 'main', title: 'Add cyber portfolio', body: 'Generated with D-GUY.' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('GitHub branch, commit and PR integration', () => {
  it('creates a branch from the base commit, commits validated project files and opens a PR', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ default_branch: 'main', permissions: { push: true } }))
      .mockResolvedValueOnce(json({ object: { sha: 'base-sha' } }))
      .mockResolvedValueOnce(json({ tree: { sha: 'base-tree-sha' } }))
      .mockResolvedValueOnce(json({ sha: 'tree-sha' }))
      .mockResolvedValueOnce(json({ sha: 'commit-sha' }))
      .mockResolvedValueOnce(json({ ref: 'refs/heads/dguy/test' }, 201))
      .mockResolvedValueOnce(json({ html_url: 'https://github.com/amora/dguy-sites/pull/17' }, 201));
    const result = await publishProjectPullRequest(input, [{ path: 'index.html', content: '<main>Portfolio</main>' }], 'project-test-id', 'server-secret-token', fetcher as typeof fetch);
    expect(result).toMatchObject({ commitSha: 'commit-sha', pullRequestUrl: 'https://github.com/amora/dguy-sites/pull/17' });
    expect(fetcher).toHaveBeenCalledTimes(7);
    const treeBody = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body));
    expect(treeBody.tree).toEqual([{ path: 'index.html', mode: '100644', type: 'blob', content: '<main>Portfolio</main>' }]);
    expect(treeBody.base_tree).toBe('base-tree-sha');
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer server-secret-token');
  });

  it('requires a configured token and a repository where the token can push', async () => {
    await expect(publishProjectPullRequest(input, [], 'p1', undefined)).rejects.toMatchObject({ code: 'not_configured' });
    const fetcher = vi.fn().mockResolvedValueOnce(json({ default_branch: 'main', permissions: { push: false } }));
    await expect(publishProjectPullRequest(input, [], 'p1', 'token', fetcher as typeof fetch)).rejects.toMatchObject({ code: 'repository_denied' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('removes its generated branch if GitHub refuses to create the PR', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ default_branch: 'main', permissions: { push: true } }))
      .mockResolvedValueOnce(json({ object: { sha: 'base-sha' } }))
      .mockResolvedValueOnce(json({ tree: { sha: 'base-tree-sha' } }))
      .mockResolvedValueOnce(json({ sha: 'tree-sha' }))
      .mockResolvedValueOnce(json({ sha: 'commit-sha' }))
      .mockResolvedValueOnce(json({ ref: 'created' }, 201))
      .mockResolvedValueOnce(json({ message: 'private detail' }, 422))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(publishProjectPullRequest(input, [{ path: 'index.html', content: 'x' }], 'project', 'token', fetcher as typeof fetch)).rejects.toBeInstanceOf(GitHubIntegrationError);
    expect(fetcher.mock.calls[7]?.[1]?.method).toBe('DELETE');
  });
});
