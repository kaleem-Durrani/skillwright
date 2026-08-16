import {
  GraduationCap,
  LayoutDashboard,
  MessagesSquare,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { Action, Role } from '@skillwright/shared/policy';

/**
 * The paths the shell can link to. A closed union rather than `string` so a
 * typo becomes a compile error instead of a 404 nobody notices until a user
 * finds it.
 */
export type NavPath = '/dashboard' | '/courses' | '/messages' | '/settings' | '/admin';

export interface NavItem {
  to: NavPath;
  label: string;
  /** Shorter label for the 375px tab bar, where "Conversations" does not fit. */
  shortLabel?: string;
  icon: LucideIcon;
  /** Additionally gated by the policy layer, not just by role. */
  action?: Action;
  /** Appears in the bottom tab bar. At most five entries may set this. */
  primary?: boolean;
}

/**
 * Navigation is DATA, not a component tree, and it is keyed by the role from the
 * session — never by the URL.
 *
 * WHY that matters: the previous system decided what to render from the path
 * prefix (/admin/*, /teacher/*), which meant the role lived in the address bar
 * where any user could type it. Here the chrome is identical for all three roles
 * and only this list differs; there is no /admin-shaped layout to impersonate.
 */
const COMMON: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, primary: true },
  {
    to: '/courses',
    label: 'Courses',
    icon: GraduationCap,
    action: 'course:read',
    primary: true,
  },
  {
    to: '/messages',
    label: 'Messages',
    icon: MessagesSquare,
    action: 'conversation:read',
    primary: true,
  },
];

const SETTINGS: NavItem = {
  to: '/settings',
  label: 'Settings',
  icon: Settings,
  primary: true,
};

const ADMIN: NavItem = {
  to: '/admin',
  label: 'Administration',
  shortLabel: 'Admin',
  icon: ShieldCheck,
  action: 'user:list',
  primary: true,
};

export const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  STUDENT: [...COMMON, SETTINGS],
  TEACHER: [...COMMON, SETTINGS],
  ADMIN: [...COMMON, ADMIN, SETTINGS],
};

/** The chip in the top bar. The role is stated, never inferred by the user. */
export const WORKSPACE_LABEL: Record<Role, string> = {
  STUDENT: 'Student workspace',
  TEACHER: 'Teaching workspace',
  ADMIN: 'Admin workspace',
};

export const ROLE_LABEL: Record<Role, string> = {
  STUDENT: 'Student',
  TEACHER: 'Teacher',
  ADMIN: 'Administrator',
};

/** The bottom tab bar holds five targets at 375px. A sixth makes all six unhittable. */
export function primaryNav(items: NavItem[]): NavItem[] {
  return items.filter((item) => item.primary).slice(0, 5);
}
