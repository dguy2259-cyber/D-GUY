import { useEffect, useRef, useState } from 'react';
import type { RequirementOverrides, SiteOptions, SiteVersion, TemplateId, WorkspaceProject } from '@/types/project';
import { inferOptions, selectTemplate, TEMPLATE_LABELS } from '@/services/projectConfig';
import { palettes } from '@/theme/palettes';
import { backendApi, type ApiProject } from '@/services/backendApi';

export type GenerationStatus = 'idle' | 'running' | 'complete' | 'error';
export interface GenerationStage { id: string; label: string; durationMs: number }
export interface GenerationState {
  status: GenerationStatus;
  kind: 'create' | 'revise' | null;
  projectId: string | null;
  stages: GenerationStage[];
  stageIndex: number;
  startedAt: number | null;
  finishedAt: number | null;
  expectedFiles: string[];
  provider: 'groq' | 'gemini' | 'openrouter' | 'huggingface' | null;
  streamedCharacters: number;
  activeFile: string | null;
  streamedFiles: Record<string, string>;
  recoveryStatus: string | null;
  error?: string;
}
interface WorkspaceState { projects: WorkspaceProject[]; activeId: string }

const IDLE_GENERATION: GenerationState = {
  status: 'idle', kind: null, projectId: null, stages: [], stageIndex: 0,
  startedAt: null, finishedAt: null, expectedFiles: [], provider: null, streamedCharacters: 0, activeFile: null, streamedFiles: {}, recoveryStatus: null,
};
const newId = () => crypto.randomUUID();

function emptyProject(): WorkspaceProject {
  return { id: '', name: 'Workspace', messages: [], versions: [], activeVersionId: null, createdAt: Date.now() };
}

function fromApiProject(value: ApiProject): WorkspaceProject {
  const versions: SiteVersion[] = value.versions.map((version) => {
    const rawOptions = version.options || {};
    const templateId = (['restaurant', 'saas', 'portfolio'].includes(version.templateId) ? version.templateId : 'saas') as TemplateId;
    const palette = rawOptions.palette;
    const files = Array.isArray(version.files) ? version.files : [];
    return {
      id: version.id, number: version.number, prompt: version.prompt ?? '', summary: version.summary, templateId,
      options: { palette: typeof palette === 'string' && palette in palettes ? palette as SiteOptions['palette'] : 'clay', testimonials: rawOptions.testimonials === true, premiumHero: rawOptions.premiumHero === true },
      files, createdAt: new Date(version.createdAt).getTime(),
      previewMode: files.some((file) => file.path.toLowerCase() === 'index.html') ? 'sandbox-html' as const : 'static-files' as const,
      warnings: Array.isArray(version.warnings) ? version.warnings : [],
    };
  }).sort((left, right) => left.number - right.number);
  return { id: value.id, name: value.name, messages: Array.isArray(value.messages) ? value.messages : [], versions, activeVersionId: value.activeVersionId, createdAt: new Date(value.createdAt).getTime(), updatedAt: new Date(value.updatedAt).getTime() };
}

function withMessage(project: WorkspaceProject, role: 'user' | 'assistant', text: string): WorkspaceProject {
  return { ...project, messages: [...project.messages, { id: newId(), role, text }] };
}

export function useWorkspace(persistentUserId: string | null) {
  const [state, setState] = useState<WorkspaceState>({ projects: [], activeId: '' });
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const ready = !!persistentUserId && loadedUserId === persistentUserId && !busy && !loadError;
  const [generation, setGeneration] = useState<GenerationState>(IDLE_GENERATION);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(generation);
  generationRef.current = generation;

  useEffect(() => {
    if (!persistentUserId) { setState({ projects: [], activeId: '' }); setBusy(false); setLoadedUserId(null); return; }
    const controller = new AbortController();
    setBusy(true); setLoadError(null);
    void backendApi.projects(controller.signal).then(async (remoteProjects) => {
      if (controller.signal.aborted) return;
      if (remoteProjects.length === 0) {
        const response = await backendApi.createProject('Untitled project 1');
        if (!controller.signal.aborted) setState({ projects: [fromApiProject(response.project)], activeId: response.project.id });
      } else {
        const projects = remoteProjects.map(fromApiProject);
        const active = projects[0];
        if (active?.activeVersionId) {
          const detail = fromApiProject(await backendApi.project(active.id, controller.signal));
          projects[0] = detail;
        }
        setState({ projects, activeId: projects[0]?.id ?? '' });
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Could not load your projects.');
    }).finally(() => {
      if (!controller.signal.aborted) { setLoadedUserId(persistentUserId); setBusy(false); }
    });
    return () => controller.abort();
  }, [persistentUserId]);

  const activeProject = state.projects.find((project) => project.id === state.activeId) ?? state.projects[0] ?? emptyProject();
  const activeVersion = activeProject.versions.find((version) => version.id === activeProject.activeVersionId) ?? null;
  const updateProject = (projectId: string, update: (project: WorkspaceProject) => WorkspaceProject) => {
    setState((previous) => ({ ...previous, projects: previous.projects.map((project) => project.id === projectId ? update(project) : project) }));
  };

  const cancelRunningBuild = () => {
    const controller = controllerRef.current;
    if (!controller) return;
    controllerRef.current = null; controller.abort();
    const projectId = generationRef.current.projectId;
    if (projectId) {
      const message = 'Generation was cancelled. Your last saved version is unchanged.';
      updateProject(projectId, (project) => withMessage(project, 'assistant', message));
      const project = state.projects.find((item) => item.id === projectId);
      if (project) void backendApi.updateProject({ id: project.id, name: project.name, messages: [...project.messages, { id: newId(), role: 'assistant', text: message }] }).catch(() => undefined);
    }
    setGeneration(IDLE_GENERATION);
  };

  const submitPrompt = (rawText: string, requirements: RequirementOverrides) => {
    const text = rawText.trim();
    if (!text || !persistentUserId || generationRef.current.status === 'running' || !activeProject.id) return;
    const isCreate = !activeVersion;
    const templateId = requirements.templateId ?? activeVersion?.templateId ?? selectTemplate(text);
    const inferred = inferOptions(text);
    const options: SiteOptions = isCreate
      ? { palette: requirements.palette ?? inferred.palette, testimonials: requirements.testimonials ?? inferred.testimonials, premiumHero: inferred.premiumHero }
      : { ...activeVersion.options, ...(requirements.palette ? { palette: requirements.palette } : {}), ...(requirements.testimonials !== null ? { testimonials: requirements.testimonials } : {}) };
    const messages = [...activeProject.messages, { id: newId(), role: 'user' as const, text }];
    updateProject(activeProject.id, (project) => ({ ...project, messages }));
    const controller = new AbortController(); controllerRef.current = controller;
    const stages: GenerationStage[] = [
      { id: 'planning', label: 'Analyzing requirements and planning the file structure', durationMs: 0 },
      { id: 'generating', label: 'Generating project files with AI', durationMs: 0 },
      { id: 'validating', label: 'Validating generated files', durationMs: 0 },
      { id: 'saving', label: 'Saving the project version to Supabase', durationMs: 0 },
    ];
    setGeneration({ ...IDLE_GENERATION, status: 'running', kind: isCreate ? 'create' : 'revise', projectId: activeProject.id, stages, startedAt: Date.now() });
    void (async () => {
      try {
        await backendApi.updateProject({ id: activeProject.id, name: activeProject.name, messages });
        const started = await backendApi.startGeneration(activeProject.id, { prompt: text, templateId, options, mode: isCreate ? 'create' : 'revise', idempotencyKey: newId() }, controller.signal);
        const jobId = started.job.id;
        controller.signal.addEventListener('abort', () => { void backendApi.cancelGeneration(jobId).catch(() => undefined); }, { once: true });
        await backendApi.streamGeneration(jobId, controller.signal, (event) => {
          if (event.event === 'stage' && typeof event.data.id === 'string') {
            const stageId = event.data.id;
            setGeneration((current) => ({
              ...current,
              stageIndex: Math.max(0, current.stages.findIndex((stage) => stage.id === stageId)),
            }));
          }
          if (event.event === 'provider' && (event.data.provider === 'groq' || event.data.provider === 'gemini' || event.data.provider === 'openrouter' || event.data.provider === 'huggingface')) {
            const provider = event.data.provider;
            setGeneration((current) => ({ ...current, provider, streamedCharacters: 0, recoveryStatus: null }));
          }
          if (event.event === 'file_started' && typeof event.data.path === 'string') {
            const path = event.data.path;
            setGeneration((current) => ({ ...current, activeFile: path as string, streamedFiles: { ...current.streamedFiles, [path]: '' } }));
          }
          if (event.event === 'retry' && typeof event.data.reason === 'string') {
            setGeneration((current) => ({ ...current, recoveryStatus: `Trying the next provider after ${event.data.reason}.` }));
          }
          if (event.event === 'delta' && typeof event.data.characters === 'number') {
            const count = event.data.characters;
            setGeneration((current) => ({ ...current, streamedCharacters: current.streamedCharacters + count }));
          }
          if (event.event === 'file' && typeof event.data.path === 'string') {
            setGeneration((current) => ({ ...current, activeFile: null, expectedFiles: current.expectedFiles.includes(event.data.path as string) ? current.expectedFiles : [...current.expectedFiles, event.data.path as string] }));
          }
          if (event.event === 'file_delta' && typeof event.data.path === 'string' && typeof event.data.text === 'string' && event.data.text.length <= 100_000) {
            const path = event.data.path;
            const text = event.data.text;
            setGeneration((current) => ({ ...current, streamedFiles: { ...current.streamedFiles, [path]: `${current.streamedFiles[path] ?? ''}${text}`.slice(0, 200_000) } }));
          }
        });
        const remote = fromApiProject(await backendApi.project(activeProject.id));
        const latest = remote.versions[remote.versions.length - 1];
        const warningText = latest?.warnings?.length ? ` Provider note: ${latest.warnings.join(' ')}` : '';
        const previewNote = latest?.previewMode === 'sandbox-html' ? ' A sandboxed live preview is ready.' : ' Source files are available in Code and Files.';
        const assistantText = `${latest?.summary || (isCreate ? `Created ${TEMPLATE_LABELS[templateId]}` : 'Revision saved')}. Version ${latest?.number ?? 1} is saved.${previewNote}${warningText}`;
        const finalMessages = [...messages, { id: newId(), role: 'assistant' as const, text: assistantText }];
        remote.messages = finalMessages;
        setState((previous) => ({ projects: previous.projects.map((project) => project.id === remote.id ? remote : project), activeId: previous.activeId }));
        await backendApi.updateProject({ id: remote.id, name: remote.name, messages: finalMessages });
        controllerRef.current = null;
        setGeneration((current) => ({ ...current, status: 'complete', stageIndex: current.stages.length, finishedAt: Date.now(), streamedFiles: {} }));
      } catch (error) {
        if (controller.signal.aborted) return;
        controllerRef.current = null;
        const failMessage = { id: newId(), role: 'assistant' as const, text: error instanceof Error ? error.message : 'Generation failed. Your last saved version remains available.' };
        const failedMessages = [...messages, failMessage];
        updateProject(activeProject.id, (project) => ({ ...project, messages: failedMessages }));
        void backendApi.updateProject({ id: activeProject.id, name: activeProject.name, messages: failedMessages }).catch(() => undefined);
        setGeneration((current) => ({ ...current, status: 'error', error: failMessage.text, finishedAt: Date.now() }));
      }
    })();
  };

  const startNewProject = () => {
    cancelRunningBuild(); setBusy(true);
    void backendApi.createProject(`Untitled project ${state.projects.length + 1}`).then(({ project }) => {
      const remote = fromApiProject(project); setState((previous) => ({ projects: [...previous.projects, remote], activeId: remote.id }));
    }).catch((error) => setLoadError(error instanceof Error ? error.message : 'Could not create the project.')).finally(() => setBusy(false));
  };

  const renameProject = async (projectId: string, name: string) => {
    const current = state.projects.find((project) => project.id === projectId);
    if (!current) throw new Error('Project no longer exists.');
    const result = await backendApi.updateProject({ id: current.id, name: name.trim(), messages: current.messages });
    setState((previous) => ({ ...previous, projects: previous.projects.map((project) => project.id === projectId ? { ...project, name: result.project.name, updatedAt: new Date(result.project.updatedAt).getTime() } : project) }));
  };

  const deleteProject = async (projectId: string) => {
    await backendApi.deleteProject(projectId);
    const remaining = state.projects.filter((project) => project.id !== projectId);
    if (remaining.length === 0) {
      const { project } = await backendApi.createProject('Untitled project 1');
      const created = fromApiProject(project);
      setState({ projects: [created], activeId: created.id });
      return;
    }
    setState({ projects: remaining, activeId: state.activeId === projectId ? remaining[0]!.id : state.activeId });
  };

  const selectProject = (projectId: string) => {
    cancelRunningBuild();
    const project = state.projects.find((item) => item.id === projectId);
    const active = project?.versions.find((version) => version.id === project.activeVersionId);
    if (project?.activeVersionId && active && active.files.length === 0) {
      setBusy(true);
      void backendApi.project(projectId).then((detail) => {
        const remote = fromApiProject(detail);
        setState((previous) => ({ projects: previous.projects.map((item) => item.id === projectId ? remote : item), activeId: projectId }));
      }).catch((error) => setLoadError(error instanceof Error ? error.message : 'Could not load project files.')).finally(() => setBusy(false));
      return;
    }
    setState((previous) => ({ ...previous, activeId: projectId }));
  };

  const restoreVersion = (versionId: string) => {
    if (generationRef.current.status === 'running') return;
    void backendApi.restore(activeProject.id, versionId).then(async () => {
      const remote = fromApiProject(await backendApi.project(activeProject.id));
      setState((previous) => ({ ...previous, projects: previous.projects.map((project) => project.id === remote.id ? remote : project) }));
    }).catch((error) => setLoadError(error instanceof Error ? error.message : 'Could not restore that version.'));
  };

  const resetWorkspace = () => {
    cancelRunningBuild(); setBusy(true);
    void (async () => {
      await Promise.all(state.projects.map((project) => backendApi.deleteProject(project.id)));
      const { project } = await backendApi.createProject('Untitled project 1');
      setState({ projects: [fromApiProject(project)], activeId: project.id });
    })().catch((error) => setLoadError(error instanceof Error ? error.message : 'Could not clear the workspace.')).finally(() => setBusy(false));
  };

  return { ready, loadError, projects: state.projects, activeProject, activeVersion, generation, submitPrompt, startNewProject, selectProject, renameProject, deleteProject, restoreVersion, resetWorkspace };
}
