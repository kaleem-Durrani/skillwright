import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { BRAND } from '@skillwright/shared/brand';
import { IconButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * Same ceiling as the API's `searchQuerySchema` (`q.max(120)`); a longer term
 * would be a 422, so the input refuses it at the keystroke.
 */
const MAX_QUERY_LENGTH = 120;

/**
 * The shell's search affordance. It COLLECTS a query; it never shows results —
 * "the page is the product", and /search owns rendering them.
 *
 * TWO FORMS, matching how AppShell itself splits (see its header comment):
 *
 *   >= md  an inline field in the top bar, centred where the sidebar layout has
 *          room for one. Submitting (Enter or the implicit submit) navigates to
 *          `/search?q=…`.
 *
 *   < md   a compact icon button beside the bell that opens /search, whose own
 *          input takes over. Deliberately NOT a primary-nav entry — `primaryNav`
 *          slices the bottom bar to five targets and adding a sixth would
 *          silently drop someone's destination (nav.ts) — and deliberately NOT
 *          buried in the account menu either: search is this phase's headline
 *          surface, and hiding it behind an identity menu would make it
 *          undiscoverable on exactly the devices with no inline field. The width
 *          cost at 375px lands on the brand name, which AppShell already
 *          designated as the element that gives way.
 *
 * No role gate and no policy gate: every signed-in role gets identical chrome,
 * and the server scopes what each caller is shown (#15/#31 — the UI hides no
 * field the API would have answered).
 */
export function ShellSearch() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [term, setTerm] = useState('');

  /*
   * The launcher holds NO source of truth: the moment the user moves to another
   * screen — including landing on /search, which carries its own URL-bound
   * input — the field empties again. Letting text linger here would create a
   * second, stale copy of the results page's q.
   */
  useEffect(() => {
    setTerm('');
  }, [pathname]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The endpoint refuses an empty or whitespace-only term; submitting one is
    // simply ignored rather than navigated into a 422.
    const q = term.trim();
    if (!q) return;
    void navigate({ to: '/search', search: { q } });
  }

  return (
    <>
      {/*
       * `flex-1` only exists from md up (the form is `hidden` below it), where it
       * takes over the spacing duty from TopBar's mobile-only spacer — which is
       * `md:hidden` for exactly that reason.
       */}
      <form
        role="search"
        onSubmit={onSubmit}
        className="hidden min-w-0 flex-1 justify-center px-2 md:flex"
      >
        <Input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={`Search ${BRAND.name}`}
          aria-label="Search"
          leading={<Search aria-hidden="true" className="size-4" />}
          maxLength={MAX_QUERY_LENGTH}
          className="w-full max-w-md"
        />
      </form>

      <IconButton
        aria-label="Search"
        icon={<Search aria-hidden="true" className="size-5" />}
        className="md:hidden"
        onClick={() => void navigate({ to: '/search' })}
      />
    </>
  );
}
