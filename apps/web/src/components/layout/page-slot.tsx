import { createContext, useContext, type ReactNode } from 'react';

/**
 * The top bar's page-title slot, and the wiring that lets a page fill it.
 *
 * The problem this solves: from `md` up, a screen's title, description and
 * primary actions belong in the shell's top bar rather than as the first block of
 * scrolling content. That is what frees a page to bound its own height, which is
 * in turn what lets a table fill the viewport instead of running off the bottom
 * of it.
 *
 * WHY A PORTAL rather than route metadata. TanStack Router's `staticData` can
 * carry a constant title, and half these screens do not have one: the course
 * detail's title is the course's name, the dashboard greets the user by first
 * name, and three pages render a breadcrumb with live links in the eyebrow. Those
 * values exist only after the page's own data has resolved. The alternatives are
 * a store the page writes to in an effect — which paints the bar once with the
 * wrong title and then corrects it — or this: the page renders its header
 * declaratively, exactly where it always did, and React puts the nodes somewhere
 * else. Events and context still travel the React tree, so an action button in
 * the bar closes over the page's own handlers with nothing threaded through.
 *
 * The slot is nullable on purpose. The five unauthenticated screens render no
 * shell at all, so `usePageSlot()` answers null there and `PageHeader` renders in
 * place — one component, no second code path, and no `AppShell` dependency
 * reaching into the auth routes.
 */
const PageSlotContext = createContext<HTMLElement | null>(null);

/** The element a page's header should portal into, or null when there is none. */
export function usePageSlot(): HTMLElement | null {
  return useContext(PageSlotContext);
}

export interface PageSlotProviderProps {
  /** The slot element, owned by `AppShell` because it renders both ends of this. */
  slot: HTMLElement | null;
  children: ReactNode;
}

export function PageSlotProvider({ slot, children }: PageSlotProviderProps) {
  return <PageSlotContext.Provider value={slot}>{children}</PageSlotContext.Provider>;
}
