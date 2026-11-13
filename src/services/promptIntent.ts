import type { ChatMessage } from '../types/project';

export type PromptIntent =
  | { kind: 'build'; prompt: string }
  | { kind: 'retry'; prompt: string }
  | { kind: 'chat'; reply: string };

const RETRY_PATTERN = /^(?:retry|try again|regenerate|redo(?: it)?|again)[.!?\s]*$/i;
const GREETING_PATTERN = /^(?:hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)[.!?\s]*$/i;
const BUILD_ACTION_PATTERN = /\b(?:create|build|make|generate|design|develop|implement|write|code|add|update|change|modify|fix|improve|redesign|revise|replace|remove|convert|refactor|optimize)\b/i;
const PROJECT_TARGET_PATTERN = /\b(?:website|web site|webpage|web page|landing page|web app|application|dashboard|portfolio|storefront|e-?commerce|single-page site|single page website|site)\b/i;
const QUESTION_PATTERN = /^(?:what|why|when|where|who|how|can|could|would|should|is|are|do|does|did)\b/i;

const FAQS: Array<{ pattern: RegExp; reply: string }> = [
  {
    pattern: /\b(?:what can you do|what do you do|what is d-guy|how do i use d-guy|help)\b/i,
    reply: 'I can create a website or web app from a clear prompt, stream its files into Code and Files, show a sandboxed preview, and save successful versions to your project. Describe what you want to build or change to start.',
  },
  {
    pattern: /\b(?:how do i deploy|how can i deploy|deployment|deploy my (?:site|website|project))\b/i,
    reply: 'Open the generated project and choose Deploy files to download the deployment configuration. You can also download the project ZIP and deploy it with your hosting provider.',
  },
  {
    pattern: /\b(?:how (?:does|do) (?:the )?preview work|live preview|is the preview safe)\b/i,
    reply: 'D-GUY renders static HTML in an isolated iframe with network access blocked. Supported React and Next.js projects run in the browser WebContainer, not on the D-GUY server.',
  },
  {
    pattern: /\b(?:how do i save|where are projects saved|save my project|version history)\b/i,
    reply: 'Successful generations are saved to your project and appear in version history. Use the project menu to switch projects, and the download button to export a ZIP.',
  },
];

export function classifyPrompt(text: string, lastBuildPrompt?: string): PromptIntent {
  const prompt = text.trim();
  if (!prompt) return { kind: 'chat', reply: 'Describe a website or code change and I can help build it.' };

  if (RETRY_PATTERN.test(prompt)) {
    return lastBuildPrompt?.trim()
      ? { kind: 'retry', prompt: lastBuildPrompt.trim() }
      : { kind: 'chat', reply: 'There is no earlier build prompt in this project to retry. Describe the website or change you want to build.' };
  }

  for (const faq of FAQS) {
    if (faq.pattern.test(prompt)) return { kind: 'chat', reply: faq.reply };
  }

  if (GREETING_PATTERN.test(prompt)) {
    return { kind: 'chat', reply: 'Hi! Tell me what kind of website or app you would like to create, or ask how D-GUY works.' };
  }

  const hasBuildAction = BUILD_ACTION_PATTERN.test(prompt);
  const isQuestion = prompt.includes('?') || QUESTION_PATTERN.test(prompt);
  const isQuestionOnly = isQuestion && !hasBuildAction;
  if (isQuestionOnly) {
    return {
      kind: 'chat',
      reply: 'I can answer questions about D-GUY, or build something when you describe a website or code change. Try asking how preview, saving, or deployment works.',
    };
  }

  if (hasBuildAction || PROJECT_TARGET_PATTERN.test(prompt)) return { kind: 'build', prompt };
  return {
    kind: 'chat',
    reply: 'To start a generation, describe the website or code change you want. You can also ask about D-GUY, preview, saving, or deployment.',
  };
}

export function findLastBuildPrompt(messages: ChatMessage[], versionPrompt?: string): string | undefined {
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue;
    const intent = classifyPrompt(message.text);
    if (intent.kind === 'build') return intent.prompt;
  }
  return versionPrompt?.trim() || undefined;
}
