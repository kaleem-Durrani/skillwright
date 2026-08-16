import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'motion/react';
import { ArrowLeft, Eye, EyeOff, GraduationCap, ShieldCheck, Users } from 'lucide-react';
import type { Role } from '@skillwright/shared/policy';
import { BRAND } from '@skillwright/shared/brand';
import { ApiError } from '@/lib/problem';
import { useDemoLogin, useLogin, useMfaVerify } from '@/lib/session';
import { useMotionKit } from '@/lib/motion';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Separator } from '@/components/ui/Separator';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/Toast';
import { OtpInput } from '@/components/auth/OtpInput';
import { Route } from '@/routes/_public/login';

const credentialsSchema = z.object({
  email: z.string().min(1, 'Enter your email address').email('That is not a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

type CredentialsValues = z.infer<typeof credentialsSchema>;

const DEMO_ROLES: Array<{ role: Role; label: string; blurb: string; icon: typeof Users }> = [
  {
    role: 'STUDENT',
    label: 'Student',
    blurb: 'Browse courses, request enrolment, read resources.',
    icon: GraduationCap,
  },
  {
    role: 'TEACHER',
    label: 'Teacher',
    blurb: 'Own courses, approve enrolments, publish resources.',
    icon: Users,
  },
  {
    role: 'ADMIN',
    label: 'Admin',
    blurb: 'Everything above, plus users and departments.',
    icon: ShieldCheck,
  },
];

export function LoginPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { variants } = useMotionKit();

  const [step, setStep] = useState<'credentials' | 'mfa'>(
    search.step === 'mfa' ? 'mfa' : 'credentials',
  );

  const goToApp = useCallback(() => {
    // The redirect value was produced by our own guard from a real location, so
    // it is a valid path; the router's literal-union type cannot express that.
    const target = (search.redirect ?? '/dashboard') as '/dashboard';
    void navigate({ to: target });
  }, [navigate, search.redirect]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-semibold md:text-3xl">
          {step === 'credentials' ? 'Sign in' : 'Two-factor authentication'}
        </h1>
        <p className="text-sm text-fg-secondary">
          {step === 'credentials'
            ? `Use your ${BRAND.name} account, or take a demo account for a look around.`
            : 'Your password was accepted. One more step.'}
        </p>
      </div>

      {search.reason === 'suspended' ? (
        <EmptyState
          variant="error"
          compact
          title="This account is suspended"
          description="An administrator has suspended this account. Contact them to have it reinstated."
        />
      ) : null}

      <motion.div key={step} variants={variants.riseIn} initial="hidden" animate="visible">
        {step === 'credentials' ? (
          <CredentialsStep onMfaRequired={() => setStep('mfa')} onSuccess={goToApp} />
        ) : (
          <MfaStep onBack={() => setStep('credentials')} onSuccess={goToApp} />
        )}
      </motion.div>
    </div>
  );
}

function CredentialsStep({
  onMfaRequired,
  onSuccess,
}: {
  onMfaRequired: () => void;
  onSuccess: () => void;
}) {
  const login = useLogin();
  const demo = useDemoLogin();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<CredentialsValues>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: '', password: '' },
  });

  const submit = form.handleSubmit((values) => {
    setFormError(null);
    login.mutate(values, {
      // MFA is a SUCCESS branch of the union, not an error: the password was
      // correct and a cookie has already been issued — it is just stamped
      // MFA_PENDING, which policy denies everything except mfa:verify.
      onSuccess: (data) => {
        if (data.status === 'MFA_REQUIRED') {
          onMfaRequired();
          return;
        }
        onSuccess();
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          for (const [path, message] of Object.entries(error.byField)) {
            form.setError(path as keyof CredentialsValues, { message });
          }
          setFormError(
            error.status === 401
              ? 'That email and password do not match an account.'
              : error.userMessage,
          );
          return;
        }
        setFormError('Something went wrong. Try again.');
      },
    });
  });

  const pending = login.isPending || demo.isPending;

  return (
    <div className="flex flex-col gap-5">
      <Card variant="raised" className="flex flex-col gap-4">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {formError ? (
            <p
              role="alert"
              className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-fg"
            >
              {formError}
            </p>
          ) : null}

          <FormField label="Email" required error={form.formState.errors.email?.message}>
            <Input
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              {...form.register('email')}
            />
          </FormField>

          <FormField
            label="Password"
            required
            error={form.formState.errors.password?.message}
            action={
              <Link
                to="/forgot-password"
                className="text-xs font-medium text-fg-link underline-offset-4 hover:underline"
              >
                Forgot password?
              </Link>
            }
          >
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Your password"
              trailing={
                <IconButton
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  icon={showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  size="sm"
                  onClick={() => setShowPassword((current) => !current)}
                />
              }
              {...form.register('password')}
            />
          </FormField>

          <Button type="submit" block loading={login.isPending} disabled={pending}>
            Sign in
          </Button>
        </form>

        <p className="text-center text-sm text-fg-secondary">
          No account?{' '}
          <Link
            to="/register"
            className="font-medium text-fg-link underline-offset-4 hover:underline"
          >
            Register
          </Link>
        </p>
      </Card>

      <Separator label="or try a demo" />

      {/* One column at 375px. Two demo buttons side by side would be 150px wide
          each, which is not enough for the role name plus its icon. */}
      <div className="flex flex-col gap-2">
        {DEMO_ROLES.map((entry) => (
          <Button
            key={entry.role}
            variant="secondary"
            block
            size="lg"
            disabled={pending}
            loading={demo.isPending && demo.variables === entry.role}
            className="justify-start gap-3 text-start"
            onClick={() =>
              demo.mutate(entry.role, {
                onSuccess,
                onError: (error) => toast.fromError(error, 'The demo account is unavailable'),
              })
            }
          >
            <entry.icon aria-hidden="true" className="size-5 shrink-0 text-fg-brand" />
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold">Continue as {entry.label}</span>
              <span className="truncate text-xs font-normal text-fg-tertiary">{entry.blurb}</span>
            </span>
          </Button>
        ))}
      </div>

      <p className="text-center text-xs text-fg-tertiary">
        Demo accounts can read everything and change most things. Deleting and suspending are
        refused.
      </p>
    </div>
  );
}

function MfaStep({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const verify = useMfaVerify();
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [mode]);

  const handleError = useCallback((cause: unknown) => {
    if (cause instanceof ApiError) {
      setError(
        cause.status === 401 || cause.status === 400
          ? 'That code is not right. Codes expire after 30 seconds.'
          : cause.userMessage,
      );
      return;
    }
    setError('Something went wrong. Try again.');
  }, []);

  const submitTotp = useCallback(
    (value: string) => {
      setError(null);
      verify.mutate({ code: value }, { onSuccess, onError: handleError });
    },
    [verify, onSuccess, handleError],
  );

  return (
    <Card variant="raised" className="flex flex-col gap-5">
      {mode === 'totp' ? (
        <>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-fg-secondary">
              Enter the 6-digit code from your authenticator app.
            </p>
          </div>

          <OtpInput
            label="Authentication code"
            value={code}
            onChange={setCode}
            onComplete={submitTotp}
            autoFocus
            disabled={verify.isPending}
            invalid={Boolean(error)}
            describedBy={error ? 'mfa-error' : undefined}
          />

          {error ? (
            <p id="mfa-error" role="alert" className="text-sm font-medium text-danger-fg">
              {error}
            </p>
          ) : null}

          <Button
            block
            loading={verify.isPending}
            disabled={code.length !== 6}
            onClick={() => submitTotp(code)}
          >
            Verify
          </Button>

          {/* The affordance that stops a lost phone from becoming a support
              ticket. It is a real button, not a footnote. */}
          <button
            type="button"
            onClick={() => setMode('recovery')}
            className="tap text-sm font-medium text-fg-link underline-offset-4 hover:underline"
          >
            Use a recovery code instead
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-fg-secondary">
            Enter one of the recovery codes you saved when you set up two-factor authentication.
            Each code works once.
          </p>

          <FormField label="Recovery code" required error={error} id="recovery-code">
            <Input
              value={recoveryCode}
              onChange={(event) => setRecoveryCode(event.target.value)}
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="xxxxx-xxxxx"
              className="font-mono tracking-wider"
            />
          </FormField>

          <Button
            block
            loading={verify.isPending}
            disabled={recoveryCode.trim().length < 8}
            onClick={() => {
              setError(null);
              verify.mutate(
                { recoveryCode: recoveryCode.trim() },
                { onSuccess, onError: handleError },
              );
            }}
          >
            Verify
          </Button>

          <button
            type="button"
            onClick={() => setMode('totp')}
            className="tap text-sm font-medium text-fg-link underline-offset-4 hover:underline"
          >
            Use my authenticator app instead
          </button>
        </>
      )}

      <Button
        variant="ghost"
        block
        onClick={onBack}
        leadingIcon={<ArrowLeft aria-hidden="true" className="size-4" />}
      >
        Back to sign in
      </Button>
    </Card>
  );
}
