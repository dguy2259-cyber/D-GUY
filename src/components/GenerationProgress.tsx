import { AlertCircle, Check, Circle, Loader2 } from 'lucide-react';
import type { GenerationState } from '@/hooks/useWorkspace';
import { useNow } from '@/hooks/useNow';
import { formatSeconds } from '@/utils/formatSeconds';

interface GenerationProgressProps {
  generation: GenerationState;
}

export function GenerationProgress({ generation }: GenerationProgressProps) {
  const running = generation.status === 'running';
  const now = useNow(running);
  const elapsed = generation.startedAt ? (generation.finishedAt ?? now) - generation.startedAt : 0;
  const serverGeneration = generation.stages.some((stage) => ['planning', 'generating', 'validating', 'saving'].includes(stage.id));

  const title =
    generation.status === 'error'
      ? serverGeneration ? 'Generation failed' : 'Build failed'
      : generation.status === 'complete'
        ? `${serverGeneration ? 'Generation complete' : 'Build complete'} in ${formatSeconds(elapsed)}`
        : serverGeneration
          ? 'Generating project files'
        : generation.kind === 'revise'
          ? 'Applying your change'
          : 'Building your website';

  return (
    <div className="clay-raised animate-fade-up rounded-clay p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{title}</p>
        {running && <span className="font-mono text-xs text-stone">{formatSeconds(elapsed)}</span>}
      </div>

      {generation.saveState === 'retrying' && generation.status !== 'error' && (
        <p role="status" className="mt-3 text-sm text-stone">{generation.saveWarning || 'Saving the generated version in the background.'}</p>
      )}
      {generation.saveState === 'failed' && (
        <p role="alert" className="mt-3 text-sm text-[#8A3A32]">{generation.saveWarning || 'Files generated, but saving failed. Your previous saved version remains active.'}</p>
      )}

      {generation.status === 'error' ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-[#8A3A32]">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {generation.error || (serverGeneration ? 'Generation did not complete. Your last saved version is still available.' : 'The draft could not be prepared. Your previous preview is still available.')}
        </p>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {generation.stages.map((stage, index) => {
            const done = generation.status === 'complete' || index < generation.stageIndex;
            const current = running && index === generation.stageIndex;
            return (
              <li key={stage.id} className={`flex items-center gap-3 text-sm ${done || current ? 'text-charcoal' : 'text-muted'}`}>
                {done ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate text-porcelain">
                    <Check size={12} strokeWidth={3} />
                  </span>
                ) : current ? (
                  <Loader2 size={18} className="animate-spin text-terracotta-deep" />
                ) : (
                  <Circle size={18} className="text-cream" strokeWidth={2.5} />
                )}
                <span className={current ? 'font-semibold' : ''}>{stage.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {running && generation.streamedCharacters > 0 && generation.provider && (
        <p className="mt-3 text-xs text-stone" aria-live="polite">
          {generation.streamedCharacters.toLocaleString()} response characters streamed from {generation.provider === 'groq' ? 'Groq' : generation.provider === 'gemini' ? 'Gemini' : generation.provider === 'openrouter' ? 'OpenRouter' : 'Hugging Face Featherless'}.
        </p>
      )}

      {running && generation.provider && (
        <p className="mt-2 text-xs text-stone" aria-live="polite">
          Active provider: {generation.provider === 'groq' ? 'Groq' : generation.provider === 'gemini' ? 'Gemini' : generation.provider === 'openrouter' ? 'OpenRouter' : 'Hugging Face Featherless'}
          {generation.activeFile ? ` · Generating ${generation.activeFile}` : ''}
        </p>
      )}

      {running && generation.recoveryStatus && (
        <p className="mt-2 text-xs text-terracotta-deep" aria-live="polite">{generation.recoveryStatus}</p>
      )}

      {generation.kind === 'create' && generation.expectedFiles.length > 0 && (
        <div className="mt-4 rounded-xl bg-cream p-3 shadow-clay-inset">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-stone">{generation.status === 'complete' ? 'Project files' : generation.status === 'error' ? 'Incomplete files from failed attempt' : 'Files generated this attempt'}</p>
          <ul className="space-y-1.5 font-mono text-[11px] text-charcoal">
            {generation.expectedFiles.map((path) => {
              const written = generation.status === 'complete';
              const writing = !written && generation.status === 'running' && generation.stages[generation.stageIndex]?.id === 'generating';
              return (
                <li key={path} className="flex items-center gap-2">
                  {written ? (
                    <Check size={12} className="text-slate" />
                  ) : generation.status === 'error' ? (
                    <AlertCircle size={12} className="text-[#8A3A32]" />
                  ) : writing ? (
                    <Loader2 size={12} className="animate-spin text-terracotta-deep" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                  )}
                  <span className="truncate">{path}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
