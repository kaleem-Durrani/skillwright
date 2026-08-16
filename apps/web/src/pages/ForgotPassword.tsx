import { Link, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';

const schema = z.object({
  email: z.string().min(1, 'Enter your email address').email('That is not a valid email address'),
});

type Values = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const request = useMutation({
    mutationFn: (values: Values) => api.post<void>('/auth/forgot-password', values),
    /**
     * Success and "no such account" are the SAME outcome here, deliberately.
     * A distinguishable response turns this endpoint into an account-existence
     * oracle, which is how a mailing list of real students gets built.
     */
    onSettled: (_data, _error, values) => {
      toast.success('Check your inbox', {
        description: 'If that address has an account, a reset code is on its way.',
      });
      void navigate({ to: '/reset-password', search: { email: values.email } });
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-start gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-brand-soft text-brand-on-soft">
          <KeyRound aria-hidden="true" className="size-6" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-2xl font-semibold md:text-3xl">Reset your password</h1>
          <p className="text-sm text-fg-secondary">
            Enter the address you registered with and we will send a 6-digit code.
          </p>
        </div>
      </div>

      <Card variant="raised">
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => request.mutate(values))}
        >
          <FormField label="Email" required error={form.formState.errors.email?.message}>
            <Input
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              {...form.register('email')}
            />
          </FormField>

          <Button type="submit" block loading={request.isPending}>
            Send reset code
          </Button>
        </form>
      </Card>

      <p className="text-center text-sm text-fg-secondary">
        Remembered it?{' '}
        <Link to="/login" className="font-medium text-fg-link underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
