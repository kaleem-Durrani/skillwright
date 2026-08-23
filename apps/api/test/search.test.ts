import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AppInstance } from '../src/app.js';
import { hashPassword } from '../src/lib/password.js';
import {
  buildApp,
  cookieHeader,
  createDepartment,
  originHeaders,
  prisma,
  resetDatabase,
  resetRateLimits,
  sessionCookie,
} from './setup.js';

/**
 * Phase 3 — search. Everything here is NEW-suite territory by design: the slice-1
 * ranked `?q=` upgrades and the slice-2 cross-entity `GET /search` are both covered
 * here, against fixtures this file creates itself (no seed assumptions), so the
 * WELD-2-style code-fragment regression is pinned against rows whose text we control.
 *
 * The scoping matrix re-tests the per-entity visibility rules THROUGH the search
 * paths — anonymous public-only, approved-student enrolled access, teacher own-drafts
 * and own-authored, admin everything-live, soft-deleted excluded everywhere — because
 * a cross-entity endpoint is exactly where one forgotten filter leaks in bulk.
 */

const PASSWORD = 'correct-horse-battery-staple';

let app: AppInstance;
let departmentId: string;
/** Hashed once: argon2 is deliberately expensive, and every account here shares it. */
let passwordHash: string;
/** Uniqueness counter for codes/slugs, reset with the database. */
let seq = 0;

beforeAll(async () => {
  app = await buildApp();
  passwordHash = await hashPassword(PASSWORD);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  await resetRateLimits(app.redis);
  departmentId = await createDepartment();
  seq = 0;
});

// --- helpers ---------------------------------------------------------------

type TestRole = 'STUDENT' | 'TEACHER' | 'ADMIN';

/** Provisioned directly: only students self-register, and this suite needs all three roles. */
async function createAccount(email: string, role: TestRole, name = 'Test Person'): Promise<string> {
  const user = await prisma.user.create({
    data: { email, name, role, status: 'ACTIVE', passwordHash },
  });
  return user.id;
}

async function login(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { ...originHeaders },
    payload: { email, password: PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  const token = sessionCookie(response);
  expect(token).toBeTruthy();
  return token as string;
}

/** Creates the account and returns its id plus the session cookie for it. */
async function actor(
  email: string,
  role: TestRole,
  name?: string,
): Promise<{ id: string; cookie: string }> {
  const id = await createAccount(email, role, name);
  return { id, cookie: await login(email) };
}

/** GET against the API root; `path` starts with the module segment, e.g. `/search?q=x`. */
function get(path: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1${path}`,
    headers: cookie ? { cookie: cookieHeader(cookie) } : {},
  });
}

function nextCode(prefix = 'WLD'): string {
  seq += 1;
  return `${prefix}-${1000 + seq}`;
}

interface CourseSpec {
  teacherId: string;
  code?: string;
  name?: string;
  description?: string | null;
  publishedAt?: Date | null;
  departmentId?: string;
}

async function courseRow(spec: CourseSpec): Promise<{ id: string; code: string }> {
  const code = spec.code ?? nextCode();
  const course = await prisma.course.create({
    data: {
      code,
      slug: code.toLowerCase(),
      name: spec.name ?? `Course ${code}`,
      description: spec.description ?? null,
      departmentId: spec.departmentId ?? departmentId,
      teacherId: spec.teacherId,
      durationValue: 6,
      durationUnit: 'WEEK',
      capacity: 12,
      publishedAt: spec.publishedAt ?? null,
    },
    select: { id: true, code: true },
  });
  return { id: course.id, code: course.code };
}

interface ResourceSpec {
  courseId: string;
  authorId: string;
  title: string;
  description?: string | null;
  isPublic?: boolean;
  type?: 'DOCUMENT' | 'VIDEO' | 'LINK';
}

async function resourceRow(spec: ResourceSpec): Promise<string> {
  const resource = await prisma.resource.create({
    data: {
      courseId: spec.courseId,
      authorId: spec.authorId,
      title: spec.title,
      description: spec.description ?? null,
      // LINK with an external URL satisfies migration 0002's exactly-one-source CHECK
      // without needing an Upload row.
      type: spec.type ?? 'LINK',
      externalUrl: 'https://example.com/material.pdf',
      isPublic: spec.isPublic ?? false,
    },
    select: { id: true },
  });
  return resource.id;
}

interface AnnouncementSpec {
  authorId: string;
  title: string;
  content?: string;
  type?: 'NEWS' | 'EVENT' | 'ANNOUNCEMENT';
  publishedAt?: Date | null;
}

async function announcementRow(spec: AnnouncementSpec): Promise<string> {
  seq += 1;
  const announcement = await prisma.announcement.create({
    data: {
      title: spec.title,
      slug: `notice-${seq}`,
      content: spec.content ?? `Body of notice ${seq}.`,
      type: spec.type ?? 'NEWS',
      authorId: spec.authorId,
      publishedAt: spec.publishedAt ?? null,
    },
    select: { id: true },
  });
  return announcement.id;
}

async function enroll(studentId: string, courseId: string, status: 'APPROVED' | 'PENDING') {
  await prisma.enrollment.create({
    data: {
      studentId,
      courseId,
      status,
      ...(status === 'APPROVED' ? { decidedAt: new Date() } : {}),
    },
  });
}

function softDeleteCourse(id: string): Promise<unknown> {
  return prisma.course.update({ where: { id }, data: { deletedAt: new Date() } });
}
function softDeleteResource(id: string): Promise<unknown> {
  return prisma.resource.update({ where: { id }, data: { deletedAt: new Date() } });
}
function softDeleteAnnouncement(id: string): Promise<unknown> {
  return prisma.announcement.update({ where: { id }, data: { deletedAt: new Date() } });
}

/** The codes of a courses-list/search response body, order preserved. */
function courseCodes(body: {
  data?: Array<{ code: string }>;
  hits?: Array<{ code: string }>;
}): string[] {
  return (body.data ?? body.hits ?? []).map((row) => row.code);
}

function idsOf(body: unknown): string[] {
  const data = (body as { data?: Array<{ id: string }> }).data;
  if (Array.isArray(data)) return data.map((row) => row.id);
  const group = body as {
    courses?: { hits: Array<{ id: string }> };
    resources?: { hits: Array<{ id: string }> };
    announcements?: { hits: Array<{ id: string }> };
  };
  return [
    ...(group.courses?.hits ?? []),
    ...(group.resources?.hits ?? []),
    ...(group.announcements?.hits ?? []),
  ].map((hit) => hit.id);
}

// ---------------------------------------------------------------------------
// Slice 1 — the upgraded ?q= handlers
// ---------------------------------------------------------------------------

describe('slice 1 — GET /courses?q=', () => {
  it('matches a word FORM that substring matching cannot see ("welding" finds "welded")', async () => {
    const teacher = await actor('teacher@example.com', 'TEACHER');
    await courseRow({
      teacherId: teacher.id,
      code: 'FAB-201',
      name: 'Aluminium Fabrication',
      description: 'welded joints and flame control',
      publishedAt: new Date(),
    });

    // Neither the name nor the code contains the letters "welding", so the old
    // contains/ILIKE fallback answered empty; only the stemmed searchVector can.
    const found = await get('/courses?q=welding');
    expect(found.statusCode).toBe(200);
    expect(courseCodes(found.json())).toEqual(['FAB-201']);

    const missed = await get('/courses?q=zirconium');
    expect(courseCodes(missed.json())).toEqual([]);
  });

  it('still matches a partial CODE fragment like "WELD-2" after the swap (trigram regression)', async () => {
    const teacher = await actor('teacher@example.com', 'TEACHER');
    await courseRow({
      teacherId: teacher.id,
      code: 'WELD-207',
      name: 'TIG Welding Advanced',
      publishedAt: new Date(),
    });
    await courseRow({
      teacherId: teacher.id,
      code: 'MOT-101',
      name: 'Motor Vehicle Maintenance',
      publishedAt: new Date(),
    });

    for (const term of ['WELD-2', 'weld-2']) {
      const response = await get(`/courses?q=${encodeURIComponent(term)}`);
      expect(response.statusCode).toBe(200);
      // websearch_to_tsquery parses "WELD-2" as 'weld' <-> '-2', which matches no
      // lexeme pair in either row — measured, not assumed. The trigram ILIKE arm on
      // the code column is what keeps this query alive; MOT-101 must stay absent.
      expect(courseCodes(response.json())).toEqual(['WELD-207']);
    }
  });

  it('ranks name matches above description-only matches regardless of recency', async () => {
    const teacher = await actor('teacher@example.com', 'TEACHER');
    // The stronger row is created FIRST (older), so a recency tiebreak would put the
    // weaker row first — only real relevance scoring produces the asserted order.
    const stronger = await courseRow({
      teacherId: teacher.id,
      code: 'WLD-201',
      name: 'Welding Fundamentals',
      publishedAt: new Date(),
    });
    const weaker = await courseRow({
      teacherId: teacher.id,
      code: 'MOT-101',
      name: 'Metal Trades Intro',
      description: 'welding basics',
      publishedAt: new Date(),
    });

    const response = await get('/courses?q=welding');
    expect(response.statusCode).toBe(200);
    // A-weighted name lexeme outranks the B-weighted description lexeme.
    expect(idsOf(response.json())).toEqual([stronger.id, weaker.id]);
  });

  it('honours websearch syntax: quoted phrases and -exclusions', async () => {
    const teacher = await actor('teacher@example.com', 'TEACHER');
    const fabrication = await courseRow({
      teacherId: teacher.id,
      code: 'FAB-101',
      name: 'Metal Fabrication Intro',
      publishedAt: new Date(),
    });
    const casting = await courseRow({
      teacherId: teacher.id,
      code: 'CAS-101',
      name: 'Metal Casting Basics',
      publishedAt: new Date(),
    });

    const phrase = await get(`/courses?q=${encodeURIComponent('"metal fabrication"')}`);
    expect(idsOf(phrase.json())).toEqual([fabrication.id]);

    const excluded = await get(`/courses?q=${encodeURIComponent('metal -fabrication')}`);
    expect(idsOf(excluded.json())).toEqual([casting.id]);
  });

  it('keeps department filtering, publication checks and soft deletes while searching', async () => {
    const admin = await actor('admin@example.com', 'ADMIN');
    const teacher = await actor('teacher@example.com', 'TEACHER');
    const plumbing = await createDepartment('plumbing');

    const liveHere = await courseRow({
      teacherId: teacher.id,
      code: 'WLD-201',
      name: 'Welding One',
      publishedAt: new Date(),
    });
    const liveThere = await courseRow({
      teacherId: teacher.id,
      code: 'WLD-202',
      name: 'Welding Two',
      publishedAt: new Date(),
      departmentId: plumbing,
    });
    const draft = await courseRow({
      teacherId: teacher.id,
      code: 'WLD-301',
      name: 'Welding Secrets',
    });

    // A caller's other filters still narrow the searched set...
    const filtered = await get(`/courses?q=welding&departmentId=${plumbing}`);
    expect(courseCodes(filtered.json())).toEqual(['WLD-202']);

    // ...anonymous never sees a draft through search (visibility AND text, never OR)...
    const anonymous = await get('/courses?q=welding');
    expect(courseCodes(anonymous.json()).sort()).toEqual(['WLD-201', 'WLD-202']);

    // ...but the owning teacher does...
    const owner = await get('/courses?q=welding', teacher.cookie);
    expect(courseCodes(owner.json()).sort()).toEqual(['WLD-201', 'WLD-202', 'WLD-301']);

    // ...and soft delete removes a row for everyone — while the draft stays
    // role-scoped: still invisible to anonymous, visible to owner and admin.
    await softDeleteCourse(liveHere.id);
    expect(courseCodes((await get('/courses?q=welding')).json())).toEqual(['WLD-202']);
    const ownerAfter = await get('/courses?q=welding', teacher.cookie);
    expect(courseCodes(ownerAfter.json()).sort()).toEqual(['WLD-202', 'WLD-301']);
    const adminAfter = await get('/courses?q=welding', admin.cookie);
    expect(courseCodes(adminAfter.json()).sort()).toEqual(['WLD-202', 'WLD-301']);
    expect(liveThere.code).toBeDefined();
    expect(draft.code).toBeDefined();
  });

  it('pages ranked results with the shared envelope', async () => {
    const teacher = await actor('teacher@example.com', 'TEACHER');
    const created = [];
    for (const suffix of ['Alpha', 'Beta', 'Gamma']) {
      created.push(
        (
          await courseRow({
            teacherId: teacher.id,
            name: `Welding ${suffix}`,
            publishedAt: new Date(),
          })
        ).id,
      );
    }

    const page1 = await get('/courses?q=welding&limit=2&page=1');
    expect(page1.statusCode).toBe(200);
    expect(page1.json().meta).toMatchObject({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
      hasNext: true,
      hasPrev: false,
    });
    expect(page1.json().data).toHaveLength(2);

    const page2 = await get('/courses?q=welding&limit=2&page=2');
    expect(page2.json().meta).toMatchObject({ page: 2, total: 3, hasNext: false, hasPrev: true });
    expect(page2.json().data).toHaveLength(1);

    // Both pages together are exactly the matching set — no duplicates, no losses.
    expect(new Set([...idsOf(page1.json()), ...idsOf(page2.json())])).toEqual(new Set(created));
  });
});

describe('slice 1 — GET /resources?q=', () => {
  it('matches stems in the description and partial words in the title', async () => {
    const teacher = await actor('teacher@example.com', 'TEACHER');
    const course = await courseRow({
      teacherId: teacher.id,
      name: 'Hot Works Safety',
      publishedAt: new Date(),
    });
    const resource = await resourceRow({
      courseId: course.id,
      authorId: teacher.id,
      title: 'Oxy-fuel Equipment Care',
      description: 'flame management during startup',
      isPublic: true,
    });

    // "flames" stems to the lexeme behind "flame"; the old contains fallback needed
    // the literal substring "flames" and found nothing.
    const stemmed = await get('/resources?q=flames');
    expect(stemmed.statusCode).toBe(200);
    expect(idsOf(stemmed.json())).toEqual([resource]);

    // "equi" is not any lexeme of "Equipment" — only the trigram arm on the title
    // (migration 0002:86) can match a mid-word fragment.
    const partial = await get('/resources?q=equi');
    expect(idsOf(partial.json())).toEqual([resource]);

    const missed = await get('/resources?q=zilch');
    expect(idsOf(missed.json())).toEqual([]);
  });

  it('keeps the visibility matrix while searching (a public flag cannot outrank a draft course)', async () => {
    const teacher = await actor('teacher@example.com', 'TEACHER');
    const approved = await actor('approved@example.com', 'STUDENT', 'Approved Student');
    const other = await actor('other@example.com', 'STUDENT', 'Other Student');

    // Unpublished course carrying a PUBLIC resource — lesson #33's exact shape.
    const draftCourse = await courseRow({ teacherId: teacher.id, name: 'Plasma Cutting Lab' });
    const hiddenResource = await resourceRow({
      courseId: draftCourse.id,
      authorId: teacher.id,
      title: 'Plasma Cutter Field Guide',
      isPublic: true,
    });

    // Anonymous and an unrelated student: absent, despite isPublic=true.
    expect(idsOf((await get('/resources?q=cutter')).json())).toEqual([]);
    expect(idsOf((await get('/resources?q=cutter', other.cookie)).json())).toEqual([]);

    // An APPROVED student keeps access to material in the unpublished course...
    await enroll(approved.id, draftCourse.id, 'APPROVED');
    expect(idsOf((await get('/resources?q=cutter', approved.cookie)).json())).toEqual([
      hiddenResource,
    ]);

    // ...and so does the owning teacher.
    expect(idsOf((await get('/resources?q=cutter', teacher.cookie)).json())).toEqual([
      hiddenResource,
    ]);
  });

  it('excludes soft-deleted resources and deleted-course resources even for admins, keeping filters', async () => {
    const admin = await actor('admin@example.com', 'ADMIN');
    const teacher = await actor('teacher@example.com', 'TEACHER');
    const course = await courseRow({
      teacherId: teacher.id,
      name: 'Guide Course',
      publishedAt: new Date(),
    });
    const doomedCourse = await courseRow({
      teacherId: teacher.id,
      name: 'Ghost Course',
      publishedAt: new Date(),
    });

    const liveVideo = await resourceRow({
      courseId: course.id,
      authorId: teacher.id,
      title: 'Visible Video Guide',
      isPublic: true,
      type: 'VIDEO',
    });
    const liveDoc = await resourceRow({
      courseId: course.id,
      authorId: teacher.id,
      title: 'Visible Doc Guide',
      isPublic: true,
      type: 'DOCUMENT',
    });
    const deleted = await resourceRow({
      courseId: course.id,
      authorId: teacher.id,
      title: 'Deleted Guide',
      isPublic: true,
    });
    const ghosted = await resourceRow({
      courseId: doomedCourse.id,
      authorId: teacher.id,
      title: 'Ghost Guide',
      isPublic: true,
    });

    await softDeleteResource(deleted);
    await softDeleteCourse(doomedCourse.id);

    const all = await get('/resources?q=guide', admin.cookie);
    expect(idsOf(all.json()).sort()).toEqual([liveDoc, liveVideo].sort());

    // The type filter still narrows the searched set.
    const videos = await get('/resources?q=guide&type=VIDEO', admin.cookie);
    expect(idsOf(videos.json())).toEqual([liveVideo]);

    const scoped = await get(`/resources?q=guide&courseId=${course.id}`, admin.cookie);
    expect(idsOf(scoped.json()).sort()).toEqual([liveDoc, liveVideo].sort());
    expect(ghosted).toBeTruthy();
  });
});

describe('slice 1 — GET /announcements?q=', () => {
  it('matches stems in the content and partial words in the title', async () => {
    const teacher = await actor('teacher@example.com', 'TEACHER');
    await announcementRow({
      authorId: teacher.id,
      title: 'Workshop Closure Notice',
      content: 'All sessions are cancelled during the storm damage repairs.',
      publishedAt: new Date(),
    });

    // "cancelling" stems to the lexeme behind "cancelled" — the substring fallback
    // needed the literal word and found nothing.
    const stemmed = await get('/announcements?q=cancelling');
    expect(stemmed.statusCode).toBe(200);
    expect(stemmed.json().data).toHaveLength(1);

    // "Closu" is a mid-word fragment of the title: trigram arm, case-insensitively.
    const partial = await get('/announcements?q=Closu');
    expect(partial.json().data).toHaveLength(1);

    const missed = await get('/announcements?q=zilch');
    expect(missed.json().data).toHaveLength(0);
  });

  it('keeps drafts invisible to students and anonymous while searching; type filter still works', async () => {
    const admin = await actor('admin@example.com', 'ADMIN');
    const teacher = await actor('teacher@example.com', 'TEACHER');
    const student = await actor('student@example.com', 'STUDENT');

    const draft = await announcementRow({ authorId: teacher.id, title: 'Secret Reorg Plans' });
    const publishedEvent = await announcementRow({
      authorId: teacher.id,
      title: 'Trade Night Welding Demo',
      type: 'EVENT',
      publishedAt: new Date(),
    });
    const publishedNews = await announcementRow({
      authorId: teacher.id,
      title: 'Open Gym Schedule',
      content: 'The gym opens early all week.',
      publishedAt: new Date(),
    });

    for (const cookie of [undefined, student.cookie]) {
      expect(idsOf((await get('/announcements?q=reorg', cookie)).json())).toEqual([]);
    }
    expect(idsOf((await get('/announcements?q=reorg', teacher.cookie)).json())).toEqual([draft]);
    expect(idsOf((await get('/announcements?q=reorg', admin.cookie)).json())).toEqual([draft]);

    // The caller's filters survive the swap: ?type=EVENT narrows the matches.
    const events = await get('/announcements?q=welding&type=EVENT', admin.cookie);
    expect(idsOf(events.json())).toEqual([publishedEvent]);
    const newsOnly = await get('/announcements?q=welding&type=NEWS', admin.cookie);
    expect(idsOf(newsOnly.json())).toEqual([]);

    // Soft-deleted rows vanish for the admin too.
    await softDeleteAnnouncement(publishedNews);
    expect(idsOf((await get('/announcements?q=gym', admin.cookie)).json())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Slice 2 — the cross-entity GET /search
// ---------------------------------------------------------------------------

describe('slice 2 — GET /search', () => {
  it('serves anonymous callers the public-only view of all three groups', async () => {
    const teacher = await actor('teacher@example.com', 'TEACHER');

    const publishedCourse = await courseRow({
      teacherId: teacher.id,
      name: 'Public Speaking 101',
      publishedAt: new Date(),
    });
    await courseRow({ teacherId: teacher.id, name: 'Hidden Draft Course' });

    const openSlides = await resourceRow({
      courseId: publishedCourse.id,
      authorId: teacher.id,
      title: 'Open Slides Deck',
      isPublic: true,
    });
    await resourceRow({
      courseId: publishedCourse.id,
      authorId: teacher.id,
      title: 'Members Only Notes',
      isPublic: false,
    });
    // Lesson #33's trap inside a search endpoint: a PUBLIC resource sitting in a DRAFT
    // course must be as invisible as the course itself.
    await resourceRow({
      courseId: (await courseRow({ teacherId: teacher.id, name: 'Second Draft' })).id,
      authorId: teacher.id,
      title: 'Draft Bay Checklist',
      isPublic: true,
    });

    await announcementRow({
      authorId: teacher.id,
      title: 'Campus Open Day',
      publishedAt: new Date(),
    });
    await announcementRow({ authorId: teacher.id, title: 'Secret Staff Cuts' });

    const shape = await get('/search?q=speaking');
    expect(shape.statusCode).toBe(200);
    expect(Object.keys(shape.json()).sort()).toEqual(['announcements', 'courses', 'resources']);

    expect(idsOf((await get('/search?q=speaking')).json())).toEqual([publishedCourse.id]);
    expect(idsOf((await get('/search?q=slides')).json())).toEqual([openSlides]);
    expect(idsOf((await get('/search?q=notes')).json())).toEqual([]);
    expect(idsOf((await get('/search?q=checklist')).json())).toEqual([]);
    // "open" legitimately matches one row in each of two groups: the public slides
    // (resources) and the published Campus Open Day notice (announcements).
    const open = await get('/search?q=open');
    expect(open.json().resources.hits.map((hit: { id: string }) => hit.id)).toEqual([openSlides]);
    expect(open.json().announcements.hits).toHaveLength(1);
    expect(open.json().announcements.hits[0].linkPath).toMatch(/^\/announcements\//);
    expect(idsOf((await get('/search?q=cuts')).json())).toEqual([]);
  });

  it('shows an approved student their unpublished-but-enrolled course and its material; pending students see neither', async () => {
    const teacher = await actor('teacher@example.com', 'TEACHER');
    const approved = await actor('approved@example.com', 'STUDENT', 'Approved Student');
    const pending = await actor('pending@example.com', 'STUDENT', 'Pending Student');

    const lab = await courseRow({ teacherId: teacher.id, name: 'Night Shift Welding Lab' });
    const safetySheet = await resourceRow({
      courseId: lab.id,
      authorId: teacher.id,
      title: 'Lab Safety Sheet',
      isPublic: true,
    });
    await enroll(approved.id, lab.id, 'APPROVED');
    await enroll(pending.id, lab.id, 'PENDING');

    const approvedView = await get('/search?q=shift', approved.cookie);
    expect(approvedView.json().courses.hits.map((hit: { id: string }) => hit.id)).toEqual([lab.id]);

    // The enrolledApproved branch carries no publication term — same answer the
    // resources list gives this student.
    const material = await get('/search?q=safety', approved.cookie);
    expect(material.json().resources.hits.map((hit: { id: string }) => hit.id)).toEqual([
      safetySheet,
    ]);

    // PENDING is not seated: the same queries answer empty.
    expect(idsOf((await get('/search?q=shift', pending.cookie)).json())).toEqual([]);
    expect(idsOf((await get('/search?q=safety', pending.cookie)).json())).toEqual([]);

    // Draft announcements stay invisible to students however they search.
    await announcementRow({ authorId: teacher.id, title: 'Draft Policy Memo' });
    expect(idsOf((await get('/search?q=policy', approved.cookie)).json())).toEqual([]);
  });

  it("shows teachers their own drafts across entities but never another teacher's", async () => {
    const mine = await actor('mine@example.com', 'TEACHER', 'Teacher Mine');
    const theirs = await actor('theirs@example.com', 'TEACHER', 'Teacher Theirs');
    const stranger = await actor('stranger@example.com', 'TEACHER', 'Teacher Stranger');

    const ownDraft = await courseRow({ teacherId: mine.id, name: 'My Draft Curriculum' });
    const foreignDraft = await courseRow({ teacherId: theirs.id, name: 'Their Draft Curriculum' });

    // T2's PUBLISHED course holding a PRIVATE resource authored by T1: T1 sees it via
    // isAuthor, T2 via ownsCourse, the third teacher via nothing.
    const publishedForeign = await courseRow({
      teacherId: theirs.id,
      name: 'Their Published Course',
      publishedAt: new Date(),
    });
    const handout = await resourceRow({
      courseId: publishedForeign.id,
      authorId: mine.id,
      title: 'Private Handout Ledger',
      isPublic: false,
    });

    const ownNotice = await announcementRow({ authorId: mine.id, title: 'Union Meeting Notes' });
    await announcementRow({ authorId: theirs.id, title: 'Their Meeting Notes' });

    const mineView = await get('/search?q=curriculum', mine.cookie);
    expect(mineView.json().courses.hits.map((hit: { id: string }) => hit.id)).toEqual([
      ownDraft.id,
    ]);
    const theirsView = await get('/search?q=curriculum', theirs.cookie);
    expect(theirsView.json().courses.hits.map((hit: { id: string }) => hit.id)).toEqual([
      foreignDraft.id,
    ]);
    expect(idsOf((await get('/search?q=curriculum', stranger.cookie)).json())).toEqual([]);

    expect(idsOf((await get('/search?q=ledger', mine.cookie)).json())).toEqual([handout]);
    expect(idsOf((await get('/search?q=ledger', theirs.cookie)).json())).toEqual([handout]);
    expect(idsOf((await get('/search?q=ledger', stranger.cookie)).json())).toEqual([]);

    expect(idsOf((await get('/search?q=union', mine.cookie)).json())).toEqual([ownNotice]);
    expect((await get('/search?q=union', theirs.cookie)).json().announcements.total).toBe(0);
  });

  it('gives admins every live row and excludes every soft-deleted one', async () => {
    const admin = await actor('admin@example.com', 'ADMIN');
    const teacher = await actor('teacher@example.com', 'TEACHER');

    const liveCourse = await courseRow({
      teacherId: teacher.id,
      name: 'Admin Sees Everything',
      publishedAt: new Date(),
    });
    const deadCourse = await courseRow({
      teacherId: teacher.id,
      name: 'Admin Never Finds This Course',
      publishedAt: new Date(),
    });
    const liveResource = await resourceRow({
      courseId: liveCourse.id,
      authorId: teacher.id,
      title: 'Live Handbook Chapter',
      isPublic: true,
    });
    const deadResource = await resourceRow({
      courseId: liveCourse.id,
      authorId: teacher.id,
      title: 'Dead Handbook Chapter',
      isPublic: true,
    });
    const liveNotice = await announcementRow({
      authorId: teacher.id,
      title: 'Live Notice About Deadlines',
      publishedAt: new Date(),
    });
    const deadNotice = await announcementRow({
      authorId: teacher.id,
      title: 'Dead Notice About Deadlines',
      publishedAt: new Date(),
    });
    const draftCourse = await courseRow({ teacherId: teacher.id, name: 'Draft Admin Finds' });

    await softDeleteCourse(deadCourse.id);
    await softDeleteResource(deadResource);
    await softDeleteAnnouncement(deadNotice);

    const courseView = await get('/search?q=admin', admin.cookie);
    const courseIds = courseView.json().courses.hits.map((hit: { id: string }) => hit.id);
    expect(courseIds.sort()).toEqual([liveCourse.id, draftCourse.id].sort());

    expect(idsOf((await get('/search?q=chapter', admin.cookie)).json())).toEqual([liveResource]);
    expect((await get('/search?q=deadlines', admin.cookie)).json().announcements.total).toBe(1);
    expect(liveNotice).toBeTruthy();
  });

  it('caps each group and reports the untruncated total', async () => {
    const teacher = await actor('teacher@example.com', 'TEACHER');
    for (let index = 1; index <= 7; index += 1) {
      await courseRow({
        teacherId: teacher.id,
        name: `Capacity Planning Volume ${index}`,
        publishedAt: new Date(),
      });
    }

    const capped = await get('/search?q=capacity&limit=3');
    expect(capped.statusCode).toBe(200);
    expect(capped.json().courses.hits).toHaveLength(3);
    expect(capped.json().courses.total).toBe(7);

    const defaulted = await get('/search?q=capacity');
    expect(defaulted.json().courses.hits).toHaveLength(5);
    expect(defaulted.json().courses.total).toBe(7);
  });

  it('returns ts_headline markup and notification-shaped linkPaths on every hit', async () => {
    const teacher = await actor('teacher@example.com', 'TEACHER');
    const host = await courseRow({
      teacherId: teacher.id,
      name: 'Electronics Home',
      publishedAt: new Date(),
    });

    const course = await courseRow({
      teacherId: teacher.id,
      name: 'Boilerplate Contract Law',
      publishedAt: new Date(),
    });
    const resource = await resourceRow({
      courseId: host.id,
      authorId: teacher.id,
      title: 'Resistor Colour Guide',
      isPublic: true,
    });
    const announcement = await announcementRow({
      authorId: teacher.id,
      title: 'Spring Fair',
      content: 'The festival returns this spring with new stalls.',
      publishedAt: new Date(),
    });

    const courseHit = (await get('/search?q=contract')).json().courses.hits[0];
    expect(courseHit.linkPath).toBe(`/courses/${course.id}`);
    expect(typeof courseHit.headline).toBe('string');
    expect(courseHit.headline.length).toBeGreaterThan(0);
    // The highlight is server-side ts_headline output, not a client-side regex pass.
    expect(courseHit.headline).toContain('<b>');

    const resourceHit = (await get('/search?q=resistor')).json().resources.hits[0];
    expect(resourceHit.linkPath).toBe(`/resources/${resource}`);
    expect(resourceHit.courseName).toBe('Electronics Home');
    expect(resourceHit.headline).toContain('<b>');

    const noticeHit = (await get('/search?q=festival')).json().announcements.hits[0];
    expect(noticeHit.linkPath).toBe(`/announcements/${announcement}`);
    expect(noticeHit.headline).toContain('<b>');
  });

  it('degrades sanely on missing, blank, one-letter and punctuation-only queries', async () => {
    // A lone minus sign is an empty tsquery, not a 500; with no rows seeded yet the
    // trigram arm has nothing to match either, so every group is deterministically 0.
    const loneOperator = await get('/search?q=-');
    expect(loneOperator.statusCode).toBe(200);
    expect(Object.keys(loneOperator.json()).sort()).toEqual([
      'announcements',
      'courses',
      'resources',
    ]);
    expect(loneOperator.json().courses.total).toBe(0);

    const teacher = await actor('teacher@example.com', 'TEACHER');
    await courseRow({ teacherId: teacher.id, name: 'Anything At All', publishedAt: new Date() });

    // q is required and trimmed to at least one character — these are 422s at the edge.
    expect((await get('/search')).statusCode).toBe(422);
    expect((await get('/search?q=')).statusCode).toBe(422);
    expect((await get('/search?q=%20%20')).statusCode).toBe(422);

    // A single stopword letter degrades to the trigram arm and stays a valid envelope.
    const oneLetter = await get('/search?q=a');
    expect(oneLetter.statusCode).toBe(200);
    expect(oneLetter.json().courses.total).toBeGreaterThan(0);
  });
});
