/**
 * The search module binds its wire shapes from this file, the same way the dashboard
 * module does — because there is nothing in @skillwright/shared to re-export.
 *
 * THE GAP, stated so the next reader does not go looking for the import that "must"
 * exist: `packages/shared/src/schema/` has no search module, and per the fence this
 * phase does not touch `packages/**`. So the shapes are DECLARED here rather than
 * re-exported, on the same terms dashboard.schema.ts accepted: it is the exception,
 * not the rule, and the moment shared grows a search schema this declaration is
 * deleted in favour of it. The frontend consumes these shapes through its own hand-
 * written types until then.
 *
 * Deliberately ABSENT from every hit: timestamps, counts and author summaries. A
 * cross-entity hit answers "is this the row I meant?" — identity, a highlight and a
 * link. Anything more invites the frontend to render stale denormalisations instead of
 * fetching the row's real DTO through its own endpoint before rendering detail.
 */
import { z } from 'zod';
import { announcementTypeSchema, idSchema, resourceTypeSchema } from '@skillwright/shared';

/**
 * Same bounds as the three list handlers' `q` (`listCoursesQuerySchema` et al), so no
 * term that the catalogue rejects can reach the raw SQL here either.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  /**
   * Per-group cap. A mixed-audience page shows the best few of each kind and links to
   * the full filtered list; nobody pages a combined search.
   */
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

const hitShape = {
  id: idSchema,
  /** `ts_headline` output with `<b>…</b>` around matched terms (search.sql.ts). */
  headline: z.string(),
  /** App-shell route, shaped exactly like the notification payloads' `linkPath`. */
  linkPath: z.string(),
};

export const courseHitSchema = z.object({
  ...hitShape,
  code: z.string(),
  name: z.string(),
});
export type CourseHit = z.infer<typeof courseHitSchema>;

export const resourceHitSchema = z.object({
  ...hitShape,
  title: z.string(),
  type: resourceTypeSchema,
  /** The owning course's name, for context — resources have no global list page to otherwise show it. */
  courseName: z.string(),
});
export type ResourceHit = z.infer<typeof resourceHitSchema>;

export const announcementHitSchema = z.object({
  ...hitShape,
  title: z.string(),
  type: announcementTypeSchema,
});
export type AnnouncementHit = z.infer<typeof announcementHitSchema>;

export interface SearchGroup<T> {
  hits: T[];
  total: number;
}

export const searchResponseSchema = z.object({
  courses: z.object({ hits: z.array(courseHitSchema), total: z.number().int() }),
  resources: z.object({ hits: z.array(resourceHitSchema), total: z.number().int() }),
  announcements: z.object({ hits: z.array(announcementHitSchema), total: z.number().int() }),
});
export type SearchResult = z.infer<typeof searchResponseSchema>;
