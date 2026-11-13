import { ExternalLink, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ViewportMode } from '@/types/project';

const VIEWPORTS: { mode: ViewportMode; label: string; icon: LucideIcon }[] = [
  { mode: 'desktop', label: 'Desktop preview', icon: Monitor },
  { mode: 'tablet', label: 'Tablet preview', icon: Tablet },
  { mode: 'mobile', label: 'Mobile preview', icon: Smartphone },
];

interface ViewportSwitchProps {
  viewport: ViewportMode;
  onChange: (mode: ViewportMode) => void;
}

export function ViewportSwitch({ viewport, onChange }: ViewportSwitchProps) {
  return (
    <div className="clay-inset flex items-center gap-1 rounded-2xl p-1" role="group" aria-label="Viewport size">
      {VIEWPORTS.map(({ mode, label, icon: Icon }) => {
        const active = viewport === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            aria-label={label}
            aria-pressed={active}
            title={label}
            className={`flex h-8 w-9 items-center justify-center rounded-xl transition duration-150 ${
              active ? 'bg-porcelain text-terracotta-deep shadow-clay' : 'text-stone hover:text-charcoal'
            }`}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </div>
  );
}

interface BrowserToolbarProps {
  address: string;
  onRefresh: () => void;
  onOpen: () => void;
  canOpen: boolean;
}

export function BrowserToolbar({ address, onRefresh, onOpen, canOpen }: BrowserToolbarProps) {
  return (
    <div className="flex items-center gap-3 border-b border-cream bg-porcelain px-3 py-2.5">
      <div className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-peach" />
        <span className="h-2.5 w-2.5 rounded-full bg-cream" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate/50" />
      </div>
      <div className="clay-inset flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-1.5 font-mono text-xs text-stone">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate" aria-hidden="true" />
        <span className="truncate" title={address}>{address}</span>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={!canOpen}
        aria-label="Refresh preview"
        title="Refresh preview"
        className="clay-soft-button h-9 w-9 shrink-0 !rounded-xl !p-0"
      >
        <RefreshCw size={15} />
      </button>
      <button
        type="button"
        onClick={onOpen}
        disabled={!canOpen}
        className="clay-soft-button h-9 shrink-0 !rounded-xl px-3 text-xs"
      >
        <ExternalLink size={14} />
        <span className="hidden md:inline">Open preview</span>
      </button>
    </div>
  );
}
