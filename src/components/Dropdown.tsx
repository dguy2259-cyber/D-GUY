import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface DropdownProps {
  trigger: ReactNode;
  triggerClassName: string;
  label: string;
  align?: 'left' | 'right';
  children: (close: () => void) => ReactNode;
}

export function Dropdown({ trigger, triggerClassName, label, align = 'left', children }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`clay-raised absolute top-full z-40 mt-2 min-w-[240px] animate-fade-up rounded-clay p-2 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  icon?: ReactNode;
  label: string;
  detail?: string;
  active?: boolean;
  onSelect: () => void;
}

export function MenuItem({ icon, label, detail, active = false, onSelect }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-cream ${active ? 'bg-cream font-semibold text-terracotta-deep' : 'text-charcoal'}`}
    >
      {icon && <span className="shrink-0 text-stone">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail && <span className="block truncate text-xs text-stone">{detail}</span>}
      </span>
    </button>
  );
}
