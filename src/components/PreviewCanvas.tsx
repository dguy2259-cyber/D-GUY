import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Blocks } from 'lucide-react';
import { detectWebContainerProject } from '@/services/webcontainerFiles';
import { localAssetDataUrl, rewriteLocalCssAssets } from '@/services/previewAssets';
import type { ProjectFile, RuntimeErrorReport, SiteVersion, ViewportMode } from '@/types/project';

const WebContainerPreview = lazy(() => import('@/components/WebContainerPreview').then((module) => ({ default: module.WebContainerPreview })));
const ignoreRuntimeError = () => undefined;
const ignorePreviewReady = () => undefined;

const VIEWPORT_WIDTH: Record<ViewportMode, string> = {
  desktop: 'w-full',
  tablet: 'w-[768px] max-w-full',
  mobile: 'w-[390px] max-w-full',
};

interface PreviewCanvasProps {
  version: SiteVersion | null;
  viewport: ViewportMode;
  refreshKey: number;
  buildingLabel: string | null;
  onRuntimeError?: (report: RuntimeErrorReport) => void;
  onPreviewReady?: (versionId: string) => void;
}

export function PreviewCanvas({ version, viewport, refreshKey, buildingLabel, onRuntimeError = ignoreRuntimeError, onPreviewReady = ignorePreviewReady }: PreviewCanvasProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [layoutAudit, setLayoutAudit] = useState<{ width: number; overflow: number } | null>(null);
  const reportedErrors = useRef(new Set<string>());
  const reportWebContainerError = useCallback((report: RuntimeErrorReport) => {
    setRuntimeError(report.message.slice(0, 300));
    onRuntimeError(report);
  }, [onRuntimeError]);
  useEffect(() => {
    setRuntimeError(null);
    setLayoutAudit(null);
    reportedErrors.current.clear();
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      const payload = event.data as { type?: unknown; category?: unknown; message?: unknown; stackTrace?: unknown; sourceFile?: unknown; line?: unknown; column?: unknown };
      if (payload.type === 'dguy:preview-layout' && 'width' in event.data && 'overflow' in event.data) {
        const layout = event.data as { width: unknown; overflow: unknown };
        if (Number.isFinite(layout.width) && Number.isFinite(layout.overflow)) {
          const width = Number(layout.width);
          const overflow = Number(layout.overflow);
          setLayoutAudit({ width, overflow });
          if (overflow > 1 && version?.id) {
            const report: RuntimeErrorReport = {
              versionId: version.id,
              environment: 'sandbox_html',
              category: 'runtime',
              message: `Responsive layout overflow at ${width}px: content extends ${overflow}px beyond the viewport.`,
            };
            const key = `responsive_overflow:${width}:${overflow}`;
            if (!reportedErrors.current.has(key)) {
              reportedErrors.current.add(key);
              onRuntimeError(report);
            }
          }
        }
        return;
      }
      if (payload.type === 'dguy:preview-error' && typeof payload.message === 'string' && version?.id) {
        const category = payload.category === 'unhandled_rejection' ? 'unhandled_rejection' : 'runtime';
        const report: RuntimeErrorReport = {
          versionId: version.id,
          environment: 'sandbox_html',
          category,
          message: payload.message.slice(0, 2_000),
          ...(typeof payload.stackTrace === 'string' ? { stackTrace: payload.stackTrace.slice(0, 6_000) } : {}),
          ...(typeof payload.sourceFile === 'string' ? { sourceFile: payload.sourceFile.slice(0, 500) } : {}),
          ...(typeof payload.line === 'number' && Number.isInteger(payload.line) && payload.line > 0 ? { line: payload.line } : {}),
          ...(typeof payload.column === 'number' && Number.isInteger(payload.column) && payload.column > 0 ? { column: payload.column } : {}),
        };
        const key = `${report.category}:${report.sourceFile ?? ''}:${report.message}`;
        if (reportedErrors.current.has(key)) return;
        reportedErrors.current.add(key);
        setRuntimeError(report.message.slice(0, 300));
        onRuntimeError(report);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [version?.id, refreshKey, onRuntimeError]);

  if (!version) {
    return buildingLabel ? <BuildingSkeleton label={buildingLabel} /> : <EmptyPreview />;
  }

  if (version.files.some((file) => file.path === 'package.json')) {
    if (detectWebContainerProject(version.files)) {
      return <Suspense fallback={<div role="status" className="flex h-full items-center justify-center text-sm text-stone">Loading browser runtime…</div>}><WebContainerPreview version={version} viewport={viewport} onRuntimeError={reportWebContainerError} onPreviewReady={onPreviewReady} /></Suspense>;
    }
    return <div role="status" className="flex h-full flex-col items-center justify-center bg-porcelain px-7 text-center">
      <div className="clay-raised max-w-md rounded-2xl p-6">
        <Blocks size={30} className="mx-auto text-terracotta-deep" />
        <p className="mt-4 text-base font-semibold">React source is ready</p>
        <p className="mt-2 text-sm leading-relaxed text-stone">Add React and a supported Vite, Next.js, or react-scripts dev/start script to package.json to run this project in the browser sandbox.</p>
      </div>
    </div>;
  }

  if (version.previewMode === 'sandbox-html') {
    const html = version.files.find((file) => file.path.toLowerCase() === 'index.html')?.content;
    if (html) return <div className="relative flex h-full justify-center bg-cream/40">
      <iframe
        ref={iframeRef}
        key={`${version.id}-${refreshKey}`}
        title={`Sandboxed preview of version ${version.number}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={createSandboxDocument(html, version.files)}
        onLoad={() => onPreviewReady(version.id)}
        className={`h-full border-0 bg-white transition-[width] duration-500 ease-out ${VIEWPORT_WIDTH[viewport]}`}
      />
      {runtimeError && <div role="alert" className="absolute inset-x-3 top-3 max-w-xl rounded-xl border border-red-200 bg-red-50/95 p-3 text-sm text-red-900 shadow-lg">
        <p className="font-semibold">Preview runtime error</p>
        <p className="mt-1 break-words">{runtimeError}</p>
      </div>}
      {layoutAudit && <div role={layoutAudit.overflow ? 'alert' : 'status'} className={`absolute inset-x-3 bottom-3 rounded-lg px-3 py-2 text-xs shadow ${layoutAudit.overflow ? 'bg-red-50/95 text-red-900' : 'bg-white/90 text-stone'}`}>
        {layoutAudit.overflow ? `Responsive check: content exceeds the ${layoutAudit.width}px viewport by ${layoutAudit.overflow}px.` : `Responsive check passed at ${layoutAudit.width}px.`}
      </div>}
    </div>;
  }

  if (version.previewMode === 'static-files') {
    return <div className="flex h-full flex-col items-center justify-center bg-porcelain px-7 text-center">
      <div className="clay-raised rounded-2xl p-6">
        <Blocks size={30} className="mx-auto text-terracotta-deep" />
        <p className="mt-4 text-base font-semibold">Static code is ready</p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-stone">Generated files are available in Code and Files. D-GUY does not execute arbitrary generated code in this preview.</p>
      </div>
    </div>;
  }

  return <div className="flex h-full flex-col items-center justify-center bg-porcelain px-7 text-center">
    <div className="clay-raised rounded-2xl p-6">
      <Blocks size={30} className="mx-auto text-terracotta-deep" />
      <p className="mt-4 text-base font-semibold">Preview unavailable</p>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-stone">This version does not contain an index.html entry point. Its source files are available in Code and Files.</p>
    </div>
  </div>;
}

function createSandboxDocument(html: string, files: ProjectFile[]) {
  const fileMap = new Map(files.map((file) => [file.path, file.content]));
  const source = new DOMParser().parseFromString(html, 'text/html');
  source.querySelectorAll('base, meta[http-equiv="refresh" i]').forEach((element) => element.remove());

  const resolveLocal = (reference: string) => {
    if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return undefined;
    let path = reference.split(/[?#]/, 1)[0] ?? '';
    try { path = decodeURIComponent(path); } catch { return undefined; }
    path = path.replace(/^\/+/, '').replace(/^\.\//, '');
    if (!path || path.split('/').some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) return undefined;
    return path;
  };
  const allowedExternal = (reference: string) => {
    try { const url = new URL(reference, window.location.href); return url.protocol === 'https:' && ['cdn.tailwindcss.com', 'esm.sh'].includes(url.hostname); }
    catch { return false; }
  };

  source.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]').forEach((link) => {
    const reference = link.getAttribute('href') ?? '';
    if (resolveLocal(reference) || !allowedExternal(reference)) link.remove();
  });
  source.querySelectorAll<HTMLLinkElement>('link[rel~="preconnect"][href], link[rel~="dns-prefetch"][href], link[rel~="prefetch"][href]').forEach((link) => {
    if (!resolveLocal(link.getAttribute('href') ?? '')) link.remove();
  });
  const offlineImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#153b82"/><stop offset="1" stop-color="#08152e"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="880" cy="240" r="200" fill="#31baff" opacity=".18"/><path d="M0 650 360 360l210 180 220-250 410 350v160H0z" fill="#34baff" opacity=".16"/></svg>')}`;
  source.querySelectorAll<Element>('img[src], source[srcset]').forEach((element) => {
    const image = element instanceof HTMLImageElement ? element : element.parentElement?.closest('img');
    if (!image) { element.removeAttribute('srcset'); return; }
    const reference = image.getAttribute('src') ?? '';
    const embedded = localAssetDataUrl(reference, '', files);
    if (embedded) { image.setAttribute('src', embedded); image.removeAttribute('srcset'); return; }
    image.removeAttribute('srcset');
    image.setAttribute('src', offlineImage);
  });
  source.querySelectorAll<HTMLScriptElement>('script[src]').forEach((script) => {
    const reference = script.getAttribute('src') ?? '';
    const localPath = resolveLocal(reference);
    if (localPath) {
      const content = fileMap.get(localPath);
      if (content === undefined) { script.remove(); return; }
      script.removeAttribute('src');
      script.textContent = content;
      return;
    }
    if (!allowedExternal(reference)) script.remove();
  });

  const styleTag = source.createElement('style');
  styleTag.dataset.dguyProjectStyles = 'true';
  styleTag.textContent = files.filter((file) => /\.css$/i.test(file.path)).map((file) => rewriteLocalCssAssets(file.content, file.path, files)).join('\n').replace(/<\/style/gi, '<\\/style');
  source.querySelectorAll('style').forEach((style) => { style.textContent = rewriteLocalCssAssets(style.textContent ?? '', 'index.html', files); });
  source.querySelectorAll<HTMLElement>('[style]').forEach((element) => { element.setAttribute('style', rewriteLocalCssAssets(element.getAttribute('style') ?? '', 'index.html', files)); });
  const reporter = source.createElement('script');
  reporter.textContent = `(()=>{const send=(category,message,detail)=>{try{parent.postMessage({type:'dguy:preview-error',category,message:String(message).slice(0,2000),stackTrace:String(detail?.stack||'').slice(0,6000),sourceFile:String(detail?.filename||'').slice(0,500),line:Number(detail?.lineno)||undefined,column:Number(detail?.colno)||undefined},'*')}catch{}};addEventListener('error',event=>{if(event instanceof ErrorEvent&&event.message)send('runtime',event.message,event)},true);addEventListener('unhandledrejection',event=>{const reason=event.reason;if(reason instanceof Error)send('unhandled_rejection',reason.message,reason);else if(typeof reason==='string'&&reason)send('unhandled_rejection',reason,{})},true)})()`;
  const layoutReporter = source.createElement('script');
  layoutReporter.textContent = `(()=>{let timer;const check=()=>{const root=document.documentElement;const body=document.body;const width=root.clientWidth||innerWidth;const clipped=element=>{for(let ancestor=element.parentElement;ancestor&&ancestor!==body;ancestor=ancestor.parentElement){const overflow=getComputedStyle(ancestor).overflowX;if(overflow==='hidden'||overflow==='clip')return true}return false};let maxRight=width;let minLeft=0;for(const element of document.querySelectorAll('body *')){const style=getComputedStyle(element);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)continue;const rect=element.getBoundingClientRect();if(rect.width&&rect.height&&!clipped(element)){if(rect.right>width+1)maxRight=Math.max(maxRight,rect.right);if(rect.left< -1)minLeft=Math.min(minLeft,rect.left)}}const documentOverflow=Math.max(root.scrollWidth,body.scrollWidth)-width;const overflow=Math.max(0,Math.ceil(maxRight-width),Math.ceil(-minLeft),Math.ceil(documentOverflow));try{parent.postMessage({type:'dguy:preview-layout',width,overflow},'*')}catch{}};addEventListener('load',()=>setTimeout(check,650));addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(check,650)});setTimeout(check,650)})()`;
  const csp = source.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://esm.sh; style-src 'unsafe-inline' https://cdn.tailwindcss.com; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
  source.head.prepend(styleTag);
  source.head.prepend(layoutReporter);
  source.head.prepend(reporter);
  source.head.prepend(csp);
  return `<!doctype html>${source.documentElement.outerHTML}`;
}

function EmptyPreview() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-porcelain px-6 py-10 text-center">
      <div className="clay-raised w-full max-w-xs rounded-2xl p-4" aria-hidden="true">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-peach" />
          <span className="h-2 w-2 rounded-full bg-cream" />
          <span className="h-2 w-2 rounded-full bg-slate/50" />
        </div>
        <div className="mt-4 rounded-xl bg-cream p-4 shadow-clay-inset">
          <div className="h-2.5 w-1/3 rounded-full bg-peach" />
          <div className="mt-3 h-2 w-4/5 rounded-full bg-porcelain" />
          <div className="mt-2 h-2 w-3/5 rounded-full bg-porcelain" />
          <div className="mt-4 flex gap-2">
            <div className="h-7 w-20 rounded-lg bg-terracotta-deep/80" />
            <div className="h-7 w-16 rounded-lg bg-porcelain" />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="h-12 rounded-lg bg-porcelain shadow-clay" />
          <div className="h-12 rounded-lg bg-porcelain shadow-clay" />
          <div className="h-12 rounded-lg bg-porcelain shadow-clay" />
        </div>
      </div>
      <div>
        <p className="text-lg font-semibold">Your website will appear here.</p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-stone">
          Enter your requirements and let D-GUY build your first draft.
        </p>
      </div>
    </div>
  );
}

function BuildingSkeleton({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-porcelain px-6 text-center">
      <div className="clay-raised flex h-14 w-14 items-center justify-center rounded-2xl">
        <Blocks size={24} className="animate-pulse-dot text-terracotta-deep" />
      </div>
      <div className="w-full max-w-md space-y-3" aria-hidden="true">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="h-10 animate-pulse-dot rounded-xl bg-cream shadow-clay-inset"
          />
        ))}
      </div>
      <p className="text-sm font-semibold text-stone">{label}</p>
    </div>
  );
}
