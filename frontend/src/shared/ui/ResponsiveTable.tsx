// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// ResponsiveTable - a data table that degrades to a stacked card list below
// a chosen breakpoint instead of forcing horizontal scroll on a phone-width
// table. The `sm:contents` trick used elsewhere on this branch (see the
// comments in CasesPage/DashboardCasesCard) doesn't apply to <table>
// itself: a <tr>'s children must stay <td>s for the table layout algorithm
// to run, so a row can't "un-become" a row via `contents` the way a flex
// header can - the markup has to actually change shape below the
// breakpoint, which is what this component does.
//
// Usage:
//   <ResponsiveTable
//     columns={[
//       { key: 'name', header: 'Name', isCardTitle: true },
//       { key: 'status', header: 'Status', render: (row) => <Badge>{row.status}</Badge> },
//     ]}
//     rows={items}
//     rowKey={(row) => row.id}
//   />

import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Skeleton } from './Skeleton';
import { EmptyState } from './EmptyState';

export interface ResponsiveTableColumn<T> {
  /** Unique key for the column - also used as the React key and, when
   *  `render` is omitted, to read the cell value off the row. */
  key: string;
  /** Column header - shown in the table head and as the card-row label. */
  header: ReactNode;
  /** Cell content. Defaults to `row[key]` when omitted. */
  render?: (row: T, index: number) => ReactNode;
  /** Extra classes for the <th>/<td>, e.g. text alignment or width. */
  className?: string;
  /** Drop this column from the card layout entirely, e.g. an id column
   *  that only makes sense as a table header. */
  hideOnCard?: boolean;
  /** Render as the card's title line instead of a label/value row. Only
   *  the first column with this flag is used. */
  isCardTitle?: boolean;
}

export interface ResponsiveTableProps<T> {
  columns: ResponsiveTableColumn<T>[];
  rows: T[];
  /** Stable key for each row - falls back to the row's index. */
  rowKey?: (row: T, index: number) => string | number;
  /** Optional row click handler - also makes cards keyboard-focusable. */
  onRowClick?: (row: T, index: number) => void;
  isLoading?: boolean;
  /** Number of skeleton placeholders shown while `isLoading`. Default 3. */
  skeletonRows?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  /** Breakpoint below which rows render as cards instead of a table.
   *  Default 'md'. */
  stackBelow?: 'sm' | 'md' | 'lg';
}

// Written as literal class strings (not interpolated) so Tailwind's JIT
// scanner picks them up from this file's source text.
const TABLE_DISPLAY_CLASS: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'sm:table',
  md: 'md:table',
  lg: 'lg:table',
};
const CARDS_HIDDEN_CLASS: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'sm:hidden',
  md: 'md:hidden',
  lg: 'lg:hidden',
};

function cellValue<T>(row: T, column: ResponsiveTableColumn<T>, index: number): ReactNode {
  if (column.render) return column.render(row, index);
  return (row as Record<string, ReactNode>)[column.key];
}

export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  isLoading = false,
  skeletonRows = 3,
  emptyTitle = 'No data',
  emptyDescription,
  className,
  stackBelow = 'md',
}: ResponsiveTableProps<T>) {
  const keyFor = (row: T, index: number) => rowKey?.(row, index) ?? index;

  if (isLoading) {
    return (
      <div className={clsx('space-y-2', className)}>
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <Skeleton key={i} height={44} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className={className} />;
  }

  const titleColumn = columns.find((c) => c.isCardTitle);
  const cardColumns = columns.filter((c) => c !== titleColumn && !c.hideOnCard);

  return (
    <div className={className}>
      <table className={clsx('hidden w-full border-collapse text-sm', TABLE_DISPLAY_CLASS[stackBelow])}>
        <thead>
          <tr className="border-b border-border-light text-left text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={clsx('px-3 py-2 font-medium', column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-light">
          {rows.map((row, index) => (
            <tr
              key={keyFor(row, index)}
              onClick={onRowClick ? () => onRowClick(row, index) : undefined}
              className={clsx('text-content-primary', onRowClick && 'cursor-pointer hover:bg-surface-secondary')}
            >
              {columns.map((column) => (
                <td key={column.key} className={clsx('px-3 py-2.5 align-middle', column.className)}>
                  {cellValue(row, column, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className={clsx('space-y-2', CARDS_HIDDEN_CLASS[stackBelow])}>
        {rows.map((row, index) => (
          <div
            key={keyFor(row, index)}
            onClick={onRowClick ? () => onRowClick(row, index) : undefined}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            className={clsx(
              'rounded-lg border border-border-light bg-surface-elevated p-3',
              onRowClick && 'cursor-pointer hover:bg-surface-secondary',
            )}
          >
            {titleColumn && (
              <div className="text-sm font-semibold text-content-primary">
                {cellValue(row, titleColumn, index)}
              </div>
            )}
            <dl className={clsx('space-y-1', titleColumn && 'mt-2')}>
              {cardColumns.map((column) => (
                <div key={column.key} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="shrink-0 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {column.header}
                  </dt>
                  <dd className="min-w-0 truncate text-right text-content-primary">
                    {cellValue(row, column, index)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
