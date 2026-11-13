import { describe, expect, it } from 'vitest';
import { classifyPrompt, findLastBuildPrompt } from '../../../src/services/promptIntent.js';

describe('prompt intent routing', () => {
  it('answers greetings and product questions without classifying them as builds', () => {
    expect(classifyPrompt('hi')).toMatchObject({ kind: 'chat' });
    expect(classifyPrompt('What can you do?')).toMatchObject({ kind: 'chat', reply: expect.stringContaining('create a website') });
    expect(classifyPrompt('How do I deploy?')).toMatchObject({ kind: 'chat', reply: expect.stringContaining('Deploy files') });
  });

  it('routes retry to the last real project build prompt, not the latest chat message', () => {
    const messages = [
      { id: '1', role: 'user' as const, text: 'Create a responsive coffee shop website.' },
      { id: '2', role: 'user' as const, text: 'hi' },
      { id: '3', role: 'user' as const, text: 'How do I deploy?' },
    ];
    const lastPrompt = findLastBuildPrompt(messages);
    expect(classifyPrompt('retry', lastPrompt)).toEqual({ kind: 'retry', prompt: 'Create a responsive coffee shop website.' });
  });

  it('routes concrete create and modify requests to generation', () => {
    expect(classifyPrompt('Create a premium single-page website for Nexora Technologies.').kind).toBe('build');
    expect(classifyPrompt('Add a responsive mobile navigation and contact form.').kind).toBe('build');
    expect(classifyPrompt('Can you explain how I should deploy this?').kind).toBe('chat');
  });

  it('does not start generation for a retry when the project has no prior build prompt', () => {
    expect(classifyPrompt('try again')).toMatchObject({ kind: 'chat' });
  });
});
