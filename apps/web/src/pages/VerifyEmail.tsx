import { useCallback, useEffect, useState } from 'react';
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

export function VerifyEmailPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { user } = useSession();

  const [code, setCode] = useState(search.code ?? '');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  // No session exists here in the normal flow, so the address comes from the URL.
  const email = user?.email ?? search.email ?? null;

  const verify = useMutation({
    // `{ email, code }` — the endpoint pairs them deliberately.
    mutationFn: (value: string) =>
      api.post<{ ok: true }>('/auth/verify-email', { email, code: value }),
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
    mutationFn: () => api.post<{ ok: true }>('/auth/resend-verification', { email }),
    onSuccess: () => {
      setCooldown(RESEND_COOLDOWN_SECONDS);
      toast.success('Code sent', { description: 'Check your inbox again.' });
    },
    onError: (cause) => toast.fromError(cause, 'Could not send a new code'),
  });

  const submit = useCallback(
    (value: string) => {
      setError(null);
      verify.mutate(value);
    },
    [verify],
  );

  // A code arriving in the URL should just work — the user clicked the link in
  // the email, and asking them to press a button as well is theatre.
  useEffect(() => {
    if (search.code && search.code.length === 6) submit(search.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for the link
  }, []);

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
        <OtpInput
          label="Email verification code"
          value={code}
          onChange={setCode}
          onComplete={submit}
          autoFocus
          disabled={verify.isPending}
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
          disabled={code.length !== 6}
          onClick={() => submit(code)}
        >
          Verify email
        </Button>

        <Button
          variant="ghost"
          block
          loading={resend.isPending}
          disabled={cooldown > 0}
          onClick={() => resend.mutate()}
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
