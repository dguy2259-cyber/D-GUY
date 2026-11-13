import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { backendApi } from '@/services/backendApi';

interface SettingsDialogProps {
  onResetWorkspace: () => void;
  onClose: () => void;
  onLogout: () => void;
}

export function SettingsDialog({ onResetWorkspace, onClose, onLogout }: SettingsDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const [provider, setProvider] = useState('Checking…');
  const [apiStatus, setApiStatus] = useState('Checking…');
  useEffect(() => {
    let active = true;
    void Promise.all([backendApi.health(), backendApi.ready()]).then(([health]) => {
      if (active) { setProvider(health.generationProvider); setApiStatus('Ready'); }
    }).catch(() => { if (active) { setProvider('Unavailable'); setApiStatus('Unavailable'); } });
    return () => { active = false; };
  }, []);
  const rows = [
    { label: 'AI Engine', value: provider, note: 'Website generation tries Gemini first, then Groq, configured OpenRouter, and the existing Hugging Face fallback. Provider keys remain server-side.' },
    { label: 'Preview Sandbox', value: 'Isolated', note: 'Static HTML uses a network-restricted iframe. Supported React, Vite, and Next.js projects run in a browser WebContainer, not on the D-GUY server.' },
    { label: 'API + Database', value: apiStatus, note: 'Project files, versions, and account state are stored in Supabase PostgreSQL.' },
  ];

  return (
    <Modal title="Settings" description="Current engine status and workspace options." onClose={onClose}>
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="clay-inset rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">{row.label}</p>
              <span className="rounded-full bg-porcelain px-3 py-1 text-xs font-semibold text-charcoal shadow-clay">{row.value}</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone">{row.note}</p>
          </div>
        ))}
      </div>

      <button type="button" onClick={onLogout} className="clay-soft-button mt-4 w-full py-2.5 text-sm">Sign out</button>

      <div className="mt-6 rounded-2xl border border-cream p-4">
        <p className="text-sm font-semibold">Reset workspace</p>
        <p className="mt-1 text-xs leading-relaxed text-stone">
          Removes every project and draft in this session and starts a fresh project.
        </p>
        {confirming ? (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                onResetWorkspace();
                onClose();
              }}
              className="clay-button flex-1 py-2.5 text-sm"
            >
              Yes, reset everything
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="clay-soft-button flex-1 py-2.5 text-sm">
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="clay-soft-button mt-4 w-full py-2.5 text-sm">
            Reset workspace
          </button>
        )}
      </div>
    </Modal>
  );
}
