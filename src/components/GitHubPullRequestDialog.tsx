import { useState } from 'react';
import { GitPullRequest, LoaderCircle } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { backendApi } from '@/services/backendApi';
import type { WorkspaceProject } from '@/types/project';

interface GitHubPullRequestDialogProps {
  project: WorkspaceProject;
  onClose: () => void;
}

export function GitHubPullRequestDialog({ project, onClose }: GitHubPullRequestDialogProps) {
  const activeVersion = project.versions.find((version) => version.id === project.activeVersionId);
  const [owner, setOwner] = useState('');
  const [repository, setRepository] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [title, setTitle] = useState(project.name.slice(0, 120));
  const [body, setBody] = useState(activeVersion ? `D-GUY version ${activeVersion.number}: ${activeVersion.summary}`.slice(0, 5000) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ branch: string; commitSha: string; pullRequestUrl: string } | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await backendApi.createPullRequest(project.id, { owner, repository, baseBranch, title, body });
      setResult(response.pullRequest);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'GitHub could not create the pull request.'); }
    finally { setBusy(false); }
  };

  return <Modal title="Create a GitHub pull request" description="D-GUY will publish this saved project version to a new branch and open a pull request." onClose={onClose}>
    {result ? <div className="space-y-3 rounded-2xl bg-green-50 p-4 text-sm text-green-900">
      <p className="font-semibold">Branch and commit created.</p>
      <p className="break-all">{result.branch} · {result.commitSha.slice(0, 12)}</p>
      <a className="font-semibold underline" href={result.pullRequestUrl} target="_blank" rel="noreferrer">Open pull request</a>
    </div> : <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      {!activeVersion && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">Generate and save a version before publishing.</p>}
      <label className="block text-sm font-medium">GitHub owner<input required maxLength={39} pattern="[A-Za-z0-9-]+" autoComplete="off" value={owner} onChange={(event) => setOwner(event.target.value)} className="mt-1 w-full rounded-xl border border-cream bg-white px-3 py-2" placeholder="organization-or-user" /></label>
      <label className="block text-sm font-medium">Repository<input required maxLength={100} pattern="[A-Za-z0-9_.-]+" autoComplete="off" value={repository} onChange={(event) => setRepository(event.target.value)} className="mt-1 w-full rounded-xl border border-cream bg-white px-3 py-2" placeholder="website-repository" /></label>
      <label className="block text-sm font-medium">Base branch<input required maxLength={100} pattern="[A-Za-z0-9._/-]+" value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} className="mt-1 w-full rounded-xl border border-cream bg-white px-3 py-2" /></label>
      <label className="block text-sm font-medium">Pull request title<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-xl border border-cream bg-white px-3 py-2" /></label>
      <label className="block text-sm font-medium">Description<textarea maxLength={5000} rows={4} value={body} onChange={(event) => setBody(event.target.value)} className="mt-1 w-full rounded-xl border border-cream bg-white px-3 py-2" /></label>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <button disabled={!activeVersion || busy} className="clay-button flex w-full items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-50"><GitPullRequest size={16} />{busy && <LoaderCircle size={16} className="animate-spin" />}{busy ? 'Publishing…' : 'Create branch and pull request'}</button>
    </form>}
  </Modal>;
}
