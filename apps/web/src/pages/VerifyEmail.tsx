import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { ApiError } from '@/lib/problem';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { OtpInput } from '@/components/auth/OtpInput';
import { toast } from '@/components/ui/Toast';
import { Route } from '@/routes/_public/verify-email';

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Shown, and used as the submit guard, when no address is known.
 *
 * Both endpoints REQUIRE the address: `verifyEmailSchema` is `{ email, code }` and
 * `resendVerificationSchema` is `{ email }` (packages/shared/src/schema/auth.ts:113-122),
 * and `emailSchema` rejects null. Firing either without one is a guaranteed 422,
 * which the old error branch mistranslated into "That code is not right" — telling
 * the user their perfectly good code was wrong.
 */
const NO_ADDRESS_MESSAGE =
  'We do not know which address to verify. Open the link from your email, or sign in to start again.';

export function VerifyEmailPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { user, isPending: sessionPending } = useSession();

  const [code, setCode] = useState(search.code ?? '');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  // No session exists here in the normal flow — registration does not sign you in
  // and login refuses a PENDING_VERIFICATION account — so the address travels in
  // the URL (`VerifyEmailSearch.email`, routes/_public/verify-email.tsx:4-15).
  // Register.tsx puts it there; a signed-in visitor's own address wins over it.
  const email = user?.email ?? search.email ?? null;

  // Nothing in the URL and the session still resolving: the address may yet
  // arrive, so hold the guard rather than accuse the user of a bad link.
  const addressPending = sessionPending && !search.email;

  const verify = useMutation({
    // `{ email, code }` — the endpoint pairs them deliberately, so a stolen code
    // alone is not enough. The address is a mutation VARIABLE rather than a read
    // of the closure, which is what makes it impossible to fire without one.
    mutationFn: (variables: { email: string; code: string }) =>
      api.post<{ ok: true }>('/auth/verify-email', variables),
    onSuccess: async () => {
      // Verification returns an ack, NOT a session: an unauthenticated visitor who
      // verifies from an email link still has to sign in. Refetch rather than
      // assume, so an already-signed-in user picks up their new ACTIVE status.
      await client.invalidateQueries({ queryKey: qk.session });
      toast.success('Email verified');
      void navigate({ to: user ? '/dashboard' : '/login' });
    },
    onError: (cause) => {
      setError(
        cause instanceof ApiError && cause.status < 500
          ? 'That code is not right, or it has expired.'
          : 'Something went wrong. Try again.',
      );
    },
  });

  const resend = useMutation({
    // Same rule as above: the address is passed in, never read from the closure.
    mutationFn: (address: string) =>
      api.post<{ ok: true }>('/auth/resend-verification', { email: address }),
    onSuccess: () => {
      setCooldown(RESEND_COOLDOWN_SECONDS);
      toast.success('Code sent', { description: 'Check your inbox again.' });
    },
    onError: (cause) => toast.fromError(cause, 'Could not send a new code'),
  });

  const submit = useCallback(
    (value: string) => {
      if (!email) {
        setError(NO_ADDRESS_MESSAGE);
        return;
      }
      setError(null);
      verify.mutate({ email, code: value });
    },
    [email, verify],
  );

  const requestNewCode = useCallback(() => {
    if (!email) {
      setError(NO_ADDRESS_MESSAGE);
      return;
    }
    resend.mutate(email);
  }, [email, resend]);

  // A code arriving in the URL should just work — the user clicked the link in
  // the email, and asking them to press a button as well is theatre. The ref
  // keeps it to one attempt while letting the effect wait for the address: a
  // signed-in visitor's email arrives a tick later, when the session resolves.
  const linkCode = search.code;
  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (autoSubmitted.current || !email) return;
    if (!linkCode || linkCode.length !== 6) return;
    autoSubmitted.current = true;
    submit(linkCode);
  }, [email, linkCode, submit]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-start gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-brand-soft text-brand-on-soft">
          <MailCheck aria-hidden="true" className="size-6" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-2xl font-semibold md:text-3xl">Verify your email</h1>
          <p className="text-sm text-fg-secondary">
            We sent a 6-digit code to{' '}
            <span className="font-medium text-fg">{email ?? 'your inbox'}</span>. It expires in 15
            minutes.
          </p>
        </div>
      </div>

      <Card variant="raised" className="flex flex-col gap-4">
        {!email && !addressPending ? (
          <p
            role="alert"
            className="rounded-md border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-fg"
          >
            {NO_ADDRESS_MESSAGE}
          </p>
        ) : null}

        <OtpInput
          label="Email verification code"
          value={code}
          onChange={setCode}
          onComplete={submit}
          autoFocus
          // Without an address there is nothing a typed code can be checked
          // against, so the boxes are inert rather than a trap.
          disabled={verify.isPending || !email}
          invalid={Boolean(error)}
          describedBy={error ? 'verify-error' : undefined}
        />

        {error ? (
          <p id="verify-error" role="alert" className="text-sm font-medium text-danger-fg">
            {error}
          </p>
        ) : null}

        <Button
          block
          loading={verify.isPending}
          disabled={!email || code.length !== 6}
          onClick={() => submit(code)}
        >
          Verify email
        </Button>

        <Button
          variant="ghost"
          block
          loading={resend.isPending}
          disabled={!email || cooldown > 0}
          onClick={requestNewCode}
        >
          {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
        </Button>
      </Card>

      <p className="text-center text-sm text-fg-secondary">
        Wrong address?{' '}
        <Link to="/login" className="font-medium text-fg-link underline-offset-4 hover:underline">
          Sign in with a different account
        </Link>
      </p>
    </div>
  );
}
