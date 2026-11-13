import type { PreviewStatus } from '@/types/project';

const STATUS_STYLES: Record<PreviewStatus, { label: string; dot: string; text: string; background: string }> = {
  ready: { label: 'Ready', dot: 'bg-slate', text: 'text-stone', background: 'bg-cream' },
  generating: { label: 'Generating', dot: 'bg-terracotta animate-pulse-dot', text: 'text-terracotta-deep', background: 'bg-peach/40' },
  'preview-ready': { label: 'Preview Ready', dot: 'bg-slate', text: 'text-charcoal', background: 'bg-cream' },
  error: { label: 'Error', dot: 'bg-[#A4493F]', text: 'text-[#8A3A32]', background: 'bg-[#F3DDD8]' },
};

export function StatusBadge({ status }: { status: PreviewStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold shadow-clay-inset ${style.background} ${style.text}`}
    >
      <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden="true" />
      {style.label}
    </span>
  );
}
