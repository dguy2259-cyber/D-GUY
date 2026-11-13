import { Hexagon } from 'lucide-react';
import type { ChatMessage as ChatMessageType } from '@/types/project';

export function ChatMessage({ message }: { message: ChatMessageType }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex animate-fade-up gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="clay-raised mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl">
          <Hexagon size={16} className="text-terracotta-deep" strokeWidth={2.2} />
        </div>
      )}
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-clay px-4 py-3 text-sm leading-relaxed shadow-clay ${
          isUser ? 'bg-terracotta-deep text-porcelain' : 'bg-porcelain text-charcoal'
        }`}
      >
        {message.text}
      </div>
    </div>
  );
}
