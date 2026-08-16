import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OtpInput } from './OtpInput.js';

function Harness({ onComplete }: { onComplete?: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <OtpInput
      label="Authentication code"
      value={value}
      onChange={setValue}
      {...(onComplete ? { onComplete } : {})}
    />
  );
}

describe('OtpInput', () => {
  it('gives every box its own positional accessible name', () => {
    render(<Harness />);
    expect(screen.getByRole('group', { name: 'Authentication code' })).toBeInTheDocument();
    expect(screen.getByLabelText('Digit 1 of 6')).toBeInTheDocument();
    expect(screen.getByLabelText('Digit 6 of 6')).toBeInTheDocument();
  });

  it('advances to the next box as digits are typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Digit 1 of 6'));
    await user.keyboard('482');

    expect(screen.getByLabelText('Digit 1 of 6')).toHaveValue('4');
    expect(screen.getByLabelText('Digit 2 of 6')).toHaveValue('8');
    expect(screen.getByLabelText('Digit 3 of 6')).toHaveValue('2');
    expect(screen.getByLabelText('Digit 4 of 6')).toHaveFocus();
  });

  // The regression this component exists to prevent: a pasted code that only
  // ever lands in the first box.
  it('fills every box from a single paste and fires onComplete', async () => {
    const user = userEvent.setup();
    const completed: string[] = [];
    render(<Harness onComplete={(value) => completed.push(value)} />);

    const first = screen.getByLabelText('Digit 1 of 6');
    await user.click(first);
    await user.paste('123 456');

    expect(first).toHaveValue('1');
    expect(screen.getByLabelText('Digit 6 of 6')).toHaveValue('6');
    expect(completed).toEqual(['123456']);
  });

  it('steps backwards through empty boxes on Backspace', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Digit 1 of 6'));
    await user.keyboard('12');
    await user.keyboard('{Backspace}');

    expect(screen.getByLabelText('Digit 2 of 6')).toHaveValue('');
    expect(screen.getByLabelText('Digit 1 of 6')).toHaveValue('1');
  });
});
