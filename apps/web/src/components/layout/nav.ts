import {
  GraduationCap,
  LayoutDashboard,
  MessagesSquare,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { Role, SubjectIndependentAction } from '@skillwright/shared/policy';

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
  /**
   * Additionally gated by the policy layer, not just by role.
   *
   * Deliberately `SubjectIndependentAction`, not `Action`. A nav destination has no
   * subject, and a rule that reads an absent Subject field must deny — so gating on a
   * subject-dependent action does not hide the link conditionally, it deletes it for
   * everyone. `SUBJECT_INDEPENDENT_ACTIONS` is proved against the rules themselves in
   * policy-matrix.test.ts, so this type cannot drift away from what is actually safe.
   */
  action?: SubjectIndependentAction;
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
  /**
   * A nav destination is not a subject, so it can only be gated on an action whose
   * rule is subject-INDEPENDENT for every role. `course:read` and `conversation:read`
   * are not: they resolve to `or(isPublished, enrolledApproved)` and `isParticipant`,
   * which read `subject.publishedAt` / `subject.participantIds`. Asked with no subject
   * they deny — so gating on them deleted the Courses link for every student and
   * teacher, and the Messages link for literally everyone including admins.
   *
   * Courses carries no action at all: the catalogue is reachable while logged out.
   * Messages asks `conversation:create`, a bare allow for all three roles, which is
   * the question a nav entry actually means — may this role use messaging at all.
   */
  {
    to: '/courses',
    label: 'Courses',
    icon: GraduationCap,
    primary: true,
  },
  {
    to: '/messages',
    label: 'Messages',
    icon: MessagesSquare,
    action: 'conversation:create',
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
