import { useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { backendApi } from '@/services/backendApi';
import type { WorkspaceProject } from '@/types/project';

interface DeploymentPreparationDialogProps { project: WorkspaceProject; onClose: () => void }

export function DeploymentPreparationDialog({ project, onClose }: DeploymentPreparationDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const prepare = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(backendApi.deploymentPreparationUrl(project.id), { credentials: 'include' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message || `Deployment files could not be prepared (${response.status}).`);
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blobUrl; link.download = `${project.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'dguy-project'}-deployment-preparation.zip`;
      document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
      setComplete(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Deployment files could not be prepared.'); }
    finally { setBusy(false); }
  };

  return <Modal title="Prepare deployment files" description="Download configuration for Vercel and Render for this saved version. D-GUY will not upload or deploy your project." onClose={onClose}>
    <div className="space-y-3 text-sm text-stone">
      <p>The ZIP contains your project and generated vercel.json, render.yaml, and deployment notes. Review the build and environment settings in your provider dashboard before creating a deployment.</p>
      <p>Provider tokens and private Supabase/Groq/Gemini keys are never added to the website files.</p>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-900">{error}</p>}
      {complete && <p role="status" className="rounded-xl bg-green-50 p-3 text-green-900">Deployment preparation ZIP downloaded.</p>}
      <button type="button" disabled={busy || !project.activeVersionId} onClick={() => void prepare()} className="clay-button flex w-full items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-50">
        {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
        {busy ? 'Preparing…' : complete ? 'Download again' : 'Download deployment preparation ZIP'}
      </button>
    </div>
  </Modal>;
}
