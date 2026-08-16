import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormField } from './FormField.js';
import { Input } from './Input.js';

describe('FormField', () => {
  it('associates the label with the control it wraps', () => {
    render(
      <FormField label="Email">
        <Input type="email" />
      </FormField>,
    );
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('describes the control with the hint, and marks it invalid only when there is an error', () => {
    const { rerender } = render(
      <FormField label="Email" hint="We use this to sign you in.">
        <Input type="email" />
      </FormField>,
    );

    const control = screen.getByLabelText('Email');
    expect(control).toHaveAccessibleDescription('We use this to sign you in.');
    expect(control).not.toHaveAttribute('aria-invalid');

    rerender(
      <FormField label="Email" hint="We use this to sign you in." error="Enter an email">
        <Input type="email" />
      </FormField>,
    );

    const invalid = screen.getByLabelText('Email');
    expect(invalid).toHaveAttribute('aria-invalid', 'true');
    // Both the hint AND the error, in that order — the error must not replace
    // the guidance that stops the user making the same mistake again.
    expect(invalid).toHaveAccessibleDescription('We use this to sign you in. Enter an email');
  });

  it('announces "required" rather than relying on the asterisk', () => {
    render(
      <FormField label="Email" required>
        <Input type="email" />
      </FormField>,
    );
    expect(screen.getByLabelText(/required/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/required/i)).toBeRequired();
  });
});
