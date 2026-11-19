import { Download, GitPullRequest, PackageCheck } from 'lucide-react';
import { BrowserToolbar, ViewportSwitch } from '@/components/BrowserToolbar';
import { CodeViewer } from '@/components/CodeViewer';
import { FileExplorer } from '@/components/FileExplorer';
import { PreviewCanvas } from '@/components/PreviewCanvas';
import { detectWebContainerProject } from '@/services/webcontainerFiles';
import { StatusBadge } from '@/components/StatusBadge';
import { formatSeconds } from '@/utils/formatSeconds';
import type { GenerationState } from '@/hooks/useWorkspace';
import { useNow } from '@/hooks/useNow';
import type { PreviewStatus, RuntimeErrorReport, SiteVersion, ViewportMode } from '@/types/project';

export type PreviewTab = 'preview' | 'code' | 'files';

const TABS: { key: PreviewTab; label: string }[] = [
  { key: 'preview', label: 'Preview' },
  { key: 'code', label: 'Code' },
  { key: 'files', label: 'Files' },
];

interface PreviewPanelProps {
  version: SiteVersion | null;
  generation: GenerationState;
  previewStatus: PreviewStatus;
  viewport: ViewportMode;
  onViewportChange: (mode: ViewportMode) => void;
  tab: PreviewTab;
  onTabChange: (tab: PreviewTab) => void;
  selectedPath: string;
  onSelectPath: (path: string) => void;
  refreshKey: number;
  onRefresh: () => void;
  onOpenFullscreen: () => void;
  onDownload: () => void;
  onRuntimeError?: (report: RuntimeErrorReport) => void;
  onPreviewReady?: (versionId: string) => void;
  onCreatePullRequest: () => void;
  onPrepareDeployment: () => void;
}

export function PreviewPanel({
  version,
  generation,
  previewStatus,
  viewport,
  onViewportChange,
  tab,
  onTabChange,
  selectedPath,
  onSelectPath,
  refreshKey,
  onRefresh,
  onOpenFullscreen,
  onDownload,
  onRuntimeError,
  onPreviewReady,
  onCreatePullRequest,
  onPrepareDeployment,
}: PreviewPanelProps) {
  const running = generation.status === 'running';
  const now = useNow(running);
  const elapsed = generation.startedAt ? (generation.finishedAt ?? now) - generation.startedAt : 0;
  const currentStage = running ? generation.stages[generation.stageIndex] : undefined;
  const progress =
    generation.stages.length === 0
      ? 0
      : generation.status === 'complete'
        ? 100
        : Math.round((generation.stageIndex / generation.stages.length) * 100);

  const stripLabel = currentStage
    ? currentStage.label
    : generation.status === 'complete'
      ? 'Preview ready'
      : generation.status === 'error'
        ? 'Build stopped'
        : version
          ? 'Preview ready'
          : 'Waiting for a project request';

  const address = version ? `d-guy://projects/${version.id}/preview` : 'd-guy://preview';
  const visibleFiles = [...(version?.files ?? [])];
  const selectedFile = visibleFiles.find((file) => file.path === selectedPath)
    ?? visibleFiles.find((file) => file.path === generation.activeFile)
    ?? visibleFiles[0];
  const reactPreview = version ? detectWebContainerProject(version.files) !== null : false;

  return (
    <section aria-label="Live preview" className="flex h-full min-h-0 flex-col gap-4 bg-ivory p-4 lg:p-5">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Live Preview</h2>
          <p className="text-xs text-stone">{reactPreview ? 'React and Next.js run inside a browser WebContainer; generated code does not run on the D-GUY server.' : version?.previewMode === 'sandbox-html' ? 'HTML runs in an isolated iframe; outbound network access is blocked' : 'Generated source is shown in the editor and is not executed by the API.'}</p>
        </div>
        <StatusBadge status={previewStatus} />
      </header>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Preview sections" className="clay-inset flex items-center gap-1 rounded-2xl p-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => onTabChange(item.key)}
              className={`rounded-xl px-4 py-1.5 text-sm font-semibold transition ${
                tab === item.key ? 'bg-porcelain text-terracotta-deep shadow-clay' : 'text-stone hover:text-charcoal'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {tab === 'preview' && <ViewportSwitch viewport={viewport} onChange={onViewportChange} />}
          <button type="button" onClick={onCreatePullRequest} disabled={!version} className="clay-soft-button h-10 !rounded-xl px-3 text-xs disabled:opacity-50" title="Create a GitHub branch and pull request">
            <GitPullRequest size={15} />
            <span className="hidden sm:inline">Create PR</span>
          </button>
          <button type="button" onClick={onPrepareDeployment} disabled={!version} className="clay-soft-button h-10 !rounded-xl px-3 text-xs disabled:opacity-50" title="Download Vercel and Render configuration">
            <PackageCheck size={15} />
            <span className="hidden sm:inline">Deploy files</span>
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={!version}
            className="clay-soft-button h-10 !rounded-xl px-3 text-xs"
          >
            <Download size={15} />
            <span className="hidden sm:inline">Download project</span>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {tab === 'preview' && (
          <div className="clay-raised flex min-h-0 flex-1 flex-col overflow-hidden rounded-clay-lg p-3">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-cream">
              <BrowserToolbar address={address} onRefresh={onRefresh} onOpen={onOpenFullscreen} canOpen={Boolean(version)} />
              <div className="min-h-0 flex-1">
                <PreviewCanvas
                  version={version}
                  viewport={viewport}
                  refreshKey={refreshKey}
                  buildingLabel={currentStage ? currentStage.label : null}
                  onRuntimeError={onRuntimeError}
                  onPreviewReady={onPreviewReady}
                />
              </div>
            </div>
          </div>
        )}

        {tab !== 'preview' && !selectedFile && (
          <div className="clay-inset flex flex-1 items-center justify-center rounded-clay p-8 text-center text-sm text-stone">
            {running ? 'Waiting for the first source file. Generated code will appear here as it streams.' : 'Files appear here after your first draft is generated.'}
          </div>
        )}

        {tab === 'code' && selectedFile && (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <CodeViewer path={selectedFile.path} content={selectedFile.content} />
          </div>
        )}

        {tab === 'files' && selectedFile && (
          <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[220px_1fr]">
            <div className="max-h-48 min-h-0 md:max-h-none">
              <FileExplorer files={visibleFiles} selectedPath={selectedFile.path} onSelect={onSelectPath} />
            </div>
            <div className="flex min-h-0 flex-col gap-2">
              <CodeViewer path={selectedFile.path} content={selectedFile.content} />
            </div>
          </div>
        )}
      </div>

      <div className="clay-inset relative shrink-0 overflow-hidden rounded-2xl px-4 py-2.5">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-cream">
          <div className="h-full bg-terracotta transition-[width] duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="flex min-w-0 items-center gap-2 font-semibold text-charcoal">
            <span className={`h-2 w-2 shrink-0 rounded-full ${running ? 'animate-pulse-dot bg-terracotta' : 'bg-slate'}`} aria-hidden="true" />
            <span className="truncate">{stripLabel}</span>
          </span>
          <span className="shrink-0 font-mono text-stone">
            {running || generation.finishedAt ? formatSeconds(elapsed) : '0.0s'}
          </span>
        </div>
      </div>
    </section>
  );
}
