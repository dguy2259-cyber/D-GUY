import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearProviderHealthForTests, JsonContentFieldStreamer, generateWithFallback, generateWithGemini, generateWithGroq, generateWithOpenRouter, generateWebsiteWithFallback, generateVanillaWebsiteWithFallback, probeGemini, validateVanillaProject } from './provider.js';

const groq = { baseUrl: 'https://api.groq.com/openai/v1', apiKey: 'groq-test-secret', model: 'qwen/qwen3.8-27b', timeoutMs: 5000 };
const gemini = { baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'gemini-test-secret', model: 'gemini-3.8-flash', timeoutMs: 5000 };
const openRouter = { baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'openrouter-test-secret', model: 'provider/model-test', timeoutMs: 5000 };
const input = { prompt: 'build a site', currentFiles: [], mode: 'create' as const };
const answer = { summary: 'A safe static app', files: [{ path: 'index.html', content: '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><main>Portfolio</main><script src="app.js"></script></body></html>' }, { path: 'styles.css', content: 'body { color: #fff; background: #101020; }' }, { path: 'app.js', content: 'document.querySelector("main");' }], warnings: [] };
const makeResponse = (status: number, body = '', headers?: Record<string, string>) => new Response(body, { status, headers: { 'content-type': 'text/event-stream', ...headers } });
const makeJsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const sse = (events: unknown[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
const groqResponse = (content = JSON.stringify(answer)) => makeJsonResponse({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 17, completion_tokens: 31 } });
const geminiResponse = (content = JSON.stringify(answer), finishReason = 'STOP') => makeResponse(200, sse([
  { candidates: [{ content: { parts: [{ text: content }] } }] },
  { candidates: [{ finishReason }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 21 } },
]));
const openRouterResponse = (content = JSON.stringify(answer)) => makeResponse(200, sse([
  { choices: [{ delta: { content }, finish_reason: null }] },
  { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 9 } },
]));
afterEach(() => { vi.unstubAllGlobals(); clearProviderHealthForTests(); });

describe('real provider adapters (mock HTTP; no provider credits)', () => {
  it('streams only decoded file content from split structured JSON chunks', () => {
    const streamer = new JsonContentFieldStreamer();
    const chunks = ['{"summary":"content","files":[{"path":"index.html","content":"<h1>Black ', '& \\"white\\"</h1>\\n<!-- ', '\\u2713 -->"}]}'];
    const result = chunks.map((chunk) => streamer.push(chunk)).join('');
    expect(result).toBe('<h1>Black & "white"</h1>\n<!-- ✓ -->');
  });

  it('streams file paths and decoded source from structured framework output', async () => {
    const files = [
      { path: 'index.html', content: '<div id="root"></div><script type="module" src="/src/main.tsx"></script>' },
      { path: 'styles.css', content: 'body { color: #123; }' },
      { path: 'app.js', content: 'console.info("ready");' },
      { path: 'package.json', content: '{"scripts":{"dev":"vite"}}' },
      { path: 'src/App.tsx', content: 'export const App = () => <main title="ready">Ready\n</main>;' },
    ];
    const serialized = JSON.stringify({ summary: 'React app', files, warnings: [] });
    const splitAt = serialized.indexOf('\\' + '"') + 1;
    const streamedResponse = makeResponse(200, sse([
      { candidates: [{ content: { parts: [{ text: serialized.slice(0, splitAt) }] } }] },
      { candidates: [{ content: { parts: [{ text: serialized.slice(splitAt, splitAt + 18) }] } }] },
      { candidates: [{ content: { parts: [{ text: serialized.slice(splitAt + 18) }] } }] },
      { candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 21 } },
    ]));
    const fetcher = vi.fn().mockResolvedValue(streamedResponse);
    const received: Record<string, string> = {};
    const events: string[] = [];
    await generateWebsiteWithFallback({
      prompt: 'Create a React and Vite website.',
      currentFiles: [],
      mode: 'create',
    }, { groq, gemini }, new AbortController().signal, fetcher as typeof fetch, (event) => {
      events.push(event.type);
      if (event.type === 'file_started') received[event.path] = '';
      if (event.type === 'file_delta') received[event.path] = `${received[event.path] ?? ''}${event.text}`;
    });

    expect(received).toEqual(Object.fromEntries(files.map(({ path, content }) => [path, content])));
    expect(events).toContain('file_delta');
    expect(events.filter((type) => type === 'file_delta').length).toBeGreaterThan(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('clears partial framework files before streaming the fallback provider', async () => {
    const files = [
      { path: 'index.html', content: '<div id="root"></div><script type="module" src="/src/main.tsx"></script>' },
      { path: 'styles.css', content: 'body { color: #123; }' },
      { path: 'app.js', content: 'console.info("ready");' },
      { path: 'src/App.tsx', content: 'export const App = () => <main>Ready</main>;' },
    ];
    const partial = '{"summary":"partial","files":[{"path":"src/App.tsx","content":"export const App = () => <main>partial';
    const fetcher = vi.fn()
      .mockResolvedValueOnce(geminiResponse(partial, 'MAX_TOKENS'))
      .mockResolvedValueOnce(groqResponse(JSON.stringify({ summary: 'Complete React app', files, warnings: [] })));
    const received: Record<string, string> = {};
    const fallbackStarts: string[] = [];
    await generateWebsiteWithFallback({
      prompt: 'Create a React and Vite website.',
      currentFiles: [],
      mode: 'create',
    }, { groq, gemini }, new AbortController().signal, fetcher as typeof fetch, (event) => {
      if (event.type === 'file_started') {
        if (received[event.path]) fallbackStarts.push(event.path);
        received[event.path] = '';
      }
      if (event.type === 'file_delta') received[event.path] = `${received[event.path] ?? ''}${event.text}`;
    });

    expect(received).toEqual(Object.fromEntries(files.map(({ path, content }) => [path, content])));
    expect(fallbackStarts).toContain('src/App.tsx');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses OpenRouter JSON mode with server-side auth and strict project output validation', async () => {
    const fetcher = vi.fn().mockResolvedValue(openRouterResponse());
    const deltas: string[] = [];
    const result = await generateWithOpenRouter(input, openRouter, new AbortController().signal, fetcher as typeof fetch, (event) => { if (event.type === 'delta') deltas.push(event.text); });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${openRouter.apiKey}`);
    expect(url).not.toContain(openRouter.apiKey);
    const request = JSON.parse(String(init.body));
    expect(request).toMatchObject({
      model: openRouter.model,
      max_tokens: 8_000,
      response_format: { type: 'json_object' },
      stream: true,
      stream_options: { include_usage: true },
    });
    expect(request).not.toHaveProperty('tools');
    expect(request).not.toHaveProperty('tool_choice');
    expect(String(request.messages[0].content)).toContain('exactly the essential files index.html, styles.css, and app.js');
    expect(result.files.some((file) => file.path === 'index.html')).toBe(true);
    expect(deltas.join('')).toBe(JSON.stringify(answer));
  });

  it('assembles indexed OpenRouter tool-call argument fragments and ignores duplicate SSE event IDs', async () => {
    const argumentsText = JSON.stringify(answer);
    const splitAt = Math.floor(argumentsText.length / 2);
    const first = { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'return_dguy_project', arguments: argumentsText.slice(0, splitAt) } }] }, finish_reason: null }] };
    const second = { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: argumentsText.slice(splitAt) } }] }, finish_reason: 'tool_calls' }] };
    const response = makeResponse(200, `id: 1\ndata: ${JSON.stringify(first)}\n\nid: 1\ndata: ${JSON.stringify(first)}\n\nid: 2\ndata: ${JSON.stringify(second)}\n\ndata: [DONE]\n\n`);
    const result = await generateWithOpenRouter(input, openRouter, new AbortController().signal, vi.fn().mockResolvedValue(response) as typeof fetch);
    expect(result.files).toEqual(answer.files);
  });

  it('parses SSE multi-data-line events and flushes a final event without a trailing blank line', async () => {
    const content = JSON.stringify(answer);
    const toolEvent = JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'return_dguy_project', arguments: content } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 6 } });
    const split = toolEvent.lastIndexOf(',"usage"');
    const multiline = `data: ${toolEvent.slice(0, split)},\ndata: ${toolEvent.slice(split + 1)}`;
    const response = makeResponse(200, `${multiline}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}`);
    const result = await generateWithOpenRouter(input, openRouter, new AbortController().signal, vi.fn().mockResolvedValue(response) as typeof fetch);
    expect(result.summary).toBe(answer.summary);
  });

  it('rejects OpenRouter truncation, multiple tool calls and incomplete tool-call streams', async () => {
    const args = JSON.stringify(answer);
    const truncatedEvent = { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'return_dguy_project', arguments: args.slice(0, 20) } }] }, finish_reason: 'length' }] };
    const truncated = makeResponse(200, sse([truncatedEvent]));
    await expect(generateWithOpenRouter(input, openRouter, new AbortController().signal, vi.fn().mockResolvedValue(truncated) as typeof fetch)).rejects.toThrow('output_truncated');

    const multipleEvent = { choices: [{ delta: { tool_calls: [
      { index: 0, id: 'a', function: { name: 'return_dguy_project', arguments: args } },
      { index: 1, id: 'b', function: { name: 'return_dguy_project', arguments: args } },
    ] }, finish_reason: 'tool_calls' }] };
    const multiple = makeResponse(200, sse([multipleEvent]));
    await expect(generateWithOpenRouter(input, openRouter, new AbortController().signal, vi.fn().mockResolvedValue(multiple) as typeof fetch)).rejects.toThrow('multiple_tool_calls');

    const incompleteEvent = { choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'return_dguy_project', arguments: '{' } }] }, finish_reason: 'tool_calls' }] };
    const incomplete = makeResponse(200, sse([incompleteEvent]));
    await expect(generateWithOpenRouter(input, openRouter, new AbortController().signal, vi.fn().mockResolvedValue(incomplete) as typeof fetch)).rejects.toThrow('malformed_json');
  });

  it('selects Gemini first for website creation and records successful-provider provenance', async () => {
    const events: string[] = [];
    const fetcher = vi.fn().mockResolvedValue(geminiResponse());
    const result = await generateWebsiteWithFallback(input, { groq, gemini, openRouter }, new AbortController().signal, fetcher as typeof fetch, (event) => { if (event.type === 'provider') events.push(event.provider); });
    expect(events).toEqual(['gemini']);
    expect(fetcher.mock.calls[0]?.[0]).toContain('/models/gemini-3.8-flash:');
    expect(result.warnings).toContain('Generated by gemini.');
  });

  it('falls through to Groq after Gemini truncates and rejects truncated Gemini streams', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(geminiResponse('{"summary":"partial"', 'MAX_TOKENS')).mockResolvedValueOnce(groqResponse());
    const result = await generateWebsiteWithFallback(input, { groq, gemini, openRouter }, new AbortController().signal, fetcher as typeof fetch);
    expect(result.summary).toBe(answer.summary);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(generateWithGemini(input, gemini, new AbortController().signal, vi.fn().mockResolvedValue(geminiResponse('{"summary":"partial"', 'MAX_TOKENS')) as typeof fetch)).rejects.toThrow('invalid_output [output_truncated]');
  });

  it('rejects malformed OpenRouter tool-call output without repeating the paid request', async () => {
    const malformed = makeResponse(200, sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'return_dguy_project', arguments: '{bad json' } }] }, finish_reason: 'tool_calls' }] }]));
    const fetcher = vi.fn().mockResolvedValue(malformed);
    await expect(generateWithOpenRouter(input, openRouter, new AbortController().signal, fetcher as typeof fetch)).rejects.toThrow('invalid_output [malformed_json]');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('generates vanilla static sites as HTML then parallel CSS/JS file requests with bounded outputs', async () => {
    const streamed: Record<string, string> = {};
    const fileContent: Record<string, string> = {
      'index.html': '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./styles.css"></head><body><main id="app"><nav id="site-nav"><button id="menu-toggle" aria-controls="mobile-menu" aria-expanded="false">Menu</button></nav><div id="mobile-menu"><nav><a href="#projects">Projects</a></nav></div><section id="projects"></section><form id="contact-form"></form></main><script defer src="./app.js"></script></body></html>',
      'styles.css': '*{box-sizing:border-box}img{max-width:100%;height:auto}body{background:#071426;color:#edf5ff}#site-nav{display:flex}#mobile-menu{display:none}@media(max-width:1024px){#site-nav{gap:1rem}}@media(max-width:768px){#site-nav{display:block}}',
      'app.js': 'document.querySelector("#contact-form")?.addEventListener("submit",event=>{event.preventDefault()}); const toggle=document.querySelector("#menu-toggle"),menu=document.querySelector("#mobile-menu"); toggle?.addEventListener("click",()=>{menu?.classList.toggle("open");toggle.setAttribute("aria-expanded",String(menu?.classList.contains("open")))});document.addEventListener("keydown",event=>{if(event.key==="Escape"){menu?.classList.remove("open");toggle?.setAttribute("aria-expanded","false")}});',
    };
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const taskInput = JSON.parse(request.contents[0].parts[0].text);
      const path = taskInput.prompt.match(/Requested output file: (index\.html|styles\.css|app\.js)/)?.[1] as keyof typeof fileContent;
      const output = { summary: `Generated ${path}`, files: [{ path, content: fileContent[path] }], warnings: [] };
      return geminiResponse(JSON.stringify(output));
    });

    const result = await generateVanillaWebsiteWithFallback({
      prompt: 'Create a basic professional portfolio website using vanilla HTML, CSS and JavaScript.',
      currentFiles: [],
      mode: 'create',
    }, { groq, gemini, openRouter, totalTimeoutMs: 90_000 }, new AbortController().signal, fetcher as typeof fetch, (event) => {
      if (event.type === 'file_delta') streamed[event.path] = `${streamed[event.path] ?? ''}${event.text}`;
    });

    expect(result.files.map((file) => file.path)).toEqual(['index.html', 'styles.css', 'app.js']);
    expect(result.files.map((file) => file.content)).toEqual(Object.values(fileContent));
    expect(result.provider).toBe('gemini');
    expect(streamed).toEqual(fileContent);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, init] of fetcher.mock.calls) {
      const request = JSON.parse(String(init?.body));
      expect(request.generationConfig.maxOutputTokens).toBe(3_072);
      const taskInput = JSON.parse(request.contents[0].parts[0].text);
      expect(taskInput.requirePreview).toBe(false);
      expect(taskInput.prompt).toContain('Return a D-GUY JSON response');
      if (taskInput.prompt.includes('Requested output file: index.html')) expect(taskInput.prompt).toContain('Do not use React, a bundler, Tailwind');
    }
    const cssAndJsInputs = fetcher.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init?.body)).contents[0].parts[0].text).map((content: string) => JSON.parse(content));
    expect(cssAndJsInputs.every((taskInput: { currentFiles: Array<{ path: string }> }) => taskInput.currentFiles[0]?.path === 'index.html')).toBe(true);
  });

  it('discards partial streamed source when a provider fallback restarts a file', async () => {
    const fileContent: Record<'index.html' | 'styles.css' | 'app.js', string> = {
      'index.html': '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./styles.css"></head><body><nav><button id="menu-toggle" aria-controls="mobile-menu" aria-expanded="false">Menu</button></nav><div id="mobile-menu"><nav><a href="#home">Home</a></nav></div><main id="home"></main><script defer src="./app.js"></script></body></html>',
      'styles.css': '*{box-sizing:border-box}img{max-width:100%;height:auto}#mobile-menu{display:none}body{margin:0}@media(max-width:1024px){body{padding:1rem}}@media(max-width:768px){#mobile-menu.open{display:block}}',
      'app.js': 'const button=document.querySelector("#menu-toggle"),menu=document.querySelector("#mobile-menu");button?.addEventListener("click",()=>{menu?.classList.toggle("open");button.setAttribute("aria-expanded",String(menu?.classList.contains("open")))});document.addEventListener("keydown",event=>{if(event.key==="Escape"){menu?.classList.remove("open");button?.setAttribute("aria-expanded","false")}});',
    };
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const taskInput = JSON.parse(request.contents?.[0]?.parts?.[0]?.text ?? request.messages[1].content);
      const path = taskInput.expectedFilePath as keyof typeof fileContent;
      const host = new URL(String(url)).hostname;
      if (path === 'index.html' && host === 'generativelanguage.googleapis.com') {
        return geminiResponse('{"summary":"partial","files":[{"path":"index.html","content":"<main>partial', 'MAX_TOKENS');
      }
      const output = { summary: `Generated ${path}`, files: [{ path, content: fileContent[path] }], warnings: [] };
      return host === 'api.groq.com' ? groqResponse(JSON.stringify(output)) : geminiResponse(JSON.stringify(output));
    });
    const streamed: Record<string, string> = {};
    const result = await generateVanillaWebsiteWithFallback({
      prompt: 'Create a basic professional portfolio website using vanilla HTML, CSS and JavaScript.',
      currentFiles: [],
      mode: 'create',
    }, { groq, gemini, totalTimeoutMs: 90_000 }, new AbortController().signal, fetcher as typeof fetch, (event) => {
      if (event.type === 'file_started') streamed[event.path as keyof typeof fileContent] = '';
      if (event.type === 'file_delta') streamed[event.path as keyof typeof fileContent] = `${streamed[event.path as keyof typeof fileContent] ?? ''}${event.text}`;
    });

    expect(result.files.map((file) => file.content)).toEqual(Object.values(fileContent));
    expect(streamed).toEqual(fileContent);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('recovers CSS and JavaScript independently after Gemini becomes unavailable', async () => {
    const contents: Record<string, string> = {
      'index.html': '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body><nav><button id="menu-toggle" aria-controls="mobile-menu" aria-expanded="false">Menu</button></nav><div id="mobile-menu"><nav><a href="#shop">Shop</a></nav></div><main id="shop">Shop</main><script src="app.js" defer></script></body></html>',
      'styles.css': '*{box-sizing:border-box}img{max-width:100%;height:auto}#mobile-menu{display:none}body{margin:0}@media(max-width:1024px){body{padding:1rem}}@media(max-width:768px){#mobile-menu.open{display:block}}',
      'app.js': 'const button=document.querySelector("#menu-toggle"),menu=document.querySelector("#mobile-menu");button?.addEventListener("click",()=>{menu?.classList.toggle("open");button.setAttribute("aria-expanded",String(menu?.classList.contains("open")))});document.addEventListener("keydown",event=>{if(event.key==="Escape"){menu?.classList.remove("open");button?.setAttribute("aria-expanded","false")}});',
    };
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const task = JSON.parse(body.contents?.[0]?.parts?.[0]?.text ?? body.messages?.[1]?.content);
      const path = task.expectedFilePath as keyof typeof contents;
      calls.push(`${new URL(String(url)).hostname}:${path}`);
      if (path === 'index.html') return geminiResponse(JSON.stringify({ summary: 'Generated HTML', files: [{ path, content: contents[path] }], warnings: [] }));
      if (path !== 'index.html' && new URL(String(url)).hostname === 'generativelanguage.googleapis.com') return makeResponse(503);
      return groqResponse(JSON.stringify({ summary: `Generated ${path}`, files: [{ path, content: contents[path] }], warnings: [] }));
    });
    const result = await generateVanillaWebsiteWithFallback({ prompt: 'Create a monochrome ecommerce store.', currentFiles: [], mode: 'create' }, { groq, gemini, totalTimeoutMs: 100_000 }, new AbortController().signal, fetcher as typeof fetch);
    expect(result.files.map(({ path }) => path)).toEqual(['index.html', 'styles.css', 'app.js']);
    expect(result.files.map(({ content }) => content)).toEqual(Object.values(contents));
    expect(calls.filter((call) => call.endsWith(':index.html'))).toEqual(['generativelanguage.googleapis.com:index.html']);
    expect(calls.filter((call) => call.endsWith(':styles.css')).sort()).toEqual(['api.groq.com:styles.css', 'generativelanguage.googleapis.com:styles.css', 'generativelanguage.googleapis.com:styles.css']);
    expect(calls.filter((call) => call.endsWith(':app.js')).sort()).toEqual(['api.groq.com:app.js', 'generativelanguage.googleapis.com:app.js', 'generativelanguage.googleapis.com:app.js']);
  });

  it('validates static asset links and parses JavaScript without executing it', () => {
    const effects: string[] = [];
    const valid = [
      { path: 'index.html', content: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body><nav><button id="menu-toggle" aria-controls="mobile-menu" aria-expanded="false">Menu</button></nav><div id="mobile-menu"><nav><a href="#home">Home</a></nav></div><script src="app.js" defer></script></body></html>' },
      { path: 'styles.css', content: '* { box-sizing: border-box; } img { max-width: 100%; height: auto; } body { color: white; } #menu-toggle{} #mobile-menu { display: none; } @media (max-width: 1024px) { body { color: blue; } } @media (max-width: 768px) { body { color: white; } }' },
      { path: 'app.js', content: 'globalThis.__dguy_test_effect = true; const toggle=document.querySelector("#menu-toggle"),menu=document.querySelector("#mobile-menu"); toggle?.addEventListener("click",()=>{menu?.classList.toggle("open");toggle.setAttribute("aria-expanded","true")});document.addEventListener("keydown",event=>{if(event.key==="Escape"){}});' },
    ];
    expect(() => validateVanillaProject(valid)).not.toThrow();
    expect((globalThis as { __dguy_test_effect?: boolean }).__dguy_test_effect).toBeUndefined();
    expect(effects).toEqual([]);
    expect(() => validateVanillaProject([...valid.slice(0, 2), { path: 'app.js', content: 'document.querySelector("#menu-toggle");document.querySelector("#mobile-menu").setAttribute("aria-expanded","false");document.addEventListener("keydown",event=>{if(event.key==="Escape"){}}); function (' }])).toThrow('javascript_syntax_error');
    expect(() => validateVanillaProject([{ ...valid[0]!, content: '<html></html>' }, ...valid.slice(1)])).toThrow('static_preview_assets_not_linked');
    expect(() => validateVanillaProject([valid[0]!, { ...valid[1]!, content: 'body { color: white; @media (max-width: 768px) {' }, valid[2]!])).toThrow('stylesheet_incomplete');
    expect(() => validateVanillaProject([valid[0]!, { ...valid[1]!, content: '* { box-sizing: border-box; } img { max-width: 100%; } #mobile-menu { display: none; } body { color: white; }' }, valid[2]!])).toThrow('responsive_breakpoints_missing');
    expect(() => validateVanillaProject([{ ...valid[0]!, content: valid[0]!.content.replace(/<meta name="viewport"[^>]*>/, '') }, ...valid.slice(1)])).toThrow('viewport_meta_missing');
    expect(() => validateVanillaProject([{ ...valid[0]!, content: valid[0]!.content.replace('</div><script', '<script') }, ...valid.slice(1)])).toThrow('static_preview_assets_not_linked');
    expect(() => validateVanillaProject([valid[0]!, { ...valid[1]!, content: '#mobile-menu{} body{} @media(max-width:1024px){} @media(max-width:768px){}' }, valid[2]!])).toThrow('responsive_content_constraints_missing');
    expect(() => validateVanillaProject([valid[0]!, valid[1]!, { ...valid[2]!, content: 'document.addEventListener("keydown",()=>{});' }])).toThrow('responsive_navigation_behavior_missing');
  });

  it('regenerates and validates all three files for a natural-language static-site revision', async () => {
    const files = [
      { path: 'index.html', content: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./styles.css"></head><body><nav><button id="menu-toggle" aria-controls="mobile-menu" aria-expanded="false">Menu</button></nav><div id="mobile-menu"><nav><a href="#home">Home</a></nav></div><script defer src="./app.js"></script></body></html>' },
      { path: 'styles.css', content: '*{box-sizing:border-box}img{max-width:100%;height:auto}#menu-toggle{}#mobile-menu{display:none}body{color:white}@media(max-width:1024px){body{color:blue}}@media(max-width:768px){body{color:white}}' },
      { path: 'app.js', content: 'const toggle=document.querySelector("#menu-toggle"),menu=document.querySelector("#mobile-menu"); toggle?.addEventListener("click",()=>{menu?.classList.toggle("open");toggle.setAttribute("aria-expanded",String(menu?.classList.contains("open")))});document.addEventListener("keydown",event=>{if(event.key==="Escape"){menu?.classList.remove("open");toggle?.setAttribute("aria-expanded","false")}});' },
    ];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const taskInput = JSON.parse(request.contents[0].parts[0].text);
      const path = taskInput.prompt.match(/Requested output file: (index\.html|styles\.css|app\.js)/)?.[1];
      const content = files.find((file) => file.path === path)?.content;
      return geminiResponse(JSON.stringify({ summary: `Updated ${path}`, files: [{ path, content }], warnings: [] }));
    });
    const result = await generateVanillaWebsiteWithFallback({
      prompt: 'Make the website responsive and switch it to a blue and white theme.',
      currentFiles: files,
      mode: 'revise',
    }, { groq, gemini, openRouter, totalTimeoutMs: 90_000 }, new AbortController().signal, fetcher as typeof fetch);
    expect(result.files.map((file) => file.path)).toEqual(['index.html', 'styles.css', 'app.js']);
    expect(result.summary).toBe('Updated index.html');
    expect(fetcher).toHaveBeenCalledTimes(3);
    const revisionInputs = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).contents[0].parts[0].text).map((text: string) => JSON.parse(text));
    expect(revisionInputs[0].currentFiles).toEqual(files);
    for (const path of ['styles.css', 'app.js']) {
      const task = revisionInputs.find((item: { expectedFilePath: string }) => item.expectedFilePath === path);
      expect(task.currentFiles).toEqual([
        { path: 'index.html', content: files[0]!.content },
        ...files.slice(1),
      ]);
    }
  });

  it('repairs an incomplete stylesheet before returning a generated website', async () => {
    const content: Record<string, string> = {
      'index.html': '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body><nav><button id="menu-toggle" aria-controls="mobile-menu" aria-expanded="false">Menu</button></nav><div id="mobile-menu"><nav><a href="#home">Home</a></nav></div><script defer src="app.js"></script></body></html>',
      'styles.css': '*{box-sizing:border-box}img{max-width:100%;height:auto}#menu-toggle{}#mobile-menu{display:none}body{color:white}@media(max-width:1024px){body{color:blue}}@media(max-width:768px){body{color:white}}',
      'app.js': 'const toggle=document.querySelector("#menu-toggle"),menu=document.querySelector("#mobile-menu"); toggle?.addEventListener("click",()=>{menu?.classList.toggle("open");toggle.setAttribute("aria-expanded","true")});document.addEventListener("keydown",event=>{if(event.key==="Escape"){}});',
    };
    let cssResponses = 0;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const taskInput = JSON.parse(request.contents[0].parts[0].text);
      const path = taskInput.prompt.match(/Requested output file: (index\.html|styles\.css|app\.js)/)?.[1] as keyof typeof content;
      cssResponses += path === 'styles.css' ? 1 : 0;
      const fileContent = path === 'styles.css' && cssResponses === 1 ? 'body{color:white' : content[path];
      return geminiResponse(JSON.stringify({ summary: `Generated ${path}`, files: [{ path, content: fileContent }], warnings: [] }));
    });
    const result = await generateVanillaWebsiteWithFallback({ prompt: 'Build a responsive static portfolio website.', currentFiles: [], mode: 'create' }, { groq, gemini, openRouter }, new AbortController().signal, fetcher as typeof fetch);
    expect(result.files.find((file) => file.path === 'styles.css')?.content).toBe(content['styles.css']);
    expect(result.warnings).toContain('Regenerated styles.css once after stylesheet_incomplete validation failed.');
    expect(fetcher).toHaveBeenCalledTimes(4);
    const repairInput = JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body)).contents[0].parts[0].text;
    expect(repairInput).toContain('stylesheet_incomplete');
  });

  it('falls back Gemini → Groq → OpenRouter in order and records the provider used', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(makeResponse(503)).mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(503)).mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(openRouterResponse());
    const events: string[] = [];
    const result = await generateWebsiteWithFallback(input, { groq, gemini, openRouter }, new AbortController().signal, fetcher as typeof fetch, (event) => { if (event.type === 'provider') events.push(event.provider); });
    expect(events).toEqual(['gemini', 'groq', 'openrouter']);
    expect(fetcher.mock.calls[4]?.[0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(result.warnings.at(-1)).toMatch(/gemini failed.*groq failed.*openrouter generated this version/);
  });

  it('skips OpenRouter when unconfigured and preserves Hugging Face as the last configured fallback', async () => {
    const fetcher = vi.fn()
      .mockResolvedValue(makeResponse(503));
    await expect(generateWebsiteWithFallback(input, { groq, gemini }, new AbortController().signal, fetcher as typeof fetch)).rejects.toThrow(/Gemini: provider_unavailable.*Groq: provider_unavailable/);
    expect(fetcher.mock.calls.every(([url]) => String(url).includes('generativelanguage.googleapis.com') || String(url).includes('api.groq.com'))).toBe(true);
  });

  it('stops provider fallback at the website-generation deadline', async () => {
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    await expect(generateWebsiteWithFallback(input, { groq, gemini, openRouter, totalTimeoutMs: 1_000 }, new AbortController().signal, fetcher as typeof fetch))
      .rejects.toThrow('Gemini: timeout, generation_deadline_exceeded');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('sends Groq the configured model and validates structured output', async () => {
    const fetcher = vi.fn().mockResolvedValue(groqResponse());
    const events: string[] = [];
    const result = await generateWithGroq(input, groq, new AbortController().signal, fetcher as typeof fetch, (event) => { if (event.type === 'delta') events.push(event.text); });
    expect(result.files[0]?.path).toBe('index.html');
    expect(result.inputTokens).toBe(17);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.groq.com/openai/v1/chat/completions');
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(request.model).toBe(groq.model);
    expect(request.max_completion_tokens).toBe(8_000);
    expect(request.reasoning_effort).toBe('none');
    expect(request.reasoning_format).toBe('hidden');
    expect(request.stream).toBe(false);
    expect(request.response_format.type).toBe('json_schema');
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(JSON.stringify(request.response_format.json_schema.schema)).not.toMatch(/minLength|maxLength|minItems|maxItems/);
    expect(events.join('')).toBe(JSON.stringify(answer));
  });

  it('uses broadly supported Groq schema output and validates requested paths server-side', async () => {
    const fetcher = vi.fn().mockResolvedValue(groqResponse(JSON.stringify({ summary: 'Generated stylesheet', files: [{ path: 'styles.css', content: 'body{}' }], warnings: [] })));
    const result = await generateWithGroq({ ...input, requirePreview: false, expectedFilePath: 'styles.css', maxOutputTokens: 3_072 }, groq, new AbortController().signal, fetcher as typeof fetch);
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(request.response_format.json_schema.schema).toEqual(expect.objectContaining({ required: ['summary', 'files', 'warnings'], additionalProperties: false }));
    expect(JSON.stringify(request.response_format.json_schema.schema)).not.toMatch(/minItems|maxItems|enum/);
    expect(request.max_completion_tokens).toBe(2_048);
    expect(result.files).toEqual([{ path: 'styles.css', content: 'body{}' }]);
    const wrongFile = vi.fn().mockResolvedValue(groqResponse(JSON.stringify({ summary: 'Wrong file', files: [{ path: 'app.js', content: 'bad' }], warnings: [] })));
    await expect(generateWithGroq({ ...input, requirePreview: false, expectedFilePath: 'styles.css' }, groq, new AbortController().signal, wrongFile as typeof fetch)).rejects.toThrow('missing_expected_file');
  });

  it('does not retry a rate-limited provider, preserves Retry-After, and falls back', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(makeResponse(429, JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), { 'content-type': 'application/json', 'retry-after': '120' }))
      .mockResolvedValueOnce(geminiResponse());
    const failure = await generateWithGroq(input, groq, new AbortController().signal, fetcher as typeof fetch).catch((error: unknown) => error);
    expect(failure).toMatchObject({ info: { provider: 'groq', category: 'rate_limited', status: 429, retryAfterMs: 120_000 } });
    expect(fetcher).toHaveBeenCalledTimes(1);

    const result = await generateWebsiteWithFallback(input, { groq, gemini }, new AbortController().signal, fetcher as typeof fetch);
    expect(result.provider).toBe('gemini');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0]).toContain('generativelanguage.googleapis.com');
  });

  it('retries transient Groq errors before succeeding', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(makeResponse(503)).mockResolvedValueOnce(groqResponse());
    const result = await generateWithGroq(input, groq, new AbortController().signal, fetcher as typeof fetch);
    expect(result.summary).toBe(answer.summary);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('sends the Gemini key in a header and validates its structured response', async () => {
    const fetcher = vi.fn().mockResolvedValue(geminiResponse());
    const result = await generateWithGemini(input, gemini, new AbortController().signal, fetcher as typeof fetch);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe(gemini.apiKey);
    expect(url).not.toContain(gemini.apiKey);
    expect(result.outputTokens).toBe(21);
    expect(JSON.parse(String(init.body)).generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'low' }, responseJsonSchema: { required: ['summary', 'files', 'warnings'] } });
  });

  it('provides sanitized request phase diagnostics for Gemini website generation', async () => {
    const diagnostics: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn().mockResolvedValue(geminiResponse());
    await generateWithGemini(input, gemini, new AbortController().signal, fetcher as typeof fetch, undefined, (event) => diagnostics.push(event));
    expect(diagnostics.map((event) => event.stage)).toEqual(['request_created', 'request_started', 'response_headers', 'first_byte', 'response_complete']);
    expect(JSON.stringify(diagnostics)).not.toContain(gemini.apiKey);
    expect(JSON.stringify(diagnostics)).not.toContain(input.prompt);
    expect(diagnostics.every((event) => typeof event.elapsedMs === 'number')).toBe(true);
  });

  it('captures Gemini HTTP failures without logging response bodies or credentials', async () => {
    const diagnostics: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn().mockResolvedValueOnce(makeResponse(404, JSON.stringify({ error: { code: 'model_not_found', message: 'private provider body' } }), { 'content-type': 'application/json' }));
    await expect(generateWithGemini(input, gemini, new AbortController().signal, fetcher as typeof fetch, undefined, (event) => diagnostics.push(event))).rejects.toMatchObject({ info: { status: 404, providerCode: 'model_not_found' } });
    expect(diagnostics).toContainEqual(expect.objectContaining({ stage: 'provider_error', status: 404, providerCode: 'model_not_found' }));
    expect(JSON.stringify(diagnostics)).not.toContain(gemini.apiKey);
    expect(JSON.stringify(diagnostics)).not.toContain('private provider body');
  });

  it('prepares a one-shot HELLO probe using the same Gemini credentials and model without retrying', async () => {
    const diagnostics: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn().mockResolvedValue(makeJsonResponse({ candidates: [{ content: { parts: [{ text: 'HELLO' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } }));
    const result = await probeGemini(gemini, new AbortController().signal, fetcher as typeof fetch, (event) => diagnostics.push(event));
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe(gemini.apiKey);
    expect(JSON.parse(String(init.body))).toEqual({ contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: HELLO' }] }], generationConfig: { maxOutputTokens: 4 } });
    expect(result).toMatchObject({ model: gemini.model, status: 200, outputCharacters: 5, inputTokens: 5, outputTokens: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(diagnostics.map((event) => event.stage)).toEqual(['request_created', 'request_started', 'response_headers', 'first_byte', 'response_complete']);
    expect(JSON.stringify(diagnostics)).not.toContain(gemini.apiKey);
  });

  it('returns the actual HTTP status for a rejected one-shot Gemini probe', async () => {
    const diagnostics: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn().mockResolvedValue(makeResponse(503, JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'provider temporarily unavailable' } }), { 'content-type': 'application/json' }));
    await expect(probeGemini(gemini, new AbortController().signal, fetcher as typeof fetch, (event) => diagnostics.push(event))).rejects.toMatchObject({ info: { status: 503, category: 'provider_unavailable' } });
    expect(diagnostics).toContainEqual(expect.objectContaining({ stage: 'provider_error', status: 503, category: 'provider_unavailable' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses Gemini after a recoverable Groq network failure and reports its reason', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(geminiResponse());
    const result = await generateWithFallback(input, { groq, gemini }, new AbortController().signal, fetcher as typeof fetch);
    expect(result.warnings[0]).toContain('Groq failed with network_error');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('attempts Gemini after a primary authentication error while reporting both sanitized failures', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(makeResponse(401, JSON.stringify({ error: { code: 'invalid_api_key' } }), { 'content-type': 'application/json' }))
      .mockResolvedValueOnce(makeResponse(401, JSON.stringify({ error: { code: 'invalid_api_key' } }), { 'content-type': 'application/json' }));
    await expect(generateWithFallback(input, { groq, gemini }, new AbortController().signal, fetcher as typeof fetch)).rejects.toThrow(/Groq: authentication_rejected \(HTTP 401\), invalid_api_key.*Gemini: authentication_rejected \(HTTP 401\), invalid_api_key/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('reports the primary and fallback HTTP failures without leaking response bodies', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(makeResponse(503)).mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(404, JSON.stringify({ error: { code: 'model_not_found', param: 'responseJsonSchema', message: 'private provider response with secret token' } }), { 'content-type': 'application/json' }));
    const failure = await generateWithFallback(input, { groq, gemini }, new AbortController().signal, fetcher as typeof fetch).catch((error: unknown) => error);
    expect(failure).toMatchObject({ failures: [expect.objectContaining({ category: 'provider_unavailable' }), expect.objectContaining({ category: 'invalid_model', providerField: 'responseJsonSchema' })] });
    expect(failure.message).toContain('[field: responseJsonSchema]');
    expect(failure.message).not.toContain('private provider response');
    expect(failure.message).not.toContain('secret token');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('falls back when Groq returns malformed structured output and requires a preview file', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(groqResponse('{invalid json'))
      .mockResolvedValueOnce(geminiResponse());
    const result = await generateWithFallback(input, { groq, gemini }, new AbortController().signal, fetcher as typeof fetch);
    expect(result.files.some((file) => file.path === 'index.html')).toBe(true);
    const noPreview = { summary: 'missing preview', files: [{ path: 'src/App.tsx', content: 'export default 1' }], warnings: [] };
    await expect(generateWithGroq(input, groq, new AbortController().signal, vi.fn().mockResolvedValue(groqResponse(JSON.stringify(noPreview))) as typeof fetch)).rejects.toThrow();
  });

  it('accepts a JSON code fence while preserving strict file schema validation', async () => {
    const fenced = vi.fn().mockResolvedValue(groqResponse(`\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``));
    await expect(generateWithGroq(input, groq, new AbortController().signal, fenced as typeof fetch)).resolves.toMatchObject({ summary: answer.summary });
    const schemaInvalid = { summary: 'invalid files', files: [{ path: '../escape.html', content: 'bad' }], warnings: [] };
    const invalidFetcher = vi.fn().mockResolvedValue(groqResponse(JSON.stringify(schemaInvalid)));
    await expect(generateWithGroq(input, groq, new AbortController().signal, invalidFetcher as typeof fetch)).rejects.toThrow('invalid_output [schema_validation_failed]');
  });

  it('reports precise sanitized output causes and keeps Gemini timeout visible', async () => {
    const invalidJson = vi.fn().mockResolvedValue(groqResponse('{not json'));
    await expect(generateWithGroq(input, groq, new AbortController().signal, invalidJson as typeof fetch)).rejects.toThrow('invalid_output [malformed_json]');

    const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const bothFail = vi.fn().mockRejectedValueOnce(new TypeError('network')).mockRejectedValueOnce(new TypeError('network')).mockRejectedValueOnce(new TypeError('network')).mockRejectedValue(timeout);
    await expect(generateWithFallback(input, { groq, gemini }, new AbortController().signal, bothFail as typeof fetch)).rejects.toThrow('Gemini: timeout');
  });

  it('diagnoses empty Groq responses with safe shape metadata and falls back to Gemini', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(makeJsonResponse({ choices: [{ message: { content: null, reasoning: 'private reasoning must not be logged' }, finish_reason: 'stop' }] })).mockResolvedValueOnce(geminiResponse());
    const result = await generateWithFallback(input, { groq, gemini }, new AbortController().signal, fetcher as typeof fetch);
    expect(result.summary).toBe(answer.summary);
    expect(result.warnings[0]).toContain('null_content');
    await expect(generateWithGroq(input, groq, new AbortController().signal, vi.fn().mockResolvedValue(makeJsonResponse({ choices: [] })) as typeof fetch)).rejects.toMatchObject({ info: { providerCode: 'missing_choices', diagnostics: { choiceCount: 0, contentKind: 'missing' } } });
  });

  it('treats Gemini 503 model-capacity text as provider unavailable, not invalid model', async () => {
    const body = JSON.stringify({ error: { code: 'unavailable', message: 'model temporarily unavailable due to capacity' } });
    const fetcher = vi.fn().mockResolvedValue(makeResponse(503, body, { 'content-type': 'application/json' }));
    await expect(generateWithGemini(input, gemini, new AbortController().signal, fetcher as typeof fetch)).rejects.toMatchObject({ info: { category: 'provider_unavailable', status: 503, recoverable: true } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('preserves Gemini standard error.status as a sanitized provider code', async () => {
    const diagnostics: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn().mockResolvedValue(makeResponse(503, JSON.stringify({ error: { status: 'UNAVAILABLE', message: 'Provider message is not logged' } }), { 'content-type': 'application/json' }));
    await expect(generateWithGemini(input, gemini, new AbortController().signal, fetcher as typeof fetch, undefined, (event) => diagnostics.push(event))).rejects.toMatchObject({ info: { category: 'provider_unavailable', status: 503, providerCode: 'unavailable' } });
    expect(diagnostics).toContainEqual(expect.objectContaining({ stage: 'provider_error', status: 503, providerCode: 'unavailable' }));
    expect(JSON.stringify(diagnostics)).not.toContain('Provider message is not logged');
  });

  it('captures only the safe rejected Groq request field from an HTTP 400 response', async () => {
    const body = JSON.stringify({ error: { type: 'invalid_request_error', param: 'response_format', message: 'provider private text with api_key=do-not-leak' } });
    const fetcher = vi.fn().mockResolvedValue(makeResponse(400, body, { 'content-type': 'application/json' }));
    const error = await generateWithGroq(input, groq, new AbortController().signal, fetcher as typeof fetch).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ info: { status: 400, category: 'invalid_request', providerCode: 'invalid_request_error', providerField: 'response_format' } });
    expect(error.message).not.toContain('provider private text');
    expect(error.message).not.toContain('do-not-leak');
  });

  it('rejects complete-looking output that omits the required CSS or application script', async () => {
    const noCss = { summary: 'missing css', files: [answer.files[0], answer.files[2]], warnings: [] };
    await expect(generateWithGroq(input, groq, new AbortController().signal, vi.fn().mockResolvedValue(groqResponse(JSON.stringify(noCss))) as typeof fetch)).rejects.toThrow('invalid_output [missing_stylesheet]');
    const noJs = { summary: 'missing js', files: [answer.files[0], answer.files[1]], warnings: [] };
    await expect(generateWithGroq(input, groq, new AbortController().signal, vi.fn().mockResolvedValue(groqResponse(JSON.stringify(noJs))) as typeof fetch)).rejects.toThrow('invalid_output [missing_application_script]');
  });

  it('falls through to the next provider when a complete output is missing a required preview file', async () => {
    const noJs = { summary: 'missing js', files: [answer.files[0], answer.files[1]], warnings: [] };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(groqResponse(JSON.stringify(noJs)))
      .mockResolvedValueOnce(geminiResponse());

    const result = await generateWebsiteWithFallback(input, { groq, gemini }, new AbortController().signal, fetcher as typeof fetch, undefined, undefined, 'groq');

    expect(result.files.map((file) => file.path)).toEqual(['index.html', 'styles.css', 'app.js']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.warnings.some((warning) => warning.includes('groq failed'))).toBe(true);
  });

  it('detects provider output-token truncation and routes the incomplete response to Gemini', async () => {
    const truncated = makeJsonResponse({ choices: [{ message: { content: '{"summary":"partial"' }, finish_reason: 'length' }] });
    const fetcher = vi.fn().mockResolvedValueOnce(truncated).mockResolvedValueOnce(geminiResponse());
    const result = await generateWithFallback(input, { groq, gemini }, new AbortController().signal, fetcher as typeof fetch);
    expect(result.summary).toBe(answer.summary);
    expect(result.warnings[0]).toContain('output_truncated');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).max_completion_tokens).toBe(8_000);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).generationConfig.maxOutputTokens).toBe(8_000);
  });

  it('rejects invalid provider output and preserves cancellation', async () => {
    const malformed = vi.fn().mockResolvedValue(groqResponse('{invalid json'));
    await expect(generateWithGroq(input, groq, new AbortController().signal, malformed as typeof fetch)).rejects.toThrow();
    const controller = new AbortController(); controller.abort();
    const never = vi.fn();
    await expect(generateWithGroq(input, groq, controller.signal, never as typeof fetch)).rejects.toThrow();
    expect(never).not.toHaveBeenCalled();
  });
});
