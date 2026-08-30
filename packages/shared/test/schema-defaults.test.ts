import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createAnnouncementSchema,
  createResourceSchema,
  listAnnouncementsQuerySchema,
  listConversationsQuerySchema,
  listCoursesQuerySchema,
  listNotificationsQuerySchema,
  listResourcesQuerySchema,
  markNotificationsReadSchema,
} from '../src/schema/index.js';

/**
 * Defaults and boolean coercions — the changes that are invisible in a diff.
 *
 * A default is the value that applies when the client says nothing, which makes it the
 * one part of a schema no request ever exercises and no reviewer ever sees exercised.
 * Flipping `isPublic` from false to true publishes every future course resource to
 * anonymous callers; flipping `publish` publishes every announcement the moment it is
 * created, with no draft step. Both are one word in a diff and neither breaks a type.
 *
 * The `'true' | 'false'` query flags have the same property from the other direction:
 * six list endpoints repeat the same `z.enum(['true','false']).transform(...)` pattern,
 * and the obvious "simplification" to `z.coerce.boolean()` makes the string `'false'`
 * evaluate to TRUE — at which point `?published=false` shows unpublished courses to
 * anonymous visitors and every one of these endpoints is wrong at once.
 */

describe('safety-relevant defaults', () => {
  it('creates a resource private', () => {
    const parsed = createResourceSchema.parse({
      courseId: 'cmsvme3r703ucw4g0i6oyh6fh',
      title: 'Arc length and travel speed',
      type: 'DOCUMENT',
      uploadId: '01JGXDFAM0K2Z1GYCSNM5F5RCX',
    });
    // `isPublic` decides whether `resource:read` needs an approved enrollment. The
    // default is the value every client that omits the field gets.
    expect(parsed.isPublic).toBe(false);
  });

  it('creates an announcement as a draft', () => {
    const parsed = createAnnouncementSchema.parse({
      title: 'Open day',
      content: 'Doors at nine.',
      type: 'NEWS',
    });
    // "Create-then-publish is two steps by default, so drafts are the safe path."
    expect(parsed.publish).toBe(false);
  });

  it('defaults the notification bulk verb to marking read, not unread', () => {
    // The button in the SPA sends no `read` at all, so the default IS the behaviour of
    // "Mark all as read". Flipping it turns that button into "mark everything unread".
    expect(markNotificationsReadSchema.parse({}).read).toBe(true);
  });
});

describe('markNotificationsReadSchema.ids', () => {
  it('treats an omitted list as "all" and refuses an empty one', () => {
    // Omitting `ids` means every notification, so an empty array must NOT be accepted
    // and silently take the same branch — a client that computed an empty selection
    // would wipe the unread badge instead of doing nothing.
    expect('ids' in markNotificationsReadSchema.parse({})).toBe(false);
    expect(markNotificationsReadSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(
      markNotificationsReadSchema.safeParse({ ids: ['01JGXDFAM0K2Z1GYCSNM5F5RCX'] }).success,
    ).toBe(true);
  });

  it('caps the batch', () => {
    const ids = Array.from({ length: 201 }, () => '01JGXDFAM0K2Z1GYCSNM5F5RCX');
    expect(markNotificationsReadSchema.safeParse({ ids }).success).toBe(false);
    expect(markNotificationsReadSchema.safeParse({ ids: ids.slice(0, 200) }).success).toBe(true);
  });
});

describe('the boolean query flags', () => {
  /** Every `'true' | 'false'` flag in the package, with the query it belongs to. */
  const FLAGS: ReadonlyArray<readonly [string, z.ZodTypeAny, string]> = [
    ['listCoursesQuery.published', listCoursesQuerySchema, 'published'],
    ['listCoursesQuery.hasSeats', listCoursesQuerySchema, 'hasSeats'],
    ['listResourcesQuery.isPublic', listResourcesQuerySchema, 'isPublic'],
    ['listAnnouncementsQuery.published', listAnnouncementsQuerySchema, 'published'],
    ['listAnnouncementsQuery.upcoming', listAnnouncementsQuerySchema, 'upcoming'],
    ['listNotificationsQuery.unreadOnly', listNotificationsQuerySchema, 'unreadOnly'],
    ['listConversationsQuery.unreadOnly', listConversationsQuerySchema, 'unreadOnly'],
  ];

  it.each(FLAGS.map((flag) => [flag[0], flag] as const))(
    '%s maps the two strings to the two booleans',
    (_name, [name, schema, key]) => {
      const parse = (value: string): unknown =>
        (schema.parse({ [key]: value }) as Record<string, unknown>)[key];
      expect(parse('true'), `${name} = 'true'`).toBe(true);
      // The assertion `z.coerce.boolean()` and `Boolean(v)` both fail: a non-empty
      // string is truthy, so `?published=false` would filter to published rows.
      expect(parse('false'), `${name} = 'false'`).toBe(false);
    },
  );

  it.each(FLAGS.map((flag) => [flag[0], flag] as const))(
    '%s is absent rather than undefined when the caller omits it',
    (_name, [name, schema, key]) => {
      // Services branch on `query.x !== undefined` to decide whether to add a WHERE
      // clause at all. A key that materialised as `undefined` would still be absent to
      // that test, but a key that materialised as `false` would silently narrow every
      // unfiltered list — so assert the key does not appear.
      expect(key in (schema.parse({}) as Record<string, unknown>), name).toBe(false);
    },
  );

  it.each(FLAGS.map((flag) => [flag[0], flag] as const))(
    '%s refuses anything that is not one of the two words',
    (_name, [name, schema, key]) => {
      // `?published=1` and `?published=yes` are the shapes a hand-written client sends.
      // Silently treating them as false is worse than a 422 that names the parameter.
      for (const bad of ['1', '0', 'yes', 'TRUE', '']) {
        expect(schema.safeParse({ [key]: bad }).success, `${name} = ${JSON.stringify(bad)}`).toBe(
          false,
        );
      }
    },
  );
});
