/**
 * The student's Qualifications tab, and the two claims it makes that a markup
 * assertion would not catch.
 *
 *   - A REVOKED certificate stays on the screen, says so, says when, and says why.
 *     The tempting implementation is to filter it out of the list — a withdrawn
 *     credential is not one to display — and that would make this tab the only place
 *     in the system claiming the certificate does not exist, and the one place an
 *     employer cannot check. The API still serves the PDF, and the public verify route
 *     still answers for the reference with `revoked: true`.
 *
 *   - There is NO policy gate on the panel. `certificate:read` reads `studentId` and
 *     `courseTeacherId`, and this screen has neither, so a bare `can()` would deny
 *     every viewer including admins and the tab would silently never load. The list
 *     self-scopes on the server instead. Asserting the fetch HAPPENS is the only way
 *     to notice that regression, because a disabled query renders a skeleton forever
 *     with no error and no log line — LESSONS-LEARNED #15, which has cost this
 *     application two navigation entries and one whole tab.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CertificateDto } from '@skillwright/shared/schema';

type ApiGet = (path: string, options?: unknown) => Promise<unknown>;

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn<ApiGet>() }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { get: apiGet, post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() },
  };
});

import { Toaster } from '@/components/ui/Toast';
import { QualificationsPanel } from './QualificationsPanel';

const REFERENCE = '9F2A7C4B1D6E8A035C7B9D2E4K6P';

function certificate(overrides: Partial<CertificateDto> = {}): CertificateDto {
  return {
    id: '01JGXDFAM0K2Z1GYCSNM5F5RCX',
    reference: REFERENCE,
    issuedAt: '2026-09-20T09:00:00.000Z',
    issuedBy: { id: 'u-1', name: 'Dana Okafor', role: 'TEACHER', avatarUrl: null },
    qualification: {
      id: 'q-1',
      code: 'cswip-31',
      name: 'CSWIP 3.1 Welding Inspector',
      level: 'Level 3',
      awardingBody: 'BSI',
    },
    enrollmentId: '01JGXDFAM0K2Z1GYCSNM5F5RD4',
    revokedAt: null,
    revokedBy: null,
    revokedReason: null,
    artifact: {
      id: 'up-1',
      originalName: `certificate-${REFERENCE}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 3854,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // `window.location.assign` is a jsdom navigation the test cannot survive, and it is
  // the whole of the download's behaviour, so it is stubbed and asserted on rather than
  // left to throw.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: vi.fn() },
  });
  apiGet.mockResolvedValue({ data: [certificate()] });
});

function renderPanel(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <QualificationsPanel />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('QualificationsPanel', () => {
  it('fetches its own list and names the qualification, its standard and its date', async () => {
    renderPanel();

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/certificates'));
    expect(await screen.findByText('CSWIP 3.1 Welding Inspector')).toBeInTheDocument();
    expect(screen.getByText(/cswip-31 · Level Level 3 · BSI/)).toBeInTheDocument();
    expect(screen.getByText(/Issued/)).toBeInTheDocument();
    // The reference is what the holder is CHECKED by, so it is on the screen and not
    // only inside the PDF. The PDF is the document; this is the number on it.
    expect(screen.getByText(REFERENCE)).toBeInTheDocument();
  });

  it('sends the browser to the signed URL when the document is tapped', async () => {
    const user = userEvent.setup();
    apiGet.mockImplementation((path: string) =>
      path === '/certificates'
        ? Promise.resolve({ data: [certificate()] })
        : Promise.resolve({
            url: 'https://minio.example/certificates/x.pdf?X-Amz-Signature=abc',
            expiresAt: '2026-09-20T09:05:00.000Z',
            filename: 'certificate.pdf',
          }),
    );
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Download' }));

    await waitFor(() =>
      expect(apiGet).toHaveBeenCalledWith(`/certificates/${certificate().id}/download`),
    );
    await waitFor(() =>
      expect(window.location.assign).toHaveBeenCalledWith(
        'https://minio.example/certificates/x.pdf?X-Amz-Signature=abc',
      ),
    );
  });

  it('keeps a revoked certificate on screen and says when and why', async () => {
    apiGet.mockResolvedValue({
      data: [
        certificate({
          revokedAt: '2026-10-02T11:00:00.000Z',
          revokedBy: { id: 'u-9', name: 'Priya Raman', role: 'ADMIN', avatarUrl: null },
          revokedReason: 'Issued against the wrong intake record by the registrar.',
        }),
      ],
    });
    renderPanel();

    // The row is still here. Filtering it out would make this tab the only place in the
    // system claiming the certificate does not exist.
    expect(await screen.findByText('CSWIP 3.1 Welding Inspector')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText(/by Priya Raman/)).toBeInTheDocument();
    expect(screen.getByText(/Issued against the wrong intake record/)).toBeInTheDocument();
    // And the document is still downloadable: the artefact is the record of what was
    // issued, and hiding it would hide the revocation's evidence.
    expect(
      screen.getByRole('button', { name: /Download the issued certificate/ }),
    ).toBeInTheDocument();
  });

  it('says there is nothing to award rather than rendering an empty box', async () => {
    apiGet.mockResolvedValue({ data: [] });
    renderPanel();

    expect(await screen.findByText('No qualifications yet')).toBeInTheDocument();
  });

  it('says the document is missing without pretending the certificate is not', async () => {
    apiGet.mockResolvedValue({ data: [certificate({ artifact: null })] });
    renderPanel();

    expect(await screen.findByText('CSWIP 3.1 Welding Inspector')).toBeInTheDocument();
    expect(
      screen.getByText(/The document for this certificate is not available/),
    ).toBeInTheDocument();
    // No download button at all, rather than one that 409s when it is tapped.
    expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
  });
});
