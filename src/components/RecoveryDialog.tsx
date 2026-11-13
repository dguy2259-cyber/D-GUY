import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock3, LoaderCircle, Pause, Play, RotateCcw, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { BackendApiError, backendApi, type ApiRecoveryDashboard, type ApiRecoverySession } from '@/services/backendApi';

interface RecoveryDialogProps {
  projectId: string;
  runningSessionId: string | null;
  onClose: () => void;
  onRetry: (sessionId: string) => Promise<void>;
  onPause: (sessionId: string) => void;
  onRollback: (sessionId: string) => Promise<void>;
}

const activeStatuses = new Set(['generating', 'validating']);

function statusLabel(status: string) {
  switch (status) {
    case 'detected': return 'Error detected';
    case 'generating': return 'Generating fix';
    case 'validating': return 'Validating preview';
    case 'retryable': return 'Ready to retry';
    case 'recovered': return 'Recovered';
    case 'paused': return 'Paused';
    case 'rolled_back': return 'Rolled back';
    case 'awaiting_approval': return 'Manual review required';
    default: return 'Failed';
  }
}

function statusTone(status: string) {
  if (status === 'recovered') return 'bg-emerald-50 text-emerald-800';
  if (activeStatuses.has(status)) return 'bg-blue-50 text-blue-800';
  if (status === 'paused' || status === 'retryable' || status === 'detected') return 'bg-amber-50 text-amber-900';
  return 'bg-red-50 text-red-900';
}

function RecoverySessionCard({
  session,
  activeVersionId,
  busy,
  running,
  onRetry,
  onPause,
  onResume,
  onRollback,
}: {
  session: ApiRecoverySession;
  activeVersionId: string | null;
  busy: boolean;
  running: boolean;
  onRetry: () => void;
  onPause: () => void;
  onResume: () => void;
  onRollback: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const latestCandidate = session.attempts.find((attempt) => attempt.candidateVersionId);
  const canRollback = !!latestCandidate?.candidateVersionId && latestCandidate.candidateVersionId === activeVersionId;
  const canRetry = ['detected', 'retryable', 'failed'].includes(session.status) && session.attemptCount < session.maxAttempts;
  const canPause = !['recovered', 'rolled_back', 'failed', 'awaiting_approval'].includes(session.status);
  return (
    <article className="rounded-2xl border border-cream bg-white p-4 shadow-clay">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(session.status)}`}>{statusLabel(session.status)}</span>
            <span className="text-[11px] text-stone">{session.environment.replace('_', ' ')} · {session.category.replace('_', ' ')}</span>
          </div>
          <p className="mt-2 break-words text-sm font-semibold text-charcoal">{session.message}</p>
          <p className="mt-1 text-xs text-stone">
            {session.sourceFile ? `${session.sourceFile}${session.line ? `:${session.line}` : ''}` : 'Source location unavailable'}
            {' · '}
            {new Date(session.createdAt).toLocaleString()}
          </p>
        </div>
        <span className="shrink-0 rounded-lg bg-cream px-2.5 py-1 text-xs font-semibold text-charcoal">
          {session.attemptCount}/{session.maxAttempts} attempts
        </span>
      </div>
      {session.failureReason && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-950">{session.failureReason}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canRetry && <button type="button" disabled={busy || running} onClick={onRetry} className="clay-soft-button h-9 !rounded-xl px-3 text-xs disabled:opacity-50"><RotateCcw size={14} />Retry fix</button>}
        {canPause && session.status !== 'paused' && <button type="button" disabled={busy} onClick={onPause} className="clay-soft-button h-9 !rounded-xl px-3 text-xs disabled:opacity-50"><Pause size={14} />Pause</button>}
        {session.status === 'paused' && <button type="button" disabled={busy || running} onClick={onResume} className="clay-soft-button h-9 !rounded-xl px-3 text-xs disabled:opacity-50"><Play size={14} />Resume</button>}
        {canRollback && <button type="button" disabled={busy || running} onClick={onRollback} className="clay-soft-button h-9 !rounded-xl px-3 text-xs disabled:opacity-50"><RotateCcw size={14} />Restore last working version</button>}
        <button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)} className="ml-auto flex h-9 items-center gap-1 px-2 text-xs font-semibold text-stone hover:text-charcoal">
          {detailsOpen ? 'Hide details' : 'Details'} {detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {detailsOpen && (
        <div className="mt-3 space-y-3 border-t border-cream pt-3">
          {session.stackTrace && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-charcoal p-3 text-[11px] text-white/85">{session.stackTrace}</pre>}
          {session.attempts.length > 0 && <ol className="space-y-2" aria-label="Recovery attempt history">
            {session.attempts.slice().sort((a, b) => a.attemptNumber - b.attemptNumber).map((attempt) => (
              <li key={attempt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-porcelain px-3 py-2 text-xs">
                <span className="font-semibold text-charcoal">Attempt {attempt.attemptNumber}: {statusLabel(attempt.status)}</span>
                <span className="text-stone">{new Date(attempt.startedAt).toLocaleTimeString()}</span>
                {attempt.failureReason && <p className="w-full text-red-800">{attempt.failureReason}</p>}
              </li>
            ))}
          </ol>}
        </div>
      )}
    </article>
  );
}

export function RecoveryDialog({ projectId, runningSessionId, onClose, onRetry, onPause, onRollback }: RecoveryDialogProps) {
  const [dashboard, setDashboard] = useState<ApiRecoveryDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySession, setBusySession] = useState<string | null>(null);
  const [settingBusy, setSettingBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const current = await backendApi.recovery(projectId);
      setDashboard(current);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Recovery history could not be loaded.');
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const current = await backendApi.recovery(projectId);
        if (active) { setDashboard(current); setError(null); }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Recovery history could not be loaded.');
      }
    };
    void load();
    const timer = window.setInterval(() => { if (active) void load(); }, 2_500);
    return () => { active = false; window.clearInterval(timer); };
  }, [projectId]);

  const toggleAutomatic = async () => {
    if (!dashboard) return;
    setSettingBusy(true);
    try {
      const result = await backendApi.setAutoRecovery(projectId, !dashboard.autoRecoveryEnabled);
      setDashboard((current) => current ? { ...current, autoRecoveryEnabled: result.autoRecoveryEnabled } : current);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The recovery setting could not be changed.');
    } finally { setSettingBusy(false); }
  };

  const performAction = async (session: ApiRecoverySession, action: 'pause' | 'resume' | 'retry' | 'rollback') => {
    setBusySession(session.id);
    try {
      if (action === 'pause') { await backendApi.pauseRecovery(projectId, session.id); onPause(session.id); }
      if (action === 'resume') { await backendApi.resumeRecovery(projectId, session.id); void onRetry(session.id); }
      if (action === 'retry') void onRetry(session.id);
      if (action === 'rollback') await backendApi.rollbackRecovery(projectId, session.id).then(() => onRollback(session.id));
      await refresh();
      setError(null);
    } catch (reason) {
      const message = reason instanceof BackendApiError ? reason.message : reason instanceof Error ? reason.message : 'Recovery action failed.';
      setError(message);
      await refresh();
    } finally { setBusySession(null); }
  };

  const sessions = dashboard?.sessions ?? [];
  const monitoring = sessions.some((session) => activeStatuses.has(session.status));
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-charcoal/35 p-3 sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="recovery-title" className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-ivory shadow-clay-lg">
        <header className="flex items-start justify-between gap-4 border-b border-cream px-5 py-4 sm:px-7">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="text-terracotta-deep" size={21} />
              <h2 id="recovery-title" className="text-lg font-bold text-charcoal">Autonomous Error Recovery</h2>
            </div>
            <p className="mt-1 text-xs text-stone">Runtime diagnostics are redacted, scoped to this project, and checked in the isolated preview before they are marked recovered.</p>
          </div>
          <button type="button" aria-label="Close recovery dashboard" onClick={onClose} className="clay-soft-button h-9 w-9 !rounded-xl"><X size={17} /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cream bg-white p-4">
            <div className="flex items-start gap-3">
              {dashboard?.autoRecoveryEnabled ? <ShieldCheck className="mt-0.5 text-emerald-700" size={19} /> : <ShieldAlert className="mt-0.5 text-stone" size={19} />}
              <div>
                <p className="text-sm font-semibold text-charcoal">Automatic correction</p>
                <p className="mt-1 max-w-lg text-xs leading-relaxed text-stone">When enabled, D-GUY may use the configured AI provider. Recovery is capped at 5 attempts per error and 10 attempts per account per day; risky configuration changes stop for review.</p>
              </div>
            </div>
            <button type="button" role="switch" aria-checked={dashboard?.autoRecoveryEnabled ?? false} disabled={!dashboard || settingBusy} onClick={() => void toggleAutomatic()} className={`relative h-7 w-12 rounded-full transition disabled:opacity-50 ${dashboard?.autoRecoveryEnabled ? 'bg-terracotta' : 'bg-slate/40'}`}>
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${dashboard?.autoRecoveryEnabled ? 'left-6' : 'left-1'}`} />
            </button>
          </div>

          {monitoring && <p role="status" className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900"><Activity size={15} />Recovery status refreshes automatically while an attempt is active.</p>}
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-900">{error}</p>}
          {!dashboard && !error && <p role="status" className="flex items-center gap-2 text-sm text-stone"><LoaderCircle size={16} className="animate-spin" />Loading recovery history…</p>}
          {dashboard && sessions.length === 0 && <div className="rounded-2xl bg-white p-6 text-center">
            <CheckCircle2 size={26} className="mx-auto text-slate" />
            <p className="mt-2 text-sm font-semibold text-charcoal">No runtime errors recorded</p>
            <p className="mt-1 text-xs text-stone">Supported sandbox previews report runtime and unhandled-rejection errors here.</p>
          </div>}
          {sessions.map((session) => (
            <RecoverySessionCard
              key={session.id}
              session={session}
              activeVersionId={dashboard?.activeVersionId ?? null}
              busy={busySession === session.id}
              running={runningSessionId === session.id}
              onRetry={() => void performAction(session, 'retry')}
              onPause={() => void performAction(session, 'pause')}
              onResume={() => void performAction(session, 'resume')}
              onRollback={() => void performAction(session, 'rollback')}
            />
          ))}
          {dashboard && sessions.length > 0 && <p className="flex items-center gap-2 text-[11px] text-stone"><Clock3 size={13} />History is retained with the project and limited to the latest 20 error episodes.</p>}
          {dashboard && sessions.some((session) => session.status === 'awaiting_approval') && <p role="note" className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-950"><AlertTriangle size={15} />Automatic repair will not change dependencies, authentication, deployment, or security configuration.</p>}
          {busySession && <span className="sr-only" role="status">Updating recovery session</span>}
        </div>
      </section>
    </div>
  );
}
