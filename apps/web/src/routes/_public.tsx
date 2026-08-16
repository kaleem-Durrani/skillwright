import { createRoute, Outlet } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useMotionKit } from '@/lib/motion';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Route as rootRoute } from './__root.js';

/**
 * Layout for everything an anonymous visitor can reach.
 *
 * A pathless layout (`id`, no `path`) so the URLs stay clean: /login, not
 * /public/login. It deliberately does NOT mount the AppShell — a signed-out
 * visitor has no navigation to show, and rendering an empty tab bar under an
 * auth form is how the previous system produced a "logged in but not really"
 * appearance.
 */
export const Route = createRoute({
  getParentRoute: () => rootRoute,
  id: '_public',
  component: PublicLayout,
});

function PublicLayout() {
  const { variants } = useMotionKit();

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="safe-top gutter-safe flex h-[var(--shell-topbar-h)] shrink-0 items-center gap-2">
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-md bg-brand font-display text-sm font-bold text-fg-on-brand"
        >
          SW
        </span>
        <span className="font-display text-base font-semibold tracking-tight">Skillwright</span>
        <div className="flex-1" />
        <ThemeToggle />
      </header>

      <main
        id="main-content"
        className="gutter-safe flex flex-1 flex-col justify-center pt-2 pb-[calc(var(--shell-safe-bottom)+2rem)] md:py-10"
      >
        <motion.div
          className="narrow"
          variants={variants.riseIn}
          initial="hidden"
          animate="visible"
        >
          <Outlet />
        </motion.div>
      </main>

      <footer className="gutter-safe safe-bottom pb-3 text-center text-2xs text-fg-tertiary">
        Skillwright — vocational training, permissions first.
      </footer>
    </div>
  );
}
