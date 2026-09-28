import { useMutation, useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { toast } from '@/components/ui/Toast';
import { qk } from '@/lib/query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonList } from '@/components/ui/Skeleton';
import type { CertificateDto, CertificateList, DownloadUrlResponse } from '@/lib/types';

/**
 * A student's Qualifications tab: what they have been awarded, when, and whether it
 * still stands — with the document itself one tap away.
 *
 * WHY THERE IS NO POLICY GATE ON THIS PANEL, which is the decision on the whole file.
 * `certificate:read` reads `studentId` and `courseTeacherId`, both of which are absent
 * from any subject this screen could build, and a rule that reads an absent field DENIES
 * (LESSONS-LEARNED #15/#31). So a bare `can()` here would return `false` for every
 * viewer including admins and the tab would silently never load — which is exactly the
 * failure that hid the Courses link and the Messages link in this application before.
 *
 * The list is a WHERE clause instead. `visibilityWhere` in `certificates.service.ts`
 * mirrors the policy rows as SQL and scopes a student to their own rows, which is the
 * same arrangement `GET /enrollments` and `GET /assignments/mine` use and for the same
 * reason. What this panel renders is what the API decided to serve.
 *
 * WHY A LIST OF CARDS AND NOT A `DataTable`. A certificate is a document with a name, a
 * date, a state and one action — there is no second column to lose at 375px, and
 * `DataTable`'s card rendering exists to rescue a table that does not fit. A single
 * column of cards is the honest shape, and it is what the Assignments panel does for the
 * same kind of record.
 */
export function QualificationsPanel(): ReactElement {
  const certificates = useQuery({
    queryKey: qk.certificates(),
    queryFn: () => api.get<CertificateList>('/certificates'),
  });

  /**
   * One mutation for the whole list rather than one per row — hooks cannot be called
   * from inside a render callback. `variables` holds the id it was called with while
   * the request is in flight, which is how only the tapped row shows a spinner.
   *
   * `window.location.assign`, not an `<a download>`, for the reason `CourseDetail`
   * states at its own download: the signed GET carries
   * `ResponseContentDisposition: attachment`, so the browser saves the file and this
   * page stays put. The `download` attribute is ignored on a cross-origin href by every
   * browser, which is exactly why the server puts the name in the header.
   */
  const download = useMutation({
    mutationFn: (certificateId: string) =>
      api.get<DownloadUrlResponse>(`/certificates/${certificateId}/download`),
    onSuccess: (result) => window.location.assign(result.url),
    onError: (error) => toast.fromError(error, 'Could not start that download'),
  });

  if (certificates.isPending) return <SkeletonList rows={2} />;

  const rows = certificates.data?.data ?? [];

  return (
    <div className="flex flex-col gap-3 pb-(--space-block)">
      {rows.length === 0 ? (
        <EmptyState
          variant="empty"
          title="No qualifications yet"
          description="Finish a course and your teacher will issue your certificate here. It arrives as a downloadable document with a reference you can be checked against."
        />
      ) : (
        rows.map((certificate) => (
          <CertificateCard
            key={certificate.id}
            certificate={certificate}
            pending={download.isPending && download.variables === certificate.id}
            onDownload={() => download.mutate(certificate.id)}
          />
        ))
      )}
    </div>
  );
}

function CertificateCard({
  certificate,
  pending,
  onDownload,
}: {
  certificate: CertificateDto;
  pending: boolean;
  onDownload: () => void;
}) {
  const revoked = certificate.revokedAt !== null;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="font-medium text-fg">{certificate.qualification.name}</p>
        <p className="text-xs text-fg-secondary">
          {certificate.qualification.code} · Level {certificate.qualification.level} ·{' '}
          {certificate.qualification.awardingBody}
        </p>
      </div>

      {/*
        A revoked row says SO, WHEN, and WHY — in that order of importance to the person
        reading it, and it stays on the screen rather than being filtered out.

        The row is not hidden because a certificate is a record, not a live permission:
        the PDF behind it is still the document that was issued, the API still serves it
        for download, and the public verify route still answers for its reference — with
        `revoked: true`. A screen that removed the row would be the only place in the
        system claiming the certificate does not exist, and it would be the one an
        employer cannot check.
      */}
      {revoked ? (
        <p className="text-xs text-fg-secondary">
          <span className="font-medium text-fg">Revoked</span> on{' '}
          {formatDate(certificate.revokedAt)}
          {certificate.revokedBy !== null ? ` by ${certificate.revokedBy.name}` : ''}
          {certificate.revokedReason ? ` — ${certificate.revokedReason}` : ''}
        </p>
      ) : (
        <p className="text-xs text-fg-tertiary">
          Issued {formatDate(certificate.issuedAt)}
          {certificate.issuedBy !== null ? ` by ${certificate.issuedBy.name}` : ''}
        </p>
      )}

      {/*
        The reference, in the app's monospace face and at the size a person can read off
        a screen and type into a verifier. It is not a secret — it is the thing they are
        given — and the certificate PDF carries the same string with a QR code beside it.
      */}
      <p className="font-mono text-2xs text-fg-tertiary break-all">{certificate.reference}</p>

      {/*
        `block` at the base viewport and full width: on a phone this is the only control
        on the card, it is the reason the panel exists, and a 44px target a thumb has to
        aim at should not be a label-sized button in a corner.
      */}
      {certificate.artifact !== null ? (
        <Button
          variant="secondary"
          block
          className="sm:w-auto sm:self-start"
          loading={pending}
          onClick={onDownload}
        >
          {revoked ? 'Download the issued certificate' : 'Download'}
        </Button>
      ) : (
        <p className="text-xs text-fg-tertiary">
          The document for this certificate is not available. The qualification is still recorded.
        </p>
      )}
    </Card>
  );
}
