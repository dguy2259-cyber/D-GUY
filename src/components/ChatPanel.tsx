import { useEffect, useRef, useState } from 'react';
import { Hexagon } from 'lucide-react';
import { ChatMessage } from '@/components/ChatMessage';
import { GenerationProgress } from '@/components/GenerationProgress';
import { PromptInput } from '@/components/PromptInput';
import { RequirementsPanel } from '@/components/RequirementsPanel';
import type { GenerationState } from '@/hooks/useWorkspace';
import type { RequirementOverrides, SiteVersion, WorkspaceProject } from '@/types/project';

const EXAMPLE_PROMPTS = [
  'Modern restaurant website',
  'SaaS analytics dashboard',
  'Personal portfolio',
  'E-commerce storefront',
];

const NO_REQUIREMENTS: RequirementOverrides = { templateId: null, palette: null, testimonials: null, menuBar: null };

interface ChatPanelProps {
  project: WorkspaceProject;
  activeVersion: SiteVersion | null;
  generation: GenerationState;
  onSubmit: (text: string, requirements: RequirementOverrides) => void;
}

export function ChatPanel({ project, activeVersion, generation, onSubmit }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [requirements, setRequirements] = useState<RequirementOverrides>(NO_REQUIREMENTS);
  const scrollRef = useRef<HTMLDivElement>(null);
  const running = generation.status === 'running';
  const showProgress = generation.projectId === project.id && generation.status !== 'idle';
  const hasConversation = project.messages.length > 0;

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
