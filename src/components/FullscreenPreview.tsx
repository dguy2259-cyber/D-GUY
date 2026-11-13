import { useEffect } from 'react';
import { ViewportSwitch } from '@/components/BrowserToolbar';
import { PreviewCanvas } from '@/components/PreviewCanvas';
import type { SiteVersion, ViewportMode } from '@/types/project';
import { X } from 'lucide-react';

interface FullscreenPreviewProps {
  version: SiteVersion;
  viewport: ViewportMode;
  onViewportChange: (mode: ViewportMode) => void;
  onClose: () => void;
}

export function FullscreenPreview({ version, viewport, onViewportChange, onClose }: FullscreenPreviewProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Full screen preview" className="fixed inset-0 z-50 flex animate-fade-up flex-col gap-3 bg-ivory p-3 md:p-5">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <p className="truncate text-sm font-semibold">{version.templateId}-v{version.number} preview</p>
        <div className="flex items-center gap-2">
          <ViewportSwitch viewport={viewport} onChange={onViewportChange} />
          <button type="button" onClick={onClose} aria-label="Close full screen preview" className="clay-soft-button h-10 w-10 !rounded-xl !p-0">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="clay-raised min-h-0 flex-1 overflow-hidden rounded-clay-lg">
        <PreviewCanvas version={version} viewport={viewport} refreshKey={0} buildingLabel={null} />
      </div>
    </div>
  );
}
