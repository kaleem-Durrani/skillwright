/**
 * The windowed page list, which is the only real logic in this component.
 *
 * A pagination control fails in two directions and neither one throws: it renders
 * 400 buttons for a 400-page result set, or it hides the page the user is on. The
 * window is asserted here as PROPERTIES over every page of a long result set
 * rather than as three hand-picked examples, because the interesting cases are the
 * boundaries — page 2, page 3, and the mirror of both at the far end — and those
 * are exactly the ones a hand-written example set leaves out.
 *
 * The "Showing 21–40 of 45" arithmetic is the other half: an off-by-one there is
 * visible on every list screen in the app and is invisible to a type checker.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pagination } from './Pagination.js';

/** The page numbers the control offers, in the order it offers them. */
function renderedPages(container: HTMLElement): number[] {
  return [...container.querySelectorAll('li')]
    .map((item) => item.textContent?.trim() ?? '')
    .filter((text) => /^\d+$/.test(text))
    .map(Number);
}

/**
 * How many ellipses stand in for skipped runs. Queried through the DOM rather
 * than by role: the gaps carry `aria-hidden`, deliberately — the live region
 * announces the position, so a screen reader hearing "ellipsis" twice per control
 * would be told nothing it can act on.
 */
function gapCount(container: HTMLElement): number {
  return container.querySelectorAll('li[aria-hidden="true"]').length;
}

describe('the page window', () => {
  it('renders nothing at all for a single page', () => {
    const { container } = render(
      <Pagination page={1} totalPages={1} onPageChange={vi.fn()} total={4} limit={20} />,
    );

    // Previous/Next/1 under a four-row list is furniture, not a control.
    expect(container).toBeEmptyDOMElement();
  });

  it('lists every page while there are seven or fewer', () => {
    const { container } = render(<Pagination page={3} totalPages={7} onPageChange={vi.fn()} />);

    expect(renderedPages(container)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(gapCount(container)).toBe(0);
  });

  it('keeps first, last and current visible on every page of a long set', () => {
    for (let page = 1; page <= 20; page += 1) {
      const view = render(<Pagination page={page} totalPages={20} onPageChange={vi.fn()} />);
      const pages = renderedPages(view.container);

      expect(pages, `page ${page}`).toContain(1);
      expect(pages, `page ${page}`).toContain(20);
      expect(pages, `page ${page}`).toContain(page);
      // Seven is the ceiling the file promises; a 400-page result set must not
      // produce a 400-item control.
      expect(pages.length, `page ${page}`).toBeLessThanOrEqual(7);
      // Strictly increasing: a window that emits a number twice, or out of order,
      // reads as a broken control even when every page is reachable.
      expect(
        [...pages].sort((a, b) => a - b),
        `page ${page}`,
      ).toEqual(pages);

      view.unmount();
    }
  });

  it('never replaces a single skipped page with an ellipsis', () => {
    // An ellipsis standing in for ONE page is strictly worse than the page: it is
    // wider, it is not clickable, and it hides a destination that was going to fit.
    for (let page = 1; page <= 20; page += 1) {
      const view = render(<Pagination page={page} totalPages={20} onPageChange={vi.fn()} />);
      const pages = renderedPages(view.container);
      const skipped = pages.filter((value, index) => index > 0 && value - pages[index - 1]! > 1);

      expect(gapCount(view.container), `page ${page}`).toBe(skipped.length);

      view.unmount();
    }
  });

  it('marks the current page for assistive technology', () => {
    render(<Pagination page={4} totalPages={20} onPageChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '3' })).not.toHaveAttribute('aria-current');
  });
});

describe('the position readout', () => {
  it('counts the rows on this page, not the pages', () => {
    render(<Pagination page={2} totalPages={3} total={45} limit={20} onPageChange={vi.fn()} />);

    expect(screen.getByText('Showing 21–40 of 45')).toBeInTheDocument();
  });

  it('stops the last page at the real total', () => {
    render(<Pagination page={3} totalPages={3} total={45} limit={20} onPageChange={vi.fn()} />);

    // Without the clamp this reads "Showing 41–60 of 45", which is the kind of
    // number a reviewer notices and a user does not trust.
    expect(screen.getByText('Showing 41–45 of 45')).toBeInTheDocument();
  });

  it('falls back to a bare total when the page size is unknown', () => {
    render(<Pagination page={2} totalPages={3} total={45} onPageChange={vi.fn()} />);

    expect(screen.getByText('45 results')).toBeInTheDocument();
  });

  it('announces the position once for the whole control', () => {
    render(<Pagination page={2} totalPages={3} onPageChange={vi.fn()} />);

    // One live region, not one per button: a screen reader should hear the page
    // change once rather than seven times.
    const live = screen.getByText('Page 2 of 3');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });
});

describe('the step buttons', () => {
  it('cannot step off either end', () => {
    const view = render(<Pagination page={1} totalPages={3} onPageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
    view.unmount();

    render(<Pagination page={3} totalPages={3} onPageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Previous/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });

  it('reports the page it is moving to, not a delta', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<Pagination page={2} totalPages={20} onPageChange={onPageChange} />);

    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);

    await user.click(screen.getByRole('button', { name: /Previous/ }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);

    await user.click(screen.getByRole('button', { name: '20' }));
    expect(onPageChange).toHaveBeenLastCalledWith(20);
  });

  it('takes a name, because a screen can hold two of these', () => {
    render(
      <Pagination page={1} totalPages={3} onPageChange={vi.fn()} label="Courses pagination" />,
    );

    expect(screen.getByRole('navigation', { name: 'Courses pagination' })).toBeInTheDocument();
  });
});
