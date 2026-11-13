import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatPanel } from '@/components/ChatPanel';
import { FullscreenPreview } from '@/components/FullscreenPreview';
import { PreviewPanel } from '@/components/PreviewPanel';
import type { PreviewTab } from '@/components/PreviewPanel';
import { ProjectsDialog } from '@/components/ProjectsDialog';
import { SettingsDialog } from '@/components/SettingsDialog';
import { Sidebar } from '@/components/Sidebar';
import type { NavKey } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { VersionHistoryDialog } from '@/components/VersionHistoryDialog';
import { useWorkspace } from '@/hooks/useWorkspace';
import { BackendAuthScreen } from '@/components/BackendAuthScreen';
import { GitHubPullRequestDialog } from '@/components/GitHubPullRequestDialog';
import { DeploymentPreparationDialog } from '@/components/DeploymentPreparationDialog';
import { backendApi, type ApiUser } from '@/services/backendApi';
import type { PreviewStatus, ViewportMode } from '@/types/project';

type Dialog = 'projects' | 'history' | 'settings';
type MobileTab = 'chat' | 'preview';

const DEFAULT_FILE = 'src/App.tsx';

function App() {
  const [user, setUser] = useState<ApiUser | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void backendApi.me().then(({ user: current }) => { if (active) setUser(current); }).catch(() => { if (active) setUser(null); });
    return () => { active = false; };
  }, []);
  const workspace = useWorkspace(user?.id ?? null);
  const attemptedRuntimeRepair = useRef(new Set<string>());
  const runtimeRepairHandler = useRef<(message: string) => void>(() => undefined);
  runtimeRepairHandler.current = (message) => {
    const project = workspace.activeProject;
    if (!project.id || !workspace.activeVersion || workspace.generation.status === 'running' || attemptedRuntimeRepair.current.has(project.id)) return;
    attemptedRuntimeRepair.current.add(project.id);
    const safeMessage = Array.from(message, (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127 ? char : ' ').join('').slice(0, 600);
    workspace.submitPrompt(`Fix the live preview runtime error in the current project. Error: ${safeMessage}. Inspect the existing files, correct the cause, and preserve unrelated behavior.`, { templateId: null, palette: null, testimonials: null });
    setMobileTab('chat');
  };
  const handlePreviewRuntimeError = useCallback((message: string) => runtimeRepairHandler.current(message), []);
  const [viewport, setViewport] = useState<ViewportMode>('desktop');
  const [previewTab, setPreviewTab] = useState<PreviewTab>('preview');
  const [selectedPath, setSelectedPath] = useState(DEFAULT_FILE);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 1024);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [githubDialog, setGithubDialog] = useState(false);
  const [deploymentDialog, setDeploymentDialog] = useState(false);

  if (user === undefined) return <div className="flex min-h-dvh items-center justify-center bg-ivory text-sm text-stone">Connecting to D-GUY…</div>;
  if (!user) return <BackendAuthScreen onAuthenticated={setUser} />;
  if (workspace.loadError) return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ivory p-5 text-center"><p role="alert" className="text-sm text-stone">Could not load your saved projects: {workspace.loadError}</p><button type="button" onClick={() => window.location.reload()} className="clay-button px-5 py-2.5 text-sm">Retry</button><button type="button" onClick={() => { void backendApi.logout().catch(() => undefined).finally(() => setUser(null)); }} className="text-sm font-semibold text-terracotta-deep">Sign out</button></main>;
  if (!workspace.ready) return <div className="flex min-h-dvh items-center justify-center bg-ivory text-sm text-stone">Loading your projects…</div>;
  const { activeProject, activeVersion, generation } = workspace;
  const running = generation.status === 'running';

  const previewStatus: PreviewStatus = running
    ? 'generating'
    : generation.status === 'error'
      ? 'error'
      : activeVersion
        ? activeVersion.previewMode === 'static-files' ? 'ready' : 'preview-ready'
        : 'ready';
  const saveLabel = running ? 'Generating…' : 'Saved to your account';
  const activeNav: NavKey = dialog ?? (previewTab === 'files' ? 'files' : 'builder');

  const closeDialog = () => setDialog(null);

  const handleNavigate = (key: NavKey) => {
    setMenuOpen(false);
    switch (key) {
      case 'new':
        workspace.startNewProject();
        setMobileTab('chat');
        break;
      case 'builder':
        setMobileTab('chat');
        document.getElementById('prompt-input')?.focus();
        break;
      case 'projects':
      case 'history':
      case 'settings':
        setDialog(key);
        break;
      case 'files':
        setPreviewTab('files');
        setMobileTab('preview');
        break;
    }
  };

  const handleDownload = async () => {
    if (!activeVersion) return;
    setDownloadError(null);
    try {
      const response = await fetch(backendApi.exportUrl(activeProject.id), { credentials: 'include' });
      if (!response.ok) throw new Error('The server could not export this project.');
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a');
      link.href = url; link.download = `dguy-project-v${activeVersion.number}.zip`;
      document.body.append(link);
      try { link.click(); }
      finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (error) { setDownloadError(error instanceof Error ? error.message : 'Project export failed.'); }
  };

  const sidebarProps = {
    collapsed: sidebarCollapsed,
    activeKey: activeNav,
    onNavigate: handleNavigate,
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ivory text-charcoal">
      <TopBar
        projects={workspace.projects}
        activeProject={activeProject}
        previewStatus={previewStatus}
        saveLabel={saveLabel}
        onSelectProject={workspace.selectProject}
        onNewProject={() => handleNavigate('new')}
        onOpenProjects={() => setDialog('projects')}
        onOpenSettings={() => setDialog('settings')}
        onToggleMenu={() => setMenuOpen((open) => !open)}
      />

      <div className="flex min-h-0 flex-1">
        <div className="hidden h-full md:block">
          <Sidebar {...sidebarProps} onToggleCollapsed={() => setSidebarCollapsed((value) => !value)} />
        </div>

        {menuOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button type="button" aria-label="Close navigation menu" onClick={() => setMenuOpen(false)} className="absolute inset-0 bg-charcoal/25" />
            <div className="absolute inset-y-0 left-0 animate-fade-up shadow-clay-lg">
              <Sidebar {...sidebarProps} collapsed={false} onToggleCollapsed={() => setMenuOpen(false)} />
            </div>
          </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div role="tablist" aria-label="Workspace view" className="flex shrink-0 p-3 md:hidden">
            <div className="clay-inset grid w-full grid-cols-2 gap-1 rounded-2xl p-1">
              {(['chat', 'preview'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={mobileTab === tab}
                  onClick={() => setMobileTab(tab)}
                  className={`rounded-xl py-2 text-sm font-semibold transition ${
                    mobileTab === tab ? 'bg-porcelain text-terracotta-deep shadow-clay' : 'text-stone'
                  }`}
                >
                  {tab === 'chat' ? 'Chat' : 'Preview'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className={`min-h-0 flex-col border-cream md:flex md:border-r ${mobileTab === 'chat' ? 'flex' : 'hidden'}`}>
              <ChatPanel
                project={activeProject}
                activeVersion={activeVersion}
                generation={generation}
                onSubmit={(prompt, requirements) => {
                  attemptedRuntimeRepair.current.delete(activeProject.id);
                  workspace.submitPrompt(prompt, requirements);
                }}
              />
            </div>
            <div className={`min-h-0 flex-col md:flex ${mobileTab === 'preview' ? 'flex' : 'hidden'}`}>
              <PreviewPanel
                version={activeVersion}
                generation={generation}
                previewStatus={previewStatus}
                viewport={viewport}
                onViewportChange={setViewport}
                tab={previewTab}
                onTabChange={setPreviewTab}
                selectedPath={selectedPath}
                onSelectPath={setSelectedPath}
                refreshKey={refreshKey}
                onRefresh={() => setRefreshKey((key) => key + 1)}
                onOpenFullscreen={() => setFullscreen(true)}
                onDownload={handleDownload}
                onRuntimeError={handlePreviewRuntimeError}
                onCreatePullRequest={() => setGithubDialog(true)}
                onPrepareDeployment={() => setDeploymentDialog(true)}
              />
            </div>
          </div>
        </div>
      </div>

      {fullscreen && activeVersion && (
        <FullscreenPreview
          version={activeVersion}
          viewport={viewport}
          onViewportChange={setViewport}
          onClose={() => setFullscreen(false)}
        />
      )}

      {dialog === 'projects' && (
        <ProjectsDialog
          projects={workspace.projects}
          activeProjectId={activeProject.id}
          onSelect={workspace.selectProject}
          onNewProject={() => handleNavigate('new')}
          onRename={workspace.renameProject}
          onDelete={workspace.deleteProject}
          onClose={closeDialog}
        />
      )}
      {dialog === 'history' && (
        <VersionHistoryDialog
          project={activeProject}
          activeVersionId={activeProject.activeVersionId}
          canRestore={!running}
          onRestore={workspace.restoreVersion}
          onClose={closeDialog}
        />
      )}
      {dialog === 'settings' && (
        <SettingsDialog
          onLogout={() => { void backendApi.logout().catch(() => undefined).finally(() => setUser(null)); closeDialog(); }}
          onResetWorkspace={() => {
            workspace.resetWorkspace();
            setSelectedPath(DEFAULT_FILE);
            setPreviewTab('preview');
          }}
          onClose={closeDialog}
        />
      )}
      {githubDialog && <GitHubPullRequestDialog project={activeProject} onClose={() => setGithubDialog(false)} />}
      {deploymentDialog && <DeploymentPreparationDialog project={activeProject} onClose={() => setDeploymentDialog(false)} />}
      {downloadError && <div role="alert" className="fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl bg-red-50 p-4 text-sm text-red-900 shadow-clay-lg">{downloadError}</div>}
    </div>
  );
}

export default App;
