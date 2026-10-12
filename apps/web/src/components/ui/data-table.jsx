import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTable, tableFeatures, rowSortingFeature, rowPaginationFeature, createSortedRowModel, createPaginatedRowModel, sortFn_text, sortFn_alphanumeric } from '@tanstack/react-table';
import { Button } from '@/components/ui/primitives/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/primitives/table';
import { useIsMobile } from '@/hooks/use-mobile';

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { text: sortFn_text, alphanumeric: sortFn_alphanumeric },
});

const recordId = (row, index) => String(row.id ?? index);

/**
 * A sortable, paged table. A table with an action in its last column pushes
 * that action off a phone screen, so a caller can pass `renderCard(record)`:
 * on a narrow screen each row is then stacked as that card instead, with the
 * same order and pages.
 */
export function DataTable({ renderCard, ...table }) {
  return renderCard ? <ResponsiveDataTable renderCard={renderCard} {...table} /> : <DataTableView {...table} />;
}

function ResponsiveDataTable(props) {
  return <DataTableView {...props} stacked={useIsMobile()} />;
}

function DataTableView({ columns, data, label, emptyMessage = 'No results.', pageSize = 10, getRowId = recordId, renderCard, stacked = false }) {
  const [sorting, setSorting] = useState([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize });
  const pageCount = Math.max(1, Math.ceil(data.length / pagination.pageSize));
  const currentPage = Math.min(pagination.pageIndex, pageCount - 1);
  const table = useTable({
    features,
    columns,
    data,
    getRowId,
    state: { sorting, pagination: { ...pagination, pageIndex: currentPage } },
    onSortingChange: (updater) => {
      setSorting(updater);
      setPagination((previous) => ({ ...previous, pageIndex: 0 }));
    },
    onPaginationChange: setPagination,
  });

  return (
    <div className="min-w-0">
      {stacked ? (
        table.getRowModel().rows.length ? (
          <ul aria-label={label} className="divide-y divide-border">
            {table.getRowModel().rows.map((row) => <li key={row.id} className="p-4">{renderCard(row.original)}</li>)}
          </ul>
        ) : <p className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
      <Table aria-label={label}>
        <TableHeader className="bg-muted/40">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="first:pl-6 last:pr-6" aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : undefined}>
                  {!header.isPlaceholder && (header.column.getCanSort() ? (
                    <Button type="button" variant="ghost" size="sm" className="-ml-3" onClick={header.column.getToggleSortingHandler()}>
                      <table.FlexRender header={header} />
                      {header.column.getIsSorted() === 'asc' ? <ArrowUp aria-hidden="true" /> : header.column.getIsSorted() === 'desc' ? <ArrowDown aria-hidden="true" /> : <ArrowUpDown aria-hidden="true" className="text-muted-foreground" />}
                    </Button>
                  ) : <table.FlexRender header={header} />)}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} className="py-4 first:pl-6 last:pr-6">
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          )) : <TableRow><TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">{emptyMessage}</TableCell></TableRow>}
        </TableBody>
      </Table>
      )}
      <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-border py-4 ${stacked ? 'px-4' : 'px-6'}`}>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {data.length ? `${currentPage * pagination.pageSize + 1}–${Math.min((currentPage + 1) * pagination.pageSize, data.length)} of ${data.length}` : '0 results'}
          <span className="ml-3">Page {currentPage + 1} of {pageCount}</span>
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label={`Previous page of ${label}`}><ChevronLeft aria-hidden="true" />Previous</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label={`Next page of ${label}`}>Next<ChevronRight aria-hidden="true" /></Button>
        </div>
      </div>
    </div>
  );
}
