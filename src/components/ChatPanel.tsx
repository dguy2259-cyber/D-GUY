import { useEffect, useRef, useState } from 'react';
import { Hexagon } from 'lucide-react';
import { ChatMessage } from '@/components/ChatMessage';
import { GenerationProgress } from '@/components/GenerationProgress';
import { PromptInput } from '@/components/PromptInput';
import { RequirementsPanel } from '@/components/RequirementsPanel';
import { backendApi, type UsageStatus } from '@/services/backendApi';
import type { GenerationState } from '@/hooks/useWorkspace';
import type { RequirementOverrides, SiteVersion, WorkspaceProject } from '@/types/project';

const EXAMPLE_PROMPTS = [
  'Modern restaurant website',
  'SaaS analytics dashboard',
  'Personal portfolio',
  'E-commerce storefront',
];

const NO_REQUIREMENTS: RequirementOverrides = { templateId: null, palette: null, testimonials: null, navigation: null };

interface ChatPanelProps {
  project: WorkspaceProject;
  activeVersion: SiteVersion | null;
  generation: GenerationState;
  onSubmit: (text: string, requirements: RequirementOverrides) => void;
}

export function ChatPanel({ project, activeVersion, generation, onSubmit }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [requirements, setRequirements] = useState<RequirementOverrides>(NO_REQUIREMENTS);
  const [usage, setUsage] = useState<UsageStatus | null>(null);
  const [clock, setClock] = useState(Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const running = generation.status === 'running';
  const showProgress = generation.projectId === project.id && generation.status !== 'idle';
  const hasConversation = project.messages.length > 0;

  useEffect(() => {
    let active = true;
    const refresh = () => void backendApi.usage().then((value) => { if (active) setUsage(value); }).catch(() => undefined);
    refresh();
    const poll = window.setInterval(refresh, 20_000);
    const tick = window.setInterval(() => setClock(Date.now()), 1000);
    return () => { active = false; window.clearInterval(poll); window.clearInterval(tick); };
  }, []);

  const countdown = (until?: number) => {
    if (!until) return null;
    const seconds = Math.max(0, Math.ceil((until - clock) / 1000));
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  };
  const rate = usage?.groq?.rateLimit;
  const groqResetAt = usage?.groq?.observedAt && rate?.resetRequestsMs !== undefined ? usage.groq.observedAt + rate.resetRequestsMs : undefined;
  const groqTokenResetAt = usage?.groq?.observedAt && rate?.resetTokensMs !== undefined ? usage.groq.observedAt + rate.resetTokensMs : undefined;
  const cooldown = countdown(usage?.groq?.cooldownUntil);
  const reset = countdown(groqResetAt);
  const tokenReset = countdown(groqTokenResetAt);
  const generationReset = countdown(usage?.nextGenerationAvailableAt ?? undefined);
  const groqState = !usage?.groqConfigured ? 'not configured' : !usage.groq ? 'configured · awaiting API usage' : cooldown ? `cooldown ${cooldown}` : usage.groqProviderState === 'unavailable' ? 'provider error' : 'ready';

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [project.messages.length, generation.stageIndex, generation.status]);

  const handleSubmit = (composed: string) => {
    onSubmit(composed, requirements);
    setDraft('');
  };

  return (
    <section aria-label="D-GUY AI chat" className="flex h-full min-h-0 flex-col bg-cream/50">
      <header className="shrink-0 px-5 pb-3 pt-5 lg:px-6">
        <h2 className="text-xl font-bold tracking-tight">Build with D-GUY</h2>
        <p className="mt-1 text-sm text-stone">Generate and revise project files in your private workspace.</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-porcelain px-3 py-2 text-[11px] text-stone shadow-clay" aria-live="polite">
          <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${!usage?.groqConfigured || usage?.groqProviderState === 'unavailable' ? 'bg-muted' : cooldown ? 'bg-terracotta' : 'bg-emerald-500'}`} />Groq {usage ? groqState : 'checking'}</span>
          <span>Groq API requests: {rate?.remainingRequests ?? '—'}{rate?.limitRequests ? ` / ${rate.limitRequests}` : ''}{reset ? ` · reset ${reset}` : ''}</span>
          <span>Groq tokens/min: {rate?.remainingTokens ?? '—'}{rate?.limitTokens ? ` / ${rate.limitTokens}` : ''}{tokenReset ? ` · reset ${tokenReset}` : ''}</span>
          <span>Website generations: {usage ? `${Math.max(0, usage.dailyGenerationLimit - usage.generationsLast24Hours)} / ${usage.dailyGenerationLimit} in last 24h${generationReset ? ` · available in ${generationReset}` : ''}` : 'loading'}</span>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 pb-4 scrollbar-soft lg:px-6">
        <div className="flex gap-3">
          <div className="clay-raised mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
            <Hexagon size={16} className="text-terracotta-deep" strokeWidth={2.2} />
          </div>
          <div className="max-w-[85%] rounded-clay bg-porcelain px-4 py-3 text-sm leading-relaxed text-charcoal shadow-clay">
            Describe the project and requested changes. D-GUY saves generated source files and version history.
          </div>
        </div>

        {!hasConversation && (
          <div className="pl-11">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone">Try an example</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => setDraft(prompt)}
                  className="clay-soft-button !rounded-full px-3.5 py-2 text-left text-xs font-medium"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {project.messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {showProgress && (
          <div className="pl-11">
            <GenerationProgress generation={generation} />
          </div>
        )}
      </div>

      <footer className="shrink-0 space-y-3 border-t border-cream bg-porcelain/70 p-4 lg:px-6">
        {!activeVersion && <RequirementsPanel value={requirements} onChange={setRequirements} />}
        <PromptInput
          value={draft}
          onChange={setDraft}
          onSubmit={handleSubmit}
          disabled={running}
          submitLabel={activeVersion ? 'Generate revision' : 'Generate code'}
          placeholder={
            activeVersion
              ? 'Describe a source code change to make...'
              : 'Describe the website you want to build...'
          }
        />
      </footer>
    </section>
  );
}
