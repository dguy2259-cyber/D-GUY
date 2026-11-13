import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight, FileCode, FileJson, FileText, Folder, FolderOpen } from 'lucide-react';
import type { ProjectFile } from '@/types/project';

interface FolderNode {
  kind: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
}

interface FileNode {
  kind: 'file';
  name: string;
  path: string;
}

type TreeNode = FolderNode | FileNode;

function buildTree(files: ProjectFile[]): TreeNode[] {
  const root: FolderNode = { kind: 'folder', name: '', path: '', children: [] };

  for (const file of files) {
    const segments = file.path.split('/');
    let parent = root;
    segments.forEach((segment, index) => {
      const path = segments.slice(0, index + 1).join('/');
      const isFile = index === segments.length - 1;
      let node = parent.children.find((child) => child.name === segment && child.path === path);
      if (!node) {
        node = isFile
          ? { kind: 'file', name: segment, path }
          : { kind: 'folder', name: segment, path, children: [] };
        parent.children.push(node);
      }
      if (node.kind === 'folder') parent = node;
    });
  }

  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((node) => (node.kind === 'folder' ? { ...node, children: sort(node.children) } : node))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));

  return sort(root.children);
}

function FileIcon({ name }: { name: string }) {
  if (name.endsWith('.json')) return <FileJson size={15} className="shrink-0 text-slate" />;
  if (name.endsWith('.md') || name.endsWith('.css')) return <FileText size={15} className="shrink-0 text-slate" />;
  return <FileCode size={15} className="shrink-0 text-slate" />;
}

interface FileExplorerProps {
  files: ProjectFile[];
  selectedPath: string;
  onSelect: (path: string) => void;
}

export function FileExplorer({ files, selectedPath, onSelect }: FileExplorerProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleFolder = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderNodes = (nodes: TreeNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      const indent = { paddingLeft: `${depth * 14 + 10}px` };
      if (node.kind === 'folder') {
        const open = !collapsed.has(node.path);
        return (
          <div key={node.path}>
            <button
              type="button"
              onClick={() => toggleFolder(node.path)}
              aria-expanded={open}
              style={indent}
              className="flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm font-medium text-charcoal transition hover:bg-porcelain/70"
            >
              <ChevronRight size={14} className={`shrink-0 text-stone transition ${open ? 'rotate-90' : ''}`} />
              {open ? <FolderOpen size={15} className="shrink-0 text-terracotta" /> : <Folder size={15} className="shrink-0 text-terracotta" />}
              <span className="truncate">{node.name}</span>
            </button>
            {open && renderNodes(node.children, depth + 1)}
          </div>
        );
      }
      const selected = node.path === selectedPath;
      return (
        <button
          key={node.path}
          type="button"
          onClick={() => onSelect(node.path)}
          aria-current={selected ? 'true' : undefined}
          style={indent}
          className={`flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left font-mono text-xs transition ${
            selected ? 'shadow-clay-inset bg-porcelain font-semibold text-terracotta-deep' : 'text-charcoal hover:bg-porcelain/70'
          }`}
        >
          <FileIcon name={node.name} />
          <span className="truncate">{node.name}</span>
        </button>
      );
    });

  return (
    <nav aria-label="Project files" className="h-full overflow-y-auto rounded-2xl bg-cream p-2 shadow-clay-inset scrollbar-soft">
      {renderNodes(tree, 0)}
    </nav>
  );
}
