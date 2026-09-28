import { useEffect, useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ShieldAlert, Undo2 } from 'lucide-react';
import {
  ACCOUNT_DELETION_COOL_OFF_DAYS,
  type AccountDeletionStatus,
} from '@skillwright/shared/schema';
import { api, apiUrl } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';

/**
 * Confirm-by-typing, and the string is the caller's OWN EMAIL ADDRESS.
 *
 * Not a checkbox, and not "type DELETE". A checkbox is one accidental tap, and this
 * is the one irreversible-feeling action in a person's account. An email address is
 * the one string about this account that cannot be read off a screen they did not
 * open deliberately, and it is the same string the SERVER checks — the dialog is a
 * rendering of `users.lifecycle.service`'s rule, not a second version of it.
 *
 * `autoComplete="off"` and `autoCapitalize="off"`: an address manager quietly
 * filling this box in would defeat the entire control, and Safari's auto-capitalise
 * would fail the server's own case-insensitive comparison for a reason that looks
 * like a bug.
 */
export interface AccountDeletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountDeletionDialog({
  open,
  onOpenChange,
}: AccountDeletionDialogProps): ReactElement {
  const { user } = useSession();
  const client = useQueryClient();
  const [typed, setTyped] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTyped('');
    setConfirming(false);
  }, [open]);

  const status = useQuery({
    queryKey: ['users', { scope: 'me-deletion' }],
    queryFn: () => api.get<AccountDeletionStatus>('/users/me/deletion'),
    enabled: open,
  });

  const pending = status.data?.deletionEffectiveFor != null ? status.data : null;

  const request = useMutation({
    mutationFn: (confirmEmail: string) =>
      api.post<AccountDeletionStatus>('/users/me/deletion', { confirmEmail }),
    onSuccess: async (result) => {
      onOpenChange(false);
      setTyped('');
      /*
       * The copy is the feature. "Your account has been deleted" would be the
       * sentence somebody remembers about this product; the truth is a schedule,
       * a deadline, and a way back — and a person who is told the truth here is a
       * person who does not need the support ticket two weeks later asking whether
       * it worked.
       */
      toast.success('Deletion scheduled', {
        description: `Your account closes on ${new Date(
          result.deletionEffectiveFor as string,
        ).toLocaleDateString()}. You can cancel any time before then.`,
      });
      await client.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => toast.fromError(error, 'Could not schedule that deletion'),
  });

  const cancel = useMutation({
    mutationFn: () => api.del<AccountDeletionStatus>('/users/me/deletion'),
    onSuccess: async () => {
      toast.success('Deletion cancelled', { description: 'Your account is untouched.' });
      await client.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => toast.fromError(error, 'Could not cancel that deletion'),
  });

  if (!user) return <></>;

  const email = user.email;
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (request.isPending || cancel.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        dismissible={!request.isPending}
        title={pending ? 'Your deletion is scheduled' : 'Delete your account'}
        description={
          pending
            ? `Your account closes on ${new Date(pending.deletionEffectiveFor as string).toLocaleDateString()}.`
            : `Nothing happens for ${ACCOUNT_DELETION_COOL_OFF_DAYS} days, and you can cancel at any point before then.`
        }
        footer={
          pending ? (
            <>
              <Button
                variant="ghost"
                block
                className="sm:w-auto"
                disabled={cancel.isPending}
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              <Button
                variant="secondary"
                block
                className="sm:w-auto"
                leadingIcon={<Undo2 aria-hidden="true" className="size-4" />}
                loading={cancel.isPending}
                onClick={() => cancel.mutate()}
              >
                Keep my account
              </Button>
            </>
          ) : confirming ? (
            <>
              <Button
                variant="ghost"
                block
                className="sm:w-auto"
                disabled={request.isPending}
                onClick={() => setConfirming(false)}
              >
                Back
              </Button>
              <Button
                variant="danger"
                block
                className="sm:w-auto"
                disabled={!matches || request.isPending}
                loading={request.isPending}
                onClick={() => request.mutate(email)}
              >
                Schedule deletion
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                block
                className="sm:w-auto"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                block
                className="sm:w-auto"
                leadingIcon={<ShieldAlert aria-hidden="true" className="size-4" />}
                onClick={() => setConfirming(true)}
              >
                Delete my account
              </Button>
            </>
          )
        }
      >
        {/*
          THE DATA EXPORT IS OFFERED HERE, BEFORE THE CONFIRMATION, and not on a
          settings page somewhere else. The two features are one decision: a person
          asking to be deleted is, nine times in ten, a person exercising a right to
          take their data with them, and the export takes one click. Making them
          find it elsewhere means the export is written after the account is gone.
        */}
        <div className="flex flex-col gap-4">
          <a
            href={apiUrl('/users/me/export')}
            className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-fg-secondary hover:bg-sunken"
            download
          >
            <Download aria-hidden="true" className="size-4 shrink-0" />
            Download everything we hold about you first
          </a>

          {pending ? (
            <p className="text-fg-secondary">
              Your sessions have been signed out and your profile is hidden from the app. Your
              enrolments, attendance and qualifications are kept: they are the school&rsquo;s record
              that you took the course, and deleting them would remove a qualification rather than a
              person.
            </p>
          ) : confirming ? (
            <>
              <p className="text-fg-secondary">
                Your account will close on the date shown above. Until then you can sign back in and
                change your mind. After that it is gone, along with everything attached to it.
              </p>
              <FormField label="Type your email address to confirm" required>
                <Input
                  type="email"
                  value={typed}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={request.isPending}
                  placeholder={email}
                  onChange={(event) => setTyped(event.target.value)}
                />
              </FormField>
            </>
          ) : (
            <p className="text-fg-secondary">
              This is not a suspension and an administrator cannot undo it. It is a request from
              you, and it is reversible for {ACCOUNT_DELETION_COOL_OFF_DAYS} days.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
