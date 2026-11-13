import { useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import type { RequirementOverrides, TemplateId } from '@/types/project';
import type { PaletteId } from '@/theme/palettes';
import { palettes } from '@/theme/palettes';
import { TEMPLATE_LABELS } from '@/services/projectConfig';

interface RequirementsPanelProps {
  value: RequirementOverrides;
  onChange: (value: RequirementOverrides) => void;
}

const TEMPLATE_IDS = Object.keys(TEMPLATE_LABELS) as TemplateId[];
const PALETTE_IDS = Object.keys(palettes) as PaletteId[];

const selectClass =
  'clay-inset w-full rounded-xl px-3 py-2 text-sm text-charcoal focus:outline-none focus:ring-2 focus:ring-terracotta/40';

export function RequirementsPanel({ value, onChange }: RequirementsPanelProps) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-2xl px-1">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-xs font-semibold text-stone transition hover:text-charcoal"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal size={14} />
          Website options
        </span>
        <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 grid animate-fade-up gap-3 px-1 pb-1 sm:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1.5 text-xs font-semibold text-stone">
            Website type
            <select
              className={selectClass}
              value={value.templateId ?? 'auto'}
              onChange={(event) =>
                onChange({ ...value, templateId: event.target.value === 'auto' ? null : (event.target.value as TemplateId) })
              }
            >
              <option value="auto">Auto-detect</option>
              {TEMPLATE_IDS.map((id) => (
                <option key={id} value={id}>{TEMPLATE_LABELS[id]}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-stone">
            Theme
            <select
              className={selectClass}
              value={value.palette ?? 'auto'}
              onChange={(event) =>
                onChange({ ...value, palette: event.target.value === 'auto' ? null : (event.target.value as PaletteId) })
              }
            >
              <option value="auto">Auto-select</option>
              {PALETTE_IDS.map((id) => (
                <option key={id} value={id}>{palettes[id].name}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-stone">
            Top menu bar
            <select
              className={selectClass}
              value={value.menuBar === null ? 'auto' : value.menuBar ? 'yes' : 'no'}
              onChange={(event) =>
                onChange({ ...value, menuBar: event.target.value === 'auto' ? null : event.target.value === 'yes' })
              }
            >
              <option value="auto">Auto-detect</option>
              <option value="yes">Include menu</option>
              <option value="no">No menu bar</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-stone">
            Testimonials
            <select
              className={selectClass}
              value={value.testimonials === null ? 'auto' : value.testimonials ? 'yes' : 'no'}
              onChange={(event) =>
                onChange({
                  ...value,
                  testimonials: event.target.value === 'auto' ? null : event.target.value === 'yes',
                })
              }
            >
              <option value="auto">Auto</option>
              <option value="yes">Include section</option>
              <option value="no">Leave out</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
