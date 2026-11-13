import { useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { Paperclip, Sparkles, X } from 'lucide-react';

const MAX_ATTACHMENT_BYTES = 200_000;
const MAX_ATTACHMENT_CHARS = 4000;

interface Attachment {
  name: string;
  text: string;
}

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (composed: string) => void;
  disabled: boolean;
  submitLabel: string;
  placeholder: string;
}

export function PromptInput({ value, onChange, onSubmit, disabled, submitLabel, placeholder }: PromptInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  const canSubmit = value.trim().length > 0 && !disabled;

  const submit = () => {
    if (!canSubmit) return;
    const composed = attachment
      ? `${value.trim()}\n\nReference from ${attachment.name}:\n${attachment.text}`
      : value.trim();
    onSubmit(composed);
    setAttachment(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setAttachError('That file is too large. Attach a brief under 200 KB.');
      return;
    }
    const text = await file.text();
    setAttachError(null);
    setAttachment({ name: file.name, text: text.slice(0, MAX_ATTACHMENT_CHARS) });
  };

  return (
    <div className="clay-inset rounded-clay p-3">
      <label htmlFor="prompt-input" className="sr-only">Describe the website</label>
      <textarea
        id="prompt-input"
        rows={3}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="block max-h-40 min-h-[72px] w-full resize-none bg-transparent px-1 text-sm leading-relaxed text-charcoal placeholder:text-muted focus:outline-none disabled:opacity-60"
      />

      {attachment && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-porcelain px-3 py-2 text-xs shadow-clay">
          <span className="flex min-w-0 items-center gap-2">
            <Paperclip size={14} className="shrink-0 text-stone" />
            <span className="truncate font-medium">{attachment.name}</span>
          </span>
          <button
            type="button"
            onClick={() => setAttachment(null)}
            aria-label={`Remove ${attachment.name}`}
            className="rounded-lg p-1 text-stone transition hover:bg-cream hover:text-charcoal"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {attachError && <p className="mt-2 text-xs text-[#8A3A32]">{attachError}</p>}

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.csv,.json"
            className="hidden"
            onChange={handleFile}
            aria-label="Attach a brief"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="clay-soft-button h-10 w-10 !rounded-xl !p-0"
            aria-label="Attach a text brief"
            title="Attach a text brief (.txt, .md, .csv, .json)"
          >
            <Paperclip size={16} />
          </button>
          <span className="hidden text-xs text-stone sm:inline">Enter to send</span>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="clay-button h-11 px-5 text-sm"
        >
          <Sparkles size={16} />
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
