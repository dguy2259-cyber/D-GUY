import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { backendApi } from '@/services/backendApi';
import {
  FileCode2,
  FolderKanban,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';

export type NavKey = 'new' | 'builder' | 'projects' | 'files' | 'history' | 'recovery' | 'settings';

interface NavItem {
  key: NavKey;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'new', label: 'New Project', icon: Plus },
  { key: 'builder', label: 'AI Builder', icon: Sparkles },
  { key: 'projects', label: 'Projects', icon: FolderKanban },
  { key: 'files', label: 'Generated Files', icon: FileCode2 },
  { key: 'history', label: 'Version History', icon: History },
  { key: 'recovery', label: 'Autonomous Error Recovery', icon: ShieldAlert },
  { key: 'settings', label: 'Settings', icon: Settings },
];

interface SidebarProps {
  collapsed: boolean;
  activeKey: NavKey;
  onToggleCollapsed: () => void;
  onNavigate: (key: NavKey) => void;
}

export function Sidebar({ collapsed, activeKey, onToggleCollapsed, onNavigate }: SidebarProps) {
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [provider, setProvider] = useState('Checking');
  useEffect(() => {
    let active = true;
    void Promise.all([backendApi.health(), backendApi.ready()]).then(([health]) => {
      if (active) { setProvider(health.generationProvider); setApiStatus('online'); }
    }).catch(() => { if (active) setApiStatus('offline'); });
    return () => { active = false; };
  }, []);
  const statusRows = [
    { label: 'AI Engine', value: apiStatus === 'online' ? provider : apiStatus === 'checking' ? 'Checking' : 'Unavailable', tone: apiStatus === 'online' ? 'bg-slate' : 'bg-muted' },
    { label: 'Preview Sandbox', value: 'Isolated', tone: 'bg-slate' },
    { label: 'API + Database', value: apiStatus === 'online' ? 'Ready' : apiStatus === 'checking' ? 'Checking' : 'Unavailable', tone: apiStatus === 'online' ? 'bg-slate' : 'bg-muted' },
  ];
  return (
    <aside
      aria-label="Main navigation"
      className={`flex h-full shrink-0 flex-col bg-ivory p-3 transition-[width] duration-300 ease-out ${collapsed ? 'w-[68px]' : 'w-[224px]'}`}
    >
      <nav className="flex flex-1 flex-col gap-1.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.key)}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              className={`group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-medium transition duration-150 ${
                active
                  ? 'shadow-clay-inset bg-porcelain text-terracotta-deep'
                  : 'text-charcoal hover:bg-porcelain/70 hover:shadow-clay'
              } ${collapsed ? 'justify-center px-0' : ''}`}
            >
              {active && <span className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-terracotta" aria-hidden="true" />}
              <Icon size={18} strokeWidth={2} className={active ? 'text-terracotta' : 'text-stone group-hover:text-charcoal'} />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {collapsed && <span className="sr-only">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {!collapsed ? (
        <div className="clay-raised mt-3 rounded-2xl p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-stone">System status</p>
          <dl className="space-y-2.5 text-xs">
            {statusRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-2">
                <dt className="text-stone">{row.label}</dt>
                <dd className="flex items-center gap-1.5 font-semibold text-charcoal">
                  <span className={`h-1.5 w-1.5 rounded-full ${row.tone}`} aria-hidden="true" />
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-2 py-2" aria-label="System status">
          {statusRows.map((row) => (
            <span key={row.label} title={`${row.label}: ${row.value}`} className={`h-2 w-2 rounded-full ${row.tone}`} />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="clay-soft-button mt-3 h-10 w-full !rounded-xl"
      >
        {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>
    </aside>
  );
}
