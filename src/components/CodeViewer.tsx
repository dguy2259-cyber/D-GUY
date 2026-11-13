import { useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

const TOKEN_PATTERN =
  /(\/\/.*|\/\*.*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b(?:import|export|from|default|const|let|var|function|return|if|else|interface|type|as|new|null|undefined|true|false|for|of|while|async|await|extends|typeof|class)\b)|(\b\d+(?:\.\d+)?\b)|(<\/?[A-Za-z][\w.]*)/g;

const TOKEN_CLASSES = [
  'italic text-[#A8A098]',
  'text-[#B5D0E6]',
  'font-semibold text-[#E8B8A5]',
  'text-[#F2C9A6]',
  'text-[#E8B8A5]',
];

function highlightLine(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(line.slice(cursor, start));
    const groupIndex = match.slice(1).findIndex((group) => group !== undefined);
    nodes.push(
      <span key={`${start}-${groupIndex}`} className={TOKEN_CLASSES[groupIndex]}>
        {match[0]}
      </span>,
    );
    cursor = start + match[0].length;
  }
  if (cursor < line.length) nodes.push(line.slice(cursor));
  return nodes;
}

interface CodeViewerProps {
  path: string;
  content: string;
}

export function CodeViewer({ path, content }: CodeViewerProps) {
  const [copied, setCopied] = useState(false);
  const lines = content.split('\n');

  const copyCode = () => {
    navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => setCopied(false));
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-charcoal shadow-clay-inset">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
        <span className="truncate font-mono text-xs text-porcelain/80">{path}</span>
        <button
          type="button"
          onClick={copyCode}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-porcelain transition hover:bg-white/20"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy code'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-soft">
        <pre className="font-mono text-[12px] leading-6 text-porcelain">
          <code>
            {lines.map((line, index) => (
              <div key={index} className="flex">
                <span className="w-12 shrink-0 select-none pr-4 text-right text-[#A8A098]">{index + 1}</span>
                <span className="whitespace-pre pr-6">{highlightLine(line)}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}
