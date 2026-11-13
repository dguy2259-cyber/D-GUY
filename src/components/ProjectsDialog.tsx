import { useState } from 'react';
import { Check, FolderPlus, Pencil, Trash2, X } from 'lucide-react';
import { Modal } from '@/components/Modal';
import type { WorkspaceProject } from '@/types/project';

interface ProjectsDialogProps {
  projects: WorkspaceProject[];
  activeProjectId: string;
  onSelect: (projectId: string) => void;
  onNewProject: () => void;
  onRename: (projectId: string, name: string) => Promise<void>;
  onDelete: (projectId: string) => Promise<void>;
  onClose: () => void;
}

export function ProjectsDialog({ projects, activeProjectId, onSelect, onNewProject, onRename, onDelete, onClose }: ProjectsDialogProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal title="Projects" description={`${projects.length} project${projects.length === 1 ? '' : 's'} · Recent activity`} onClose={onClose}>
      {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <ul className="space-y-2">
        {projects.map((project) => {
          const active = project.id === activeProjectId;
          return <li key={project.id}>
            <div className={`rounded-2xl px-3 py-3 transition ${active ? 'shadow-clay-inset bg-cream' : 'bg-porcelain shadow-clay'}`}>
              {editingId === project.id ? <form className="flex gap-2" onSubmit={(event) => {
                event.preventDefault(); setError('');
                void onRename(project.id, draftName).then(() => setEditingId(null)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not rename project.'));
              }}>
                <input autoFocus aria-label="Project name" value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={120} required className="min-w-0 flex-1 rounded-lg border border-cream bg-white px-2 py-1 text-sm" />
                <button type="submit" aria-label="Save project name" className="text-terracotta-deep"><Check size={17} /></button>
                <button type="button" aria-label="Cancel rename" onClick={() => setEditingId(null)} className="text-stone"><X size={17} /></button>
              </form> : <div className="flex items-center gap-2">
                <button type="button" onClick={() => { onSelect(project.id); onClose(); }} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-semibold">{project.name}</span>
                  <span className="block text-xs text-stone">{project.versions.length} {project.versions.length === 1 ? 'version' : 'versions'} · {project.messages.length} messages</span>
                  <span className="mt-1 block text-[10px] text-muted">Created {new Date(project.createdAt).toLocaleDateString()} · Updated {new Date(project.updatedAt ?? project.createdAt).toLocaleDateString()}</span>
                </button>
                <button type="button" aria-label={`Rename ${project.name}`} onClick={() => { setError(''); setDraftName(project.name); setEditingId(project.id); }} className="rounded-lg p-2 text-stone hover:bg-white"><Pencil size={15} /></button>
                <button type="button" aria-label={`Delete ${project.name}`} onClick={() => {
                  if (window.confirm(`Delete “${project.name}” and its saved versions?`)) void onDelete(project.id).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not delete project.'));
                }} className="rounded-lg p-2 text-stone hover:bg-red-50 hover:text-red-800"><Trash2 size={15} /></button>
              </div>}
            </div>
          </li>;
        })}
      </ul>
      <button type="button" onClick={() => { onNewProject(); onClose(); }} className="clay-button mt-5 w-full py-3 text-sm">
        <FolderPlus size={16} />
        Start a new project
      </button>
    </Modal>
  );
}
