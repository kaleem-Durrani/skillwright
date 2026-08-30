import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import type { Paginated } from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import type { DepartmentSummary } from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Gate } from '@/components/Gate';
import { DepartmentFormDialog } from '@/components/departments/DepartmentFormDialog';
import { DepartmentRowActions } from '@/components/departments/DepartmentRowActions';
import { Route } from '@/routes/_app/admin.departments';

/**
 * The admin view of the department list. `GET /departments` serves summaries —
 * `{ id, name, slug }` (department.ts:5-9) — so the counts a directory might want
 * live behind each row's detail page (`department:read`), not in this table.
 */
export function AdminDepartmentsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const [term, setTerm] = useState(search.q ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DepartmentSummary | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((search.q ?? '') === term) return;
      void navigate({
        search: ({ q: _clearedQ, ...previous }) => ({
          ...previous,
          ...(term ? { q: term } : {}),
          page: 1,
        }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term, search.q, navigate]);

  const departments = useQuery({
    queryKey: ['departments', search],
    queryFn: () =>
      api.get<Paginated<DepartmentSummary>>('/departments', {
        query: { page: search.page, limit: 20, q: search.q },
      }),
    placeholderData: (previous) => previous,
  });

  const isFiltered = Boolean(search.q);

  return (
    // `min-h-0 flex-1` so the table below can claim the remaining height — the
    // register is this screen's main content, same contract as AdminUsers.
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Departments"
        description="The structure courses and members hang off."
        actions={
          <Gate action="department:create">
            <Button
              block
              className="sm:w-auto"
              leadingIcon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => setCreating(true)}
            >
              New department
            </Button>
          </Gate>
        }
      />

      <div className="flex flex-col gap-3 pb-(--space-block) md:flex-row md:items-center">
        <Input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search departments"
          aria-label="Search departments"
          leading={<Search aria-hidden="true" className="size-4" />}
          className="md:w-80"
        />
        {isFiltered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTerm('');
              void navigate({ search: { page: 1 } });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <DataTable
        fillHeight
        items={departments.data?.data ?? []}
        loading={departments.isPending}
        caption="Departments"
        getKey={(department) => department.id}
        columns={[
          {
            id: 'name',
            header: 'Department',
            cell: (department) => (
              <Link
                to="/departments/$id"
                params={{ id: department.id }}
                className="font-medium text-fg hover:text-fg-brand"
              >
                {department.name}
              </Link>
            ),
          },
          {
            id: 'slug',
            header: 'Web address',
            cell: (department) => (
              <span className="font-mono text-xs text-fg-tertiary">/{department.slug}</span>
            ),
            secondary: true,
          },
        ]}
        actions={(department) => (
          <DepartmentRowActions
            department={{ id: department.id, name: department.name }}
            onEdit={() => setEditing(department)}
          />
        )}
        pagination={
          departments.data
            ? {
                page: departments.data.meta.page,
                totalPages: departments.data.meta.totalPages,
                total: departments.data.meta.total,
                limit: departments.data.meta.limit,
                onPageChange: (page) =>
                  void navigate({ search: (previous) => ({ ...previous, page }) }),
              }
            : undefined
        }
        renderCard={(department) => (
          <Card className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <CardTitle className="text-base">
                <Link
                  to="/departments/$id"
                  params={{ id: department.id }}
                  className="hover:text-fg-brand"
                >
                  {department.name}
                </Link>
              </CardTitle>
              <span className="truncate font-mono text-2xs text-fg-tertiary">
                /{department.slug}
              </span>
            </div>
            <DepartmentRowActions
              department={{ id: department.id, name: department.name }}
              onEdit={() => setEditing(department)}
            />
          </Card>
        )}
        empty={
          isFiltered ? (
            <EmptyState
              variant="no-results"
              description="No department matched that search."
              actionLabel="Clear filters"
              onAction={() => {
                setTerm('');
                void navigate({ search: { page: 1 } });
              }}
            />
          ) : (
            <EmptyState
              variant="empty"
              title="No departments yet"
              description="Registration needs at least one department before anyone can join."
            />
          )
        }
      />

      <DepartmentFormDialog open={creating} onOpenChange={setCreating} />
      {editing ? (
        <DepartmentFormDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          department={{ id: editing.id, name: editing.name }}
        />
      ) : null}
    </div>
  );
}
