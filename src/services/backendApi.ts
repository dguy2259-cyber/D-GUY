import { supabaseAuth } from './supabaseAuth';
import { consumeGenerationStream } from './generationStream';

export interface ApiUser { id: string; email: string; role?: string }
export interface ApiProject { id: string; name: string; messages: Array<{ id: string; role: 'user' | 'assistant'; text: string }>; versions: ApiVersion[]; activeVersionId: string | null; createdAt: string; updatedAt: string }
export interface ApiVersion { id: string; number: number; prompt?: string; summary: string; templateId: string; options: Record<string, unknown>; files?: Array<{ path: string; content: string }>; warnings?: string[]; createdAt: string }
export interface ApiJob { id: string; status: string; progress: number | null; errorCode?: string }
export interface GenerationStreamEvent { event: string; data: Record<string, unknown> }

export class BackendApiError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message);
    this.name = 'BackendApiError';
  }
}

const API_ROOT = `${import.meta.env.VITE_API_BASE_URL || ''}/api/v1`;
let csrfMemory: string | undefined;
let sessionRestoreInFlight: Promise<{ user: ApiUser }> | undefined;

function csrfToken(): string | undefined {
  return csrfMemory || document.cookie.split('; ').find((part) => part.startsWith('dguy_csrf='))?.slice('dguy_csrf='.length);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase())) {
    const token = csrfToken(); if (token) headers.set('x-csrf-token', decodeURIComponent(token));
  }
  const timeoutSignal = AbortSignal.timeout(20_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try { response = await fetch(`${API_ROOT}${path}`, { ...init, signal, headers, credentials: 'include' }); }
  catch (cause) {
    if (cause instanceof DOMException && cause.name === 'TimeoutError') throw new Error('D-GUY API timed out. Check that the API is running and try again.');
    throw cause;
  }
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new BackendApiError(payload?.error?.message || `API request failed (${response.status})`, payload?.error?.code, response.status);
  return payload as T;
}

export const backendApi = {
  health: () => request<{ status: string; generationProvider: string }>('/health'),
  ready: () => request<{ status: 'ready' }>('/ready'),
  me() {
    if (!sessionRestoreInFlight) {
      const restore = (async () => {
        const current = await request<{ user: ApiUser }>('/auth/me');
        const csrf = await request<{ csrfToken: string }>('/auth/csrf'); csrfMemory = csrf.csrfToken;
        return current;
      })();
      const pending = restore.finally(() => { if (sessionRestoreInFlight === pending) sessionRestoreInFlight = undefined; });
      sessionRestoreInFlight = pending;
    }
    return sessionRestoreInFlight;
  },
  async login(email: string, password: string) {
    const result = await request<{ user: ApiUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), password }) });
    await this.me(); return { user: result.user };
  },
  async adminLogin(email: string, password: string) {
    const result = await request<{ user: ApiUser }>('/auth/admin/login', { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), password }) });
    await this.me(); return { user: result.user };
  },
  async register(fullName: string, email: string, password: string) {
    const result = await request<{ user?: ApiUser; confirmationRequired?: boolean; message?: string }>('/auth/register', { method: 'POST', body: JSON.stringify({ fullName: fullName.trim(), email: email.trim().toLowerCase(), password }) });
    if (!result.user) return result;
    await this.me(); return { user: result.user };
  },
  async verifyEmailCode(email: string, code: string) {
    const result = await request<{ user: ApiUser }>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), code: code.trim() }) });
    await this.me(); return result;
  },
  resendVerificationCode: (email: string) => request<{ message: string }>('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase() }) }),
  async googleSession(accessToken: string, refreshToken: string) {
    const result = await request<{ user: ApiUser }>('/auth/google/session', { method: 'POST', body: JSON.stringify({ accessToken, refreshToken }) });
    await this.me(); return result;
  },
  requestPasswordReset: (email: string) => request<{ message: string }>('/auth/recover', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (accessToken: string, password: string) => request<void>('/auth/password', { method: 'POST', body: JSON.stringify({ accessToken, password }) }),
  async logout() {
    try { await request<void>('/auth/logout', { method: 'POST' }); }
    finally {
      csrfMemory = undefined;
      await supabaseAuth?.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
  },
  async projects(signal?: AbortSignal) {
    const list = await request<{ projects: ApiProject[] }>('/projects?limit=20', { signal });
    return list.projects;
  },
  createProject: (name: string) => request<{ project: ApiProject }>('/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  updateProject: (project: Pick<ApiProject, 'id' | 'name' | 'messages'>) => request<{ project: ApiProject }>(`/projects/${encodeURIComponent(project.id)}`, { method: 'PATCH', body: JSON.stringify({ name: project.name, messages: project.messages }) }),
  deleteProject: (id: string) => request<void>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  startGeneration: (projectId: string, input: { prompt: string; templateId: string; options: object; mode: 'create' | 'revise'; idempotencyKey: string }, signal?: AbortSignal) => {
    const { idempotencyKey, ...body } = input;
    return request<{ job: ApiJob }>(`/projects/${encodeURIComponent(projectId)}/generations`, { method: 'POST', headers: { 'idempotency-key': idempotencyKey }, body: JSON.stringify(body), signal });
  },
  generation: (id: string, signal?: AbortSignal) => request<{ job: ApiJob }>(`/generations/${encodeURIComponent(id)}`, { signal }),
  async streamGeneration(id: string, signal: AbortSignal, onEvent: (event: GenerationStreamEvent) => void) {
    const url = `${API_ROOT}/generations/${encodeURIComponent(id)}/events`;
    await consumeGenerationStream((lastEventId) => fetch(url, {
      credentials: 'include', signal,
      headers: { accept: 'text/event-stream', ...(lastEventId ? { 'last-event-id': lastEventId } : {}) },
    }), signal, onEvent);
  },
  cancelGeneration: (id: string) => request<{ status: string }>(`/generations/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  project: async (id: string, signal?: AbortSignal) => (await request<{ project: ApiProject }>(`/projects/${encodeURIComponent(id)}`, { signal })).project,
  restore: (projectId: string, versionId: string) => request<{ version: ApiVersion }>(`/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST' }),
  exportUrl: (id: string) => `${API_ROOT}/projects/${encodeURIComponent(id)}/export.zip`,
  createPullRequest: (projectId: string, input: { owner: string; repository: string; baseBranch?: string; title: string; body: string }) => request<{ pullRequest: { branch: string; commitSha: string; pullRequestUrl: string } }>(`/projects/${encodeURIComponent(projectId)}/github/pull-request`, { method: 'POST', body: JSON.stringify(input) }),
  deploymentPreparationUrl: (id: string) => `${API_ROOT}/projects/${encodeURIComponent(id)}/deployment-preparation.zip`,
};
