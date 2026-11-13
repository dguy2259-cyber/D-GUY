import { Check, ChevronDown, Hexagon, Menu, Plus, Settings, User } from 'lucide-react';
import { Dropdown, MenuItem } from '@/components/Dropdown';
import { StatusBadge } from '@/components/StatusBadge';
import type { PreviewStatus, WorkspaceProject } from '@/types/project';

interface TopBarProps {
  projects: WorkspaceProject[];
  activeProject: WorkspaceProject;
  previewStatus: PreviewStatus;
  saveLabel: string;
  onSelectProject: (projectId: string) => void;
  onNewProject: () => void;
  onOpenProjects: () => void;
  onOpenSettings: () => void;
  onToggleMenu: () => void;
}

export function TopBar({
  projects,
  activeProject,
  previewStatus,
  saveLabel,
  onSelectProject,
  onNewProject,
  onOpenProjects,
  onOpenSettings,
  onToggleMenu,
}: TopBarProps) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-cream bg-porcelain px-4 py-2.5 lg:px-6">
      <button
        type="button"
        onClick={onToggleMenu}
        aria-label="Open navigation menu"
        className="clay-soft-button h-10 w-10 !rounded-xl !p-0 md:hidden"
      >
        <Menu size={18} />
      </button>

      <div className="flex items-center gap-3">
        <div className="shadow-clay-inset flex h-10 w-10 items-center justify-center rounded-[14px] bg-peach/60">
          <Hexagon size={20} className="text-terracotta-deep" strokeWidth={2.2} />
        </div>
        <div className="hidden leading-tight sm:block">
          <p className="text-base font-bold tracking-tight">D-GUY</p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone">Autonomous AI Software Engineer</p>
        </div>
      </div>

      <div className="mx-auto min-w-0 flex-1 md:mx-4 md:flex-none">
        <Dropdown
          label="Switch project"
          align="left"
          triggerClassName="clay-soft-button mx-auto h-10 max-w-full !px-3 md:max-w-[260px]"
          trigger={
            <>
              <span className="min-w-0 truncate text-sm">{activeProject.name}</span>
              <ChevronDown size={16} className="shrink-0 text-stone" />
            </>
          }
        >
          {(close) => (
            <div className="w-64">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-stone">Projects</p>
              {projects.map((project) => (
                <MenuItem
                  key={project.id}
                  label={project.name}
                  detail={`${project.versions.length} ${project.versions.length === 1 ? 'version' : 'versions'}`}
                  active={project.id === activeProject.id}
                  icon={project.id === activeProject.id ? <Check size={16} className="text-terracotta-deep" /> : undefined}
                  onSelect={() => {
                    onSelectProject(project.id);
                    close();
                  }}
                />
              ))}
              <div className="my-2 border-t border-cream" />
              <MenuItem
                label="New project"
                icon={<Plus size={16} />}
                onSelect={() => {
                  onNewProject();
                  close();
                }}
              />
            </div>
          )}
        </Dropdown>
      </div>

      <div className="ml-auto flex items-center gap-2 md:gap-3">
        <div className="hidden items-center gap-2 lg:flex">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-stone">Generation</span>
          <StatusBadge status={previewStatus} />
        </div>
        <span className="hidden text-xs text-stone xl:inline" aria-live="polite">
          {saveLabel}
        </span>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open settings"
          className="clay-soft-button h-10 w-10 !rounded-xl !p-0"
        >
          <Settings size={18} />
        </button>
        <Dropdown
          label="Account menu"
          align="right"
          triggerClassName="clay-soft-button h-10 w-10 !rounded-full !p-0"
          trigger={<User size={18} className="text-stone" />}
        >
          {(close) => (
            <div className="w-56">
              <MenuItem
                label="Projects"
                onSelect={() => {
                  onOpenProjects();
                  close();
                }}
              />
              <MenuItem
                label="Settings"
                onSelect={() => {
                  onOpenSettings();
                  close();
                }}
              />
              <MenuItem
                label="New project"
                icon={<Plus size={16} />}
                onSelect={() => {
                  onNewProject();
                  close();
                }}
              />
            </div>
          )}
        </Dropdown>
      </div>
    </header>
  );
}
