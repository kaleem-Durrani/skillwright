/**
 * Pins the department row menu's two hard requirements:
 *
 * - ROLE GATING: every `department:*` action denies TEACHER and STUDENT outright,
 *   so a teacher gets no menu at all while an admin does;
 * - THE 409: deleting a department that still has courses or members answers
 *   CONFLICT (departments.service.ts:198-205), and that refusal renders INSIDE
 *   the dialog as honest copy — not as a generic toast, and not as a dead end.
 *
 * The DEMO provenance case is pinned here too: the same admin sees the delete
 * item, but the dialog says "Disabled in the demo environment" and the confirm
 * button is disabled — a sentence, not an error shape.
 */
import type { SessionUser } from '@/lib/session';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/problem';
import { qk } from '@/lib/query';

type ApiSend = (path: string, body?: unknown, options?: unknown) => Promise<unknown>;
type ApiFetch = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet, apiPost, apiPatch, apiPut, apiDel } = vi.hoisted(() => ({
  apiGet: vi.fn<ApiFetch>(),
  apiPost: vi.fn<ApiSend>(),
  apiPatch: vi.fn<ApiSend>(),
  apiPut: vi.fn<ApiSend>(),
  apiDel: vi.fn<ApiFetch>(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: apiPost, patch: apiPatch, put: apiPut, del: apiDel },
  };
});

// Imported after the mock so the component resolves the stubbed client.
import { DepartmentRowActions } from './DepartmentRowActions.js';

const DEPARTMENT_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCY';
const ADMIN_ID = '01JGXDFAM0K2Z1GYCSNM5F5RCZ';

function viewer(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: ADMIN_ID,
    email: 'admin@example.edu',
    name: 'Rosa Diaz',
    role: 'ADMIN',
    status: 'ACTIVE',
    provenance: 'PASSWORD',
    avatarUrl: null,
    totpEnabled: false,
    ...overrides,
  };
}

function renderActions(options: {
  session?: SessionUser;
  onDelete?: () => Promise<unknown>;
}): HTMLElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(qk.session, { user: options.session ?? viewer() });
  if (options.onDelete) {
    apiDel.mockImplementation(options.onDelete);
  }
  const { container } = render(
    <QueryClientProvider client={client}>
      <DepartmentRowActions department={{ id: DEPARTMENT_ID, name: 'Welding' }} onEdit={vi.fn()} />
    </QueryClientProvider>,
  );
  return container;
}

beforeAll(() => {
  // jsdom implements none of the pointer-capture API; Radix's menu needs it.
  for (const name of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture']) {
    Object.defineProperty(Element.prototype, name, {
      value: () => false,
      writable: true,
      configurable: true,
    });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockResolvedValue({});
  apiDel.mockResolvedValue(undefined);
});

async function openDeleteDialog(user: UserEvent): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: /actions for welding/i }));
  const item = await screen.findByRole('menuitem', { name: /delete department/i });
  await user.click(item);
  return screen.findByRole('dialog');
}

describe('DepartmentRowActions', () => {
  it('renders nothing for a teacher, whom every department action denies', async () => {
    const container = renderActions({ session: viewer({ role: 'TEACHER' }) });

    expect(container.querySelector('button')).toBeNull();
  });

  it('offers Edit and Delete to an admin, whose role allows both', async () => {
    const user = userEvent.setup();
    renderActions({});

    await user.click(await screen.findByRole('button', { name: /actions for welding/i }));
    expect(screen.getByRole('menuitem', { name: /edit department/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /delete department/i })).toBeInTheDocument();
  });

  it('renders the 409 as copy inside the dialog when members still hang off it', async () => {
    const user = userEvent.setup();
    renderActions({
      // Exactly the body the API answers with: code CONFLICT, detail written for
      // this decision (errors.ts conflict() → problem.detail).
      onDelete: () =>
        Promise.reject(
          new ApiError({
            type: 'about:blank',
            title: 'Conflicting state',
            status: 409,
            detail: 'This department still has courses or members',
            code: 'CONFLICT',
            requestId: 'test',
          }),
        ),
    });

    const dialog = await openDeleteDialog(user);
    expect(within(dialog).getByRole('button', { name: /delete department/i })).toBeEnabled();

    await user.click(within(dialog).getByRole('button', { name: /delete department/i }));

    // Honest, in place, and announced — not a toast that outlives itself.
    const message = await within(dialog).findByRole('status');
    expect(message.textContent).toMatch(/still has courses or members/i);
    // The dialog stays open for the retry after the cause is fixed elsewhere.
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('disables delete for a DEMO session and explains instead of erroring', async () => {
    const user = userEvent.setup();
    renderActions({ session: viewer({ provenance: 'DEMO' }) });

    const dialog = await openDeleteDialog(user);

    expect(dialog.textContent).toMatch(/disabled in the demo environment/i);
    const confirm = within(dialog).getByRole('button', { name: /delete department/i });
    expect(confirm).toBeDisabled();

    // And the mutation never fires: the calm sentence is the whole story.
    await waitFor(() => expect(apiDel).not.toHaveBeenCalled());
  });
});
