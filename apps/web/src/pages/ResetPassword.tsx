import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/problem';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { OtpInput } from '@/components/auth/OtpInput';
import { toast } from '@/components/ui/Toast';
import { Route } from '@/routes/_public/reset-password';

const schema = z
  .object({
    password: z.string().min(12, 'Use at least 12 characters'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Those passwords do not match',
  });

type Values = z.infer<typeof schema>;

export function ResetPasswordPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [code, setCode] = useState(search.code ?? '');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const reset = useMutation({
    mutationFn: (values: Values) =>
      api.post<void>('/auth/reset-password', {
        email: search.email,
        code,
        password: values.password,
      }),
    onSuccess: () => {
      toast.success('Password changed', {
        description: 'Every other session has been signed out.',
      });
      void navigate({ to: '/login' });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) {
        setCodeError('That code is not right, or it has expired.');
        return;
      }
      toast.fromError(error, 'Could not reset the password');
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-semibold md:text-3xl">Choose a new password</h1>
        <p className="text-sm text-fg-secondary">
          {search.email
            ? `Enter the code sent to ${search.email}, then pick a new password.`
            : 'Enter the code from your email, then pick a new password.'}
        </p>
      </div>

      <Card variant="raised">
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={form.handleSubmit((values) => {
            if (code.length !== 6) {
              setCodeError('Enter the 6-digit code from your email');
              return;
            }
            setCodeError(null);
            reset.mutate(values);
          })}
        >
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Reset code</span>
            <OtpInput
              label="Password reset code"
              value={code}
              onChange={setCode}
              invalid={Boolean(codeError)}
              autoFocus={!search.code}
              describedBy={codeError ? 'reset-code-error' : undefined}
            />
            {codeError ? (
              <p id="reset-code-error" role="alert" className="text-xs font-medium text-danger-fg">
                {codeError}
              </p>
            ) : null}
          </div>

          <FormField
            label="New password"
            required
            hint="At least 12 characters."
            error={form.formState.errors.password?.message}
          >
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
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

          <FormField
            label="Confirm new password"
            required
            error={form.formState.errors.confirmPassword?.message}
          >
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              {...form.register('confirmPassword')}
            />
          </FormField>

          <Button type="submit" block loading={reset.isPending}>
            Change password
          </Button>
        </form>
      </Card>

      <p className="text-center text-sm text-fg-secondary">
        <Link to="/login" className="font-medium text-fg-link underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
