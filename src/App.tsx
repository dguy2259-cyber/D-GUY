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
import { RecoveryDialog } from '@/components/RecoveryDialog';
import { backendApi, type ApiUser } from '@/services/backendApi';
import type { PreviewStatus, RuntimeErrorReport, ViewportMode } from '@/types/project';
import type { RequirementOverrides } from '@/types/project';

type Dialog = 'projects' | 'history' | 'recovery' | 'settings';
type MobileTab = 'chat' | 'preview';
interface RecoveryValidation { passed: boolean; message?: string; report?: RuntimeErrorReport }
interface RecoveryWaiter {
  versionId: string;
  resolve: (result: RecoveryValidation) => void;
  stableTimer?: number;
  timeoutTimer?: number;
}

const DEFAULT_FILE = 'src/App.tsx';

function App() {
  const [user, setUser] = useState<ApiUser | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void backendApi.me().then(({ user: current }) => { if (active) setUser(current); }).catch(() => { if (active) setUser(null); });
    return () => { active = false; };
  }, []);
  const workspace = useWorkspace(user?.id ?? null);
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
  const [runningRecoverySessionId, setRunningRecoverySessionId] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const recoveryRunningRef = useRef(false);
  const recoveryRunnerRef = useRef<(sessionId: string, manual: boolean, projectId: string) => Promise<void>>(async () => undefined);
  const recoveryWaiterRef = useRef<RecoveryWaiter | null>(null);
  const readyVersionsRef = useRef(new Set<string>());
  const errorsByVersionRef = useRef(new Map<string, RuntimeErrorReport>());

  const handlePreviewReady = useCallback((versionId: string) => {
    readyVersionsRef.current.add(versionId);
    while (readyVersionsRef.current.size > 50) readyVersionsRef.current.delete(readyVersionsRef.current.values().next().value!);
    const waiter = recoveryWaiterRef.current;
    if (!waiter || waiter.versionId !== versionId || waiter.stableTimer !== undefined) return;
    waiter.stableTimer = window.setTimeout(() => waiter.resolve({ passed: true }), 4_000);
  }, []);

  const handlePreviewRuntimeError = useCallback((report: RuntimeErrorReport) => {
    errorsByVersionRef.current.set(report.versionId, report);
    while (errorsByVersionRef.current.size > 50) errorsByVersionRef.current.delete(errorsByVersionRef.current.keys().next().value!);
    const waiter = recoveryWaiterRef.current;
    if (waiter?.versionId === report.versionId) {
      waiter.resolve({ passed: false, message: report.message, report });
      return;
    }
    if (recoveryRunningRef.current) return;
    const currentWorkspace = workspaceRef.current;
    const projectId = currentWorkspace.activeProject.id;
    if (!projectId || currentWorkspace.generation.status === 'running' || currentWorkspace.activeVersion?.id !== report.versionId) return;
    void backendApi.reportRuntimeError(projectId, report).then((result) => {
      if (result.ignored || !result.session) return;
      if (result.autoEligible && result.autoRecoveryEnabled) void recoveryRunnerRef.current(result.session.id, false, projectId);
      else setRecoveryNotice(result.session.status === 'awaiting_approval'
        ? 'Runtime issue recorded for manual review; automatic repair was not started.'
        : 'Runtime issue recorded. Review it in Autonomous Error Recovery or retry manually.');
    }).catch((error: unknown) => setRecoveryNotice(error instanceof Error ? error.message : 'The runtime error could not be recorded.'));
  }, []);

  if (user === undefined) return <div className="flex min-h-dvh items-center justify-center bg-ivory text-sm text-stone">Connecting to D-GUY…</div>;
  if (!user) return <BackendAuthScreen onAuthenticated={setUser} />;
  if (workspace.loadError) return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ivory p-5 text-center"><p role="alert" className="text-sm text-stone">Could not load your saved projects: {workspace.loadError}</p><button type="button" onClick={() => window.location.reload()} className="clay-button px-5 py-2.5 text-sm">Retry</button><button type="button" onClick={() => { void backendApi.logout().catch(() => undefined).finally(() => setUser(null)); }} className="text-sm font-semibold text-terracotta-deep">Sign out</button></main>;
  if (!workspace.ready) return <div className="flex min-h-dvh items-center justify-center bg-ivory text-sm text-stone">Loading your projects…</div>;
  const { activeProject, activeVersion, generation } = workspace;
  const running = generation.status === 'running';

  const waitForPreviewValidation = (versionId: string) => new Promise<RecoveryValidation>((resolve) => {
    let completed = false;
    const finish = (result: RecoveryValidation) => {
      if (completed) return;
      completed = true;
      if (recoveryWaiterRef.current?.versionId === versionId) {
        if (recoveryWaiterRef.current.stableTimer !== undefined) window.clearTimeout(recoveryWaiterRef.current.stableTimer);
        if (recoveryWaiterRef.current.timeoutTimer !== undefined) window.clearTimeout(recoveryWaiterRef.current.timeoutTimer);
        recoveryWaiterRef.current = null;
      }
      resolve(result);
    };
    const waiter: RecoveryWaiter = { versionId, resolve: finish };
    recoveryWaiterRef.current = waiter;
    waiter.timeoutTimer = window.setTimeout(() => finish({ passed: false, message: 'The preview did not become ready within 30 seconds.' }), 30_000);
    const priorError = errorsByVersionRef.current.get(versionId);
    if (priorError) {
      finish({ passed: false, message: priorError.message, report: priorError });
      return;
    }
    if (readyVersionsRef.current.has(versionId)) waiter.stableTimer = window.setTimeout(() => finish({ passed: true }), 4_000);
  });

  const runRecoverySession = async (sessionId: string, manual: boolean, projectId: string) => {
    if (recoveryRunningRef.current || workspaceRef.current.activeProject.id !== projectId) return;
    recoveryRunningRef.current = true;
    setRunningRecoverySessionId(sessionId);
    setRecoveryNotice('Starting isolated recovery attempt…');
    setPreviewTab('preview');
    setMobileTab('preview');
    try {
      for (;;) {
        const current = workspaceRef.current;
        if (current.activeProject.id !== projectId) break;
        const { attempt, prompt } = await backendApi.beginRecoveryAttempt(projectId, sessionId, manual);
        if (workspaceRef.current.activeProject.id !== projectId) {
          await backendApi.pauseRecovery(projectId, sessionId);
          break;
        }
        setRecoveryNotice(`Recovery attempt ${attempt.attemptNumber}/5 is generating a targeted correction.`);
        const requirements: RequirementOverrides = {
          templateId: current.activeVersion?.templateId ?? 'saas',
          palette: null,
          testimonials: null,
          menuBar: null,
        };
        const candidate = await workspaceRef.current.submitPrompt(prompt, requirements, attempt.id);
        if (!candidate) {
          setRecoveryNotice('AI generation did not produce a candidate. The existing saved version remains available.');
          break;
        }
        setRecoveryNotice(`Attempt ${attempt.attemptNumber}/5 is restarting and validating the isolated preview.`);
        const validation = await waitForPreviewValidation(candidate.id);
        const result = await backendApi.validateRecoveryAttempt(projectId, sessionId, attempt.id, {
          candidateVersionId: candidate.id,
          passed: validation.passed,
          ...(validation.report ? { error: validation.report } : validation.message ? { message: validation.message } : {}),
        });
        if (result.status === 'recovered') {
          setRecoveryNotice(`Recovery verified for version ${candidate.number}.`);
          break;
        }
        if (!validation.passed) await workspaceRef.current.reloadProject(projectId);
        if (result.status === 'awaiting_approval') {
          setRecoveryNotice('The latest preview failure requires manual review; no further AI attempt was started.');
          break;
        }
        if (!result.retryAllowed) {
          setRecoveryNotice('Automatic correction stopped at its safety limit. The last known-good version was restored.');
          break;
        }
        setRecoveryNotice(`Attempt ${attempt.attemptNumber} did not pass validation. Restored the prior version; trying the next bounded attempt.`);
      }
    } catch (error) {
      setRecoveryNotice(error instanceof Error ? error.message : 'Recovery stopped safely. Inspect the recovery history for details.');
    } finally {
      recoveryWaiterRef.current?.resolve({ passed: false, message: 'Recovery stopped before preview validation completed.' });
      recoveryRunningRef.current = false;
      setRunningRecoverySessionId(null);
    }
  };
  recoveryRunnerRef.current = runRecoverySession;

  const previewStatus: PreviewStatus = running
    ? 'generating'
    : generation.status === 'error'
      ? 'error'
      : activeVersion
        ? activeVersion.previewMode === 'static-files' ? 'ready' : 'preview-ready'
        : 'ready';
  const saveLabel = running
    ? 'Generating…'
    : generation.saveState === 'retrying'
      ? 'Preview ready · saving…'
      : generation.saveState === 'failed'
        ? 'Preview ready · not saved'
        : 'Saved to your account';
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
      case 'recovery':
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
                  void workspace.submitPrompt(prompt, requirements);
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
                onPreviewReady={handlePreviewReady}
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
      {dialog === 'recovery' && (
        <RecoveryDialog
          projectId={activeProject.id}
          runningSessionId={runningRecoverySessionId}
          onRetry={(sessionId) => runRecoverySession(sessionId, true, activeProject.id)}
          onPause={(sessionId) => {
            if (runningRecoverySessionId === sessionId) {
              recoveryWaiterRef.current?.resolve({ passed: false, message: 'Recovery was paused by the user.' });
              void workspace.reloadProject(activeProject.id).then(() => setRecoveryNotice('Recovery paused; the last known-good version is active.')).catch((error: unknown) => setRecoveryNotice(error instanceof Error ? error.message : 'Recovery paused, but the project view could not be refreshed.'));
            }
          }}
          onRollback={() => workspace.reloadProject(activeProject.id).then(() => setRecoveryNotice('Restored the last known-good project version.'))}
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
      {recoveryNotice && <div role="status" className="fixed bottom-5 left-5 z-40 flex max-w-md items-start gap-3 rounded-xl border border-cream bg-white/95 px-4 py-3 text-xs font-medium text-charcoal shadow-clay-lg"><span>{recoveryNotice}</span><button type="button" onClick={() => setRecoveryNotice(null)} className="shrink-0 font-semibold text-terracotta-deep">Dismiss</button></div>}
      {downloadError && <div role="alert" className="fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl bg-red-50 p-4 text-sm text-red-900 shadow-clay-lg">{downloadError}</div>}
    </div>
  );
}

export default App;
