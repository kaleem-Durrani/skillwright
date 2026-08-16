import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query';
import { ApiError } from '@/lib/problem';
import { Button, IconButton } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { toast } from '@/components/ui/Toast';

const schema = z
  .object({
    name: z.string().min(2, 'Enter your full name').max(120),
    email: z.string().min(1, 'Enter your email address').email('That is not a valid email address'),
    departmentId: z.string().min(1, 'Choose a department'),
    // 12 rather than 8: this is the only credential standing between a stranger
    // and a student record, and length is the only thing that reliably helps.
    password: z.string().min(12, 'Use at least 12 characters'),
    confirmPassword: z.string(),
    accepted: z.boolean().refine((value) => value, 'You need to accept the terms to continue'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Those passwords do not match',
  });

type RegisterValues = z.infer<typeof schema>;

interface Department {
  id: string;
  name: string;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);

  const departments = useQuery({
    queryKey: qk.departments,
    queryFn: () => api.get<{ data: Department[] }>('/departments'),
    staleTime: 10 * 60_000,
  });

  const form = useForm<RegisterValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      departmentId: '',
      password: '',
      confirmPassword: '',
      accepted: false,
    },
  });

  const register = useMutation({
    mutationFn: (values: RegisterValues) =>
      api.post<void>('/auth/register', {
        name: values.name,
        email: values.email,
        password: values.password,
        departmentId: values.departmentId,
      }),
    onSuccess: () => {
      toast.success('Account created', {
        description: 'Check your inbox for a 6-digit verification code.',
      });
      void navigate({ to: '/verify-email' });
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        for (const [path, message] of Object.entries(error.byField)) {
          form.setError(path as keyof RegisterValues, { message });
        }
        if (error.is('CONFLICT')) {
          form.setError('email', { message: 'An account already uses that address' });
          return;
        }
      }
      toast.fromError(error, 'Registration failed');
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-semibold md:text-3xl">Create an account</h1>
        <p className="text-sm text-fg-secondary">
          Students register here. Teaching and admin accounts are provisioned by an administrator.
        </p>
      </div>

      <Card variant="raised">
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={form.handleSubmit((values) => register.mutate(values))}
        >
          <FormField label="Full name" required error={form.formState.errors.name?.message}>
            <Input autoComplete="name" placeholder="Ada Lovelace" {...form.register('name')} />
          </FormField>

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

          <FormField
            label="Department"
            required
            error={form.formState.errors.departmentId?.message}
            hint="You can be moved later by an administrator."
          >
            {departments.isPending ? (
              <Skeleton shape="control" />
            ) : (
              <Select
                // Radix treats "" as a selected value and would hide the
                // placeholder; undefined is what "nothing chosen" means here.
                value={form.watch('departmentId') || undefined}
                onValueChange={(value) =>
                  form.setValue('departmentId', value, { shouldValidate: true })
                }
              >
                <SelectTrigger placeholder="Choose a department" />
                <SelectContent>
                  {(departments.data?.data ?? []).map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField
            label="Password"
            required
            hint="At least 12 characters. A short phrase beats a scrambled word."
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
            label="Confirm password"
            required
            error={form.formState.errors.confirmPassword?.message}
          >
            <Input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              {...form.register('confirmPassword')}
            />
          </FormField>

          <Checkbox
            checked={form.watch('accepted')}
            onCheckedChange={(checked) =>
              form.setValue('accepted', checked === true, { shouldValidate: true })
            }
            label="I accept the terms of use and the privacy notice"
          />
          {form.formState.errors.accepted ? (
            <p role="alert" className="text-xs font-medium text-danger-fg">
              {form.formState.errors.accepted.message}
            </p>
          ) : null}

          <Button type="submit" block loading={register.isPending}>
            Create account
          </Button>
        </form>
      </Card>

      <p className="text-center text-sm text-fg-secondary">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-fg-link underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
