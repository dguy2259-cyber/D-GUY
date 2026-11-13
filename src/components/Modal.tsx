import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Modal({ title, description, onClose, children }: ModalProps) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close dialog" onClick={onClose} className="absolute inset-0 bg-charcoal/25 backdrop-blur-none" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="clay-raised relative flex max-h-[85vh] w-full max-w-lg animate-fade-up flex-col rounded-clay-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-cream px-6 py-5">
          <div>
            <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
            {description && <p className="mt-1 text-sm text-stone">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="clay-soft-button h-9 w-9 shrink-0 !rounded-xl !p-0"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5 scrollbar-soft">{children}</div>
      </div>
    </div>
  );
}
