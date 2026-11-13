import { useEffect, useRef, useState } from 'react';
import { WebContainer, type WebContainerProcess } from '@webcontainer/api';
import type { SiteVersion, ViewportMode } from '@/types/project';
import type { RuntimeErrorReport } from '@/types/project';
import { buildWebContainerFileTree, detectWebContainerProject } from '@/services/webcontainerFiles';
import { disposeSandboxProcess, retryableLazy, waitForSandboxProcess } from '@/services/webcontainerRuntime';

type PreviewPhase = 'starting' | 'installing' | 'serving' | 'error';
const WORKDIR = '/dguy-project';
const DEPENDENCY_INSTALL_TIMEOUT_MS = 60_000;
const getWebContainer = retryableLazy(() => WebContainer.boot({ coep: 'require-corp', forwardPreviewErrors: true }));
let activePreview: { versionId: string; ready: Promise<string>; process?: WebContainerProcess; cleanup?: () => void; cancelReady?: () => void } | undefined;
let operation = Promise.resolve();

async function startProject(
  version: SiteVersion,
  onPhase: (phase: PreviewPhase) => void,
  onRuntimeError: (report: RuntimeErrorReport) => void,
) {
  const current = activePreview;
  if (current?.versionId === version.id) return current.ready;
  let resolveReady!: (url: string) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<string>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const next = { versionId: version.id, ready, cancelReady: () => rejectReady(new Error('Preview stopped.')) } as { versionId: string; ready: Promise<string>; process?: WebContainerProcess; cleanup?: () => void; cancelReady?: () => void };
  activePreview = next;
  let timeoutId: number | undefined;

  operation = operation.catch(() => undefined).then(async () => {
    try {
      onPhase('starting');
      const webcontainer = await getWebContainer();
      if (activePreview !== next) return;
      disposeSandboxProcess(current?.process, current?.cleanup);
      await webcontainer.fs.rm(WORKDIR, { recursive: true, force: true });
      await webcontainer.fs.mkdir(WORKDIR, { recursive: true });
      await webcontainer.mount(buildWebContainerFileTree(version.files), { mountPoint: WORKDIR });
      const kind = detectWebContainerProject(version.files);
      if (!kind) throw new Error('A supported React project needs a package.json with Vite, Next.js, or react-scripts and a dev/start script.');

      onPhase('installing');
      const install = await webcontainer.spawn('npm', ['install', '--no-audit', '--no-fund'], { cwd: WORKDIR });
      next.process = install;
      const installCode = await waitForSandboxProcess(install.exit, DEPENDENCY_INSTALL_TIMEOUT_MS, () => install.kill());
      if (activePreview !== next) return;
      if (installCode !== 0) throw new Error('Dependency installation failed inside the browser sandbox. Check the generated package.json and dependency versions.');
      next.process = undefined;

      let serverReady = false;
      const onServer = webcontainer.on('server-ready', (port, url) => {
        if (port > 0 && activePreview === next) {
          serverReady = true;
          resolveReady(url);
        }
      });
      const onError = webcontainer.on('preview-message', (message) => {
        if (activePreview !== next) return;
        const reason = message.type === 'PREVIEW_CONSOLE_ERROR'
          ? message.args.map(String).join(' ')
          : 'message' in message && typeof message.message === 'string' ? message.message : message.type;
        const stackTrace = 'stack' in message && typeof message.stack === 'string' ? message.stack : undefined;
        onRuntimeError({
          versionId: version.id,
          environment: 'webcontainer',
          category: /UNHANDLED|REJECTION/i.test(message.type) ? 'unhandled_rejection' : 'runtime',
          message: reason.slice(0, 2_000),
          ...(stackTrace ? { stackTrace: stackTrace.slice(0, 6_000) } : {}),
        });
      });
      next.cleanup = () => { onServer(); onError(); };
      const commandArgs = kind === 'next' ? ['run', 'dev', '--', '--hostname', '0.0.0.0']
        : kind === 'vite' ? ['run', 'dev', '--', '--host', '0.0.0.0']
          : ['run', 'start', '--', '--host', '0.0.0.0'];
      next.process = await webcontainer.spawn('npm', commandArgs, { cwd: WORKDIR, env: kind === 'react-scripts' ? { HOST: '0.0.0.0', BROWSER: 'none' } : undefined });
      onPhase('serving');
      void next.process.exit.then((code) => {
        next.cleanup?.();
        if (activePreview === next) {
          activePreview = undefined;
          if (!serverReady) rejectReady(new Error(`The project server exited before the preview was ready (exit code ${code}).`));
          else onRuntimeError({
            versionId: version.id,
            environment: 'webcontainer',
            category: 'startup',
            message: `The isolated project server stopped (exit code ${code}).`,
          });
        }
      });
      const timeout = new Promise<never>((_, reject) => { timeoutId = window.setTimeout(() => reject(new Error('The project server did not become ready within 90 seconds.')), 90_000); });
      await Promise.race([ready, timeout]);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    } catch (error) {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (activePreview === next) {
        disposeSandboxProcess(next.process, next.cleanup);
        activePreview = undefined;
      }
      rejectReady(error instanceof Error ? error : new Error('The browser sandbox could not start this project.'));
    }
  });
  await operation;
  return ready;
}

interface WebContainerPreviewProps {
  version: SiteVersion;
  viewport: ViewportMode;
  onRuntimeError: (report: RuntimeErrorReport) => void;
  onPreviewReady: (versionId: string) => void;
}

export function WebContainerPreview({ version, viewport, onRuntimeError, onPreviewReady }: WebContainerPreviewProps) {
  const [phase, setPhase] = useState<PreviewPhase>('starting');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const runtimeErrorRef = useRef(onRuntimeError);
  const previewReadyRef = useRef(onPreviewReady);
  const versionRef = useRef(version);
  runtimeErrorRef.current = onRuntimeError;
  previewReadyRef.current = onPreviewReady;
  versionRef.current = version;
  useEffect(() => {
    const versionId = version.id;
    let current = true;
    setUrl(''); setError(''); setPhase('starting');
    void startProject(versionRef.current, setPhase, (report) => runtimeErrorRef.current(report)).then((previewUrl) => { if (current) setUrl(previewUrl); }).catch((reason: unknown) => {
      if (current) {
        const message = reason instanceof Error ? reason.message : 'Could not start the React preview.';
        setError(message);
        setPhase('error');
        runtimeErrorRef.current({
          versionId,
          environment: 'webcontainer',
          category: /dependency installation|sandbox.*boot|browser sandbox/i.test(message) ? 'dependency' : 'startup',
          message,
        });
      }
    });
    return () => {
      current = false;
      if (activePreview?.versionId === versionId) {
        const preview = activePreview;
        activePreview = undefined;
        disposeSandboxProcess(preview.process, preview.cleanup);
        preview.cancelReady?.();
      }
    };
  }, [version.id]);

  return <div className="relative flex h-full justify-center bg-cream/40">
    {url ? <iframe title={`Isolated React preview of version ${version.number}`} src={url} onLoad={() => onPreviewReady(version.id)} referrerPolicy="no-referrer" allow="cross-origin-isolated" className={`h-full border-0 bg-white transition-[width] duration-500 ease-out ${viewport === 'desktop' ? 'w-full' : viewport === 'tablet' ? 'w-[768px] max-w-full' : 'w-[390px] max-w-full'}`} />
      : <div role={error ? 'alert' : 'status'} className="m-auto max-w-lg rounded-2xl bg-white p-5 text-sm text-stone shadow-clay">
        <p className="font-semibold text-charcoal">{error ? 'React preview could not start' : phase === 'installing' ? 'Installing project dependencies in the browser sandbox…' : phase === 'serving' ? 'Starting the project preview…' : 'Booting isolated Node.js sandbox…'}</p>
        {error && <p className="mt-2">{error}</p>}
        {!error && <p className="mt-2">This runs in a browser-based Node.js sandbox, not on the D-GUY server. The sandbox may download the project's declared packages from npm.</p>}
      </div>}
  </div>;
}
