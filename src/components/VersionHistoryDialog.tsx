import { RotateCcw } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { TEMPLATE_LABELS } from '@/services/projectConfig';
import type { SiteVersion, WorkspaceProject } from '@/types/project';

interface VersionHistoryDialogProps {
  project: WorkspaceProject;
  activeVersionId: string | null;
  canRestore: boolean;
  onRestore: (versionId: string) => void;
  onClose: () => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function VersionHistoryDialog({ project, activeVersionId, canRestore, onRestore, onClose }: VersionHistoryDialogProps) {
  const versions = [...project.versions].reverse();

  return (
    <Modal title="Version history" description={`Every draft created for ${project.name}.`} onClose={onClose}>
      {versions.length === 0 ? (
        <p className="rounded-2xl bg-cream p-5 text-center text-sm text-stone shadow-clay-inset">
          No drafts yet. Versions appear here after your first website is generated.
        </p>
      ) : (
        <ol className="space-y-3">
          {versions.map((version: SiteVersion) => {
            const active = version.id === activeVersionId;
            return (
              <li key={version.id} className="clay-raised rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      Version {version.number}
                      {active && <span className="ml-2 rounded-full bg-peach/60 px-2 py-0.5 text-[11px] text-terracotta-deep">Current</span>}
                    </p>
                    <p className="mt-1 text-xs text-stone">
                      {TEMPLATE_LABELS[version.templateId]} · {formatTime(version.createdAt)}
                    </p>
                    <p className="mt-2 line-clamp-2 text-xs text-charcoal">{version.summary}</p>
                  </div>
                  {!active && (
                    <button
                      type="button"
                      onClick={() => {
                        onRestore(version.id);
                        onClose();
                      }}
                      disabled={!canRestore}
                      className="clay-soft-button h-9 shrink-0 !rounded-xl px-3 text-xs"
                    >
                      <RotateCcw size={14} />
                      Restore
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}
