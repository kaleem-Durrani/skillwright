/**
 * DataTable's whole reason to exist over DataList is that it builds ONE
 * rendering of a row, not two hidden by CSS (DataTable.tsx's header comment,
 * the list component it replaced). That claim is only true if the untaken branch is
 * genuinely absent from the DOM, so the viewport tests below assert absence
 * with `container.querySelector`, not `toBeVisible()` — a `display:none` table
 * would still pass a visibility check and would still be the bug this
 * component exists to fix.
 *
 * `window.matchMedia` is not implemented in jsdom (vitest.setup.ts stubs it to
 * always answer "not matched"), so viewport is controlled per test with
 * `stubViewport`, mirroring ThemeToggle.test.tsx's `vi.stubGlobal` pattern —
 * the query answered `true` is `MD_UP` from lib/media.ts itself, not a copied
 * literal, so this file cannot drift from the breakpoint it is testing.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MD_UP } from '@/lib/media';
import { DataTable, type DataTableColumn } from './DataTable.js';

interface Person {
  id: string;
  name: string;
  role: string;
}

const ADA: Person = { id: '1', name: 'Ada Lovelace', role: 'Admin' };
const GRACE: Person = { id: '2', name: 'Grace Hopper', role: 'Teacher' };
const ALAN: Person = { id: '3', name: 'Alan Turing', role: 'Teacher' };
const PEOPLE: Person[] = [ADA, GRACE, ALAN];

const COLUMNS: Array<DataTableColumn<Person>> = [
  { id: 'name', header: 'Name', cell: (row) => row.name },
  { id: 'role', header: 'Role', cell: (row) => row.role },
];

const renderCard = (row: Person) => <div>{row.name}</div>;

function stubViewport(isDesktop: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === MD_UP ? isDesktop : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('single render by viewport', () => {
  it('below md: renders the card list, and the table does not exist in the DOM', () => {
    stubViewport(false);
    const { container } = render(
      <DataTable
        items={PEOPLE}
        columns={COLUMNS}
        getKey={(row) => row.id}
        renderCard={renderCard}
        caption="People"
      />,
    );

    expect(screen.getByRole('list', { name: 'People' })).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
  });

  it('from md up: renders the table, and the card list does not exist in the DOM', () => {
    stubViewport(true);
    const { container } = render(
      <DataTable
        items={PEOPLE}
        columns={COLUMNS}
        getKey={(row) => row.id}
        renderCard={renderCard}
        caption="People"
      />,
    );

    expect(container.querySelector('table')).not.toBeNull();
    expect(screen.queryByRole('list', { name: 'People' })).not.toBeInTheDocument();
  });
});

describe('actions column', () => {
  it('renders once per row, in a column whose header carries no visible label', () => {
    stubViewport(true);
    const actions = vi.fn((row: Person) => <button type="button">Actions for {row.name}</button>);
    render(
      <DataTable
        items={PEOPLE}
        columns={COLUMNS}
        getKey={(row) => row.id}
        renderCard={renderCard}
        caption="People"
        actions={actions}
      />,
    );

    expect(actions).toHaveBeenCalledTimes(PEOPLE.length);

    // Every hand-rolled actions column today (AdminUsers.tsx:232, and three
    // more) uses `header: 'Actions'` as plain visible text, read out once per
    // row by a screen reader in table-navigation mode even though each cell's
    // own control already names itself ("Actions for Grace Hopper"). The
    // column header here still needs a name — for a user who tabs through
    // headers before landing on any row — but it must be the sr-only kind, not
    // the plain kind: that distinction is what this assertion protects.
    const actionsHeader = screen.getAllByRole('columnheader').at(-1);
    if (!actionsHeader) throw new Error('expected an actions column header');
    expect(within(actionsHeader).getByText('Actions')).toHaveClass('sr-only');
  });
});

describe('pagination footer', () => {
  it('renders inside the component and reports the page it moves to', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <DataTable
        items={PEOPLE}
        columns={COLUMNS}
        getKey={(row) => row.id}
        renderCard={renderCard}
        caption="People"
        pagination={{ page: 1, totalPages: 3, onPageChange }}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'People pagination' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

describe('loading and empty states', () => {
  it('shows skeletons while loading, never the empty state', () => {
    stubViewport(true);
    const { container } = render(
      <DataTable
        items={[]}
        columns={COLUMNS}
        getKey={(row) => row.id}
        renderCard={renderCard}
        caption="People"
        loading
        empty={<p>No people yet</p>}
      />,
    );

    expect(screen.queryByText('No people yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // Positive proof a skeleton actually painted, not just an absence of the
    // other two states: Skeleton.tsx marks every placeholder aria-hidden, so a
    // dropped `loading` branch (which would otherwise leave this test green on
    // the two lines above alone) shows up as zero matches here.
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it('shows the empty state only once loading has finished', () => {
    stubViewport(true);
    render(
      <DataTable
        items={[]}
        columns={COLUMNS}
        getKey={(row) => row.id}
        renderCard={renderCard}
        caption="People"
        empty={<p>No people yet</p>}
      />,
    );

    expect(screen.getByText('No people yet')).toBeInTheDocument();
  });
});

describe('row activation', () => {
  it('fires onRowClick for a card below md', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <DataTable
        items={PEOPLE}
        columns={COLUMNS}
        getKey={(row) => row.id}
        renderCard={renderCard}
        caption="People"
        onRowClick={onRowClick}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Grace Hopper' }));
    expect(onRowClick).toHaveBeenCalledWith(GRACE);
  });

  it('makes table rows keyboard-reachable when onRowClick is set', async () => {
    // DataList's table rows have never been keyboard-operable at all — its
    // `<tr onClick>` (the list component it replaced) has no tabIndex and no key handler,
    // only its card `<button>` is reachable. This is the gap DataTable has to
    // close, so the assertion drives Enter through a focused row rather than
    // just calling the handler directly.
    stubViewport(true);
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <DataTable
        items={PEOPLE}
        columns={COLUMNS}
        getKey={(row) => row.id}
        renderCard={renderCard}
        caption="People"
        onRowClick={onRowClick}
      />,
    );

    const row = screen.getByText('Grace Hopper').closest('tr');
    if (!row) throw new Error('expected the row containing Grace Hopper');

    expect(row).toHaveAttribute('tabindex', '0');
    row.focus();
    await user.keyboard('{Enter}');

    expect(onRowClick).toHaveBeenCalledWith(GRACE);
  });

  it('leaves table rows out of the tab order when onRowClick is not set', () => {
    stubViewport(true);
    render(
      <DataTable
        items={PEOPLE}
        columns={COLUMNS}
        getKey={(row) => row.id}
        renderCard={renderCard}
        caption="People"
      />,
    );

    const row = screen.getByText('Grace Hopper').closest('tr');
    if (!row) throw new Error('expected the row containing Grace Hopper');
    expect(row).not.toHaveAttribute('tabindex');
  });
});
