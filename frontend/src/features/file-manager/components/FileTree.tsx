// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/** Left-pane category list for the file manager. */

import { useTranslation } from 'react-i18next';
import { FileText, Image as ImageIcon, Layout, Box, Pencil, Folder, Tag, FileBarChart, PenTool, HardDrive, X } from 'lucide-react';
import clsx from 'clsx';
import type { FileTreeNode, FileKind } from '../types';
import { TrashNode } from '@/features/file-trash/TrashNode';
import { SavedViewsRail } from '@/features/file-saved-views';
import { fmtFixed } from '@/shared/lib/formatters';

const KIND_ICONS: Record<FileKind, typeof FileText> = {
  document: FileText,
  photo: ImageIcon,
  sheet: Layout,
  bim_model: Box,
  dwg_drawing: Pencil,
  takeoff: Tag,
  report: FileBarChart,
  markup: PenTool,
};

interface FileTreeProps {
  nodes: FileTreeNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  isLoading?: boolean;
  /** Active project — when set, mounts saved-views rail and routes the
   *  per-project Recycle Bin link to `/files/trash`. */
  projectId?: string | null;
  /**
   * Below `md` this tree renders as an off-canvas drawer instead of a
   * permanent 240px column (which alone ate ~64% of a 375px viewport with
   * no way to reach the file grid). `mobileOpen` controls the drawer;
   * `onMobileClose` fires on backdrop click, the drawer's own close
   * button, and after a category is picked. At `md:` and above these are
   * unused and the tree is always visible, matching the previous behavior.
   */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

function fmtBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fmtFixed(bytes / 1024, 1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${fmtFixed(bytes / (1024 * 1024), 1)} MB`;
  return `${fmtFixed(bytes / (1024 * 1024 * 1024), 2)} GB`;
}

export function FileTree({
  nodes,
  selectedId,
  onSelect,
  isLoading,
  projectId,
  mobileOpen = false,
  onMobileClose,
}: FileTreeProps) {
  const { t } = useTranslation();

  const handleSelect = (id: string | null) => {
    onSelect(id);
    onMobileClose?.();
  };

  const totalCount = nodes.reduce((acc, n) => acc + n.file_count, 0);
  const totalBytes = nodes.reduce((acc, n) => acc + n.total_bytes, 0);

  /* Per-category breakdown drives the proportional storage bar. We cap at the
     5 largest categories so the bar stays readable; everything else collapses
     into a neutral "Other" wedge. */
  const STORAGE_TINTS: Record<FileKind, string> = {
    document: 'bg-blue-400',
    photo: 'bg-emerald-400',
    sheet: 'bg-amber-400',
    bim_model: 'bg-violet-400',
    dwg_drawing: 'bg-orange-400',
    takeoff: 'bg-cyan-400',
    report: 'bg-pink-400',
    markup: 'bg-rose-400',
  };
  const storageBreakdown = totalBytes > 0
    ? [...nodes]
        .filter((n) => n.total_bytes > 0)
        .sort((a, b) => b.total_bytes - a.total_bytes)
        .slice(0, 6)
    : [];

  return (
    <>
      {/* Backdrop — mobile only, closes the drawer on outside click. */}
      {mobileOpen && (
        <div
          aria-hidden="true"
          onClick={onMobileClose}
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm md:hidden"
        />
      )}
      <aside
        className={clsx(
          'overflow-y-auto border-r border-border-light bg-surface-secondary/40',
          // Off-canvas drawer below `md`; permanent 240px column at `md:`+.
          'fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] transform transition-transform duration-200 ease-oe',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'md:static md:z-auto md:w-60 md:shrink-0 md:translate-x-0',
        )}
      >
        <div className="flex justify-end px-3 pt-3 md:hidden">
          <button
            type="button"
            onClick={onMobileClose}
            aria-label={t('common.close', { defaultValue: 'Close' })}
            className="flex h-7 w-7 items-center justify-center rounded-md text-content-tertiary hover:bg-surface-secondary"
          >
            <X size={15} />
          </button>
        </div>
      {totalBytes > 0 && (
        <div className="px-3 pt-3 pb-3 border-b border-border-light">
          <div className="flex items-center gap-1.5 mb-2 text-2xs font-medium uppercase tracking-wider text-content-tertiary">
            <HardDrive size={11} strokeWidth={2} />
            <span>{t('files.tree.storage_used', { defaultValue: 'Storage used' })}</span>
          </div>
          <div className="text-base font-semibold text-content-primary tabular-nums">
            {fmtBytes(totalBytes)}
          </div>
          <div className="text-[10px] text-content-tertiary mb-2">
            {t('files.tree.file_count', {
              defaultValue: '{{count}} files',
              count: totalCount,
            })}
          </div>
          <div
            className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-tertiary"
            role="img"
            aria-label={t('files.tree.storage_breakdown', { defaultValue: 'Storage by category' })}
          >
            {storageBreakdown.map((node) => {
              const kind = node.id.replace(/^category:/, '') as FileKind;
              const pct = (node.total_bytes / totalBytes) * 100;
              return (
                <span
                  key={node.id}
                  className={clsx('block h-full', STORAGE_TINTS[kind] ?? 'bg-gray-300')}
                  style={{ width: `${pct}%` }}
                  title={`${t(`files.category.${kind}`, { defaultValue: node.label })}: ${fmtBytes(node.total_bytes)}`}
                />
              );
            })}
          </div>
        </div>
      )}

      <div className="px-3 pt-3 pb-2">
        <div className="text-2xs font-medium uppercase tracking-wider text-content-tertiary px-2 mb-1">
          {t('files.tree.title', { defaultValue: 'Categories' })}
        </div>

        <button
          type="button"
          onClick={() => handleSelect(null)}
          className={clsx(
            'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors',
            selectedId === null
              ? 'bg-oe-blue/10 text-oe-blue font-medium'
              : 'text-content-secondary hover:bg-surface-secondary',
          )}
        >
          <Folder size={14} className="shrink-0" />
          <span className="flex-1 truncate">
            {t('files.tree.all', { defaultValue: 'All files' })}
          </span>
          <span className="text-2xs text-content-tertiary tabular-nums">{totalCount}</span>
        </button>
      </div>

      <ul className="px-3 pb-4 space-y-0.5">
        {nodes.map((node) => {
          // Strip any legacy "category:" prefix from older backends.
          const kind = node.id.replace(/^category:/, '') as FileKind;
          const Icon = KIND_ICONS[kind] ?? Folder;
          const isActive = selectedId === kind;
          return (
            <li key={node.id}>
              <button
                type="button"
                onClick={() => handleSelect(kind)}
                className={clsx(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors',
                  isActive
                    ? 'bg-oe-blue/10 text-oe-blue font-medium'
                    : 'text-content-secondary hover:bg-surface-secondary',
                )}
              >
                <Icon size={14} className="shrink-0" />
                <span className="flex-1 truncate">
                  {t(`files.category.${kind}`, { defaultValue: node.label })}
                </span>
                <span className="text-2xs text-content-tertiary tabular-nums shrink-0">
                  {node.file_count}
                </span>
              </button>
              {node.total_bytes > 0 && (
                <div className="ps-8 pe-2 text-[10px] text-content-quaternary tabular-nums">
                  {fmtBytes(node.total_bytes)}
                </div>
              )}
            </li>
          );
        })}
        {!isLoading && nodes.length === 0 && (
          <li className="px-2 py-3 text-xs text-content-tertiary">
            {t('files.tree.empty', { defaultValue: 'No files yet.' })}
          </li>
        )}
      </ul>

      {projectId && (
        <div className="border-t border-border-light pt-2 mt-2">
          <SavedViewsRail projectId={projectId} />
        </div>
      )}

      <div className="mt-2 px-3 pb-3 border-t border-border-light pt-2">
        <TrashNode projectId={projectId ?? null} active={selectedId === 'trash'} />
      </div>
      </aside>
    </>
  );
}
