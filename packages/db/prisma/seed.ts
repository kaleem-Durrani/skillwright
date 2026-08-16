/**
 * Deterministic, idempotent development seed.
 *
 * Three properties are load-bearing, and each one exists because its absence hurts:
 *
 *   Deterministic — faker is seeded and every id is derived from a stable natural key, so
 *   two developers running `pnpm db:seed` get byte-identical data. A screenshot in a bug
 *   report then refers to the same row on the reader's machine.
 *
 *   Idempotent — every write is an upsert keyed on something the row genuinely owns, so
 *   re-running the seed against a populated database converges instead of exploding on a
 *   unique violation or doubling the catalogue.
 *
 *   Import-safe — nothing runs on import. Tests can import the fixtures and the helpers
 *   below without a stray `await main()` writing eighty users into whatever DATABASE_URL
 *   happened to be set.
 */

import { pathToFileURL } from 'node:url';
import { createCipheriv, createHash } from 'node:crypto';
import { faker } from '@faker-js/faker';
import argon2 from 'argon2';
import { encodeTime, encodeRandom } from 'ulid';
import { prisma } from '../src/index.js';
import { withAuditContext } from '../src/audit.js';
import { avatarUrlFor } from '../src/avatar.js';
import { logger, writeBanner } from '../src/logger.js';

// ---------------------------------------------------------------------------
// Determinism primitives
// ---------------------------------------------------------------------------

/** Fixed clock. Real timestamps would make every seeded row differ between runs. */
const EPOCH = Date.parse('2025-01-06T09:00:00.000Z');
const DAY_MS = 86_400_000;

const at = (days: number, hours = 0): Date => new Date(EPOCH + days * DAY_MS + hours * 3_600_000);

/** String -> 32-bit seed (xmur3). */
function seedFrom(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 — small, fast, and identical on every platform, which is the whole point. */
function prngFor(key: string): () => number {
  let a = seedFrom(key);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stable ULID for a logical row.
 *
 * Derived from the row's natural key rather than from call order, so inserting a new
 * department at the top of the list does not renumber every course id below it.
 */
function did(kind: string, key: string | number): string {
  return encodeTime(EPOCH, 10) + encodeRandom(16, prngFor(`${kind}:${key}`));
}

function pick<T>(items: readonly T[], rnd: () => number): T {
  return items[Math.floor(rnd() * items.length)]!;
}

/** Fisher-Yates against a seeded prng: a stable shuffle, so cohorts differ but do not drift. */
function shuffled<T>(items: readonly T[], key: string): T[] {
  const rnd = prngFor(key);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

export const DEMO_PASSWORD = 'demo-password-123';
const BULK_PASSWORD = 'skillwright-dev';

/** OWASP-recommended argon2id parameters. Slow by design; see the note in hashOnce. */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hashes each distinct seed password exactly once and reuses the digest.
 *
 * argon2id at production parameters costs ~50ms; hashing 95 users individually would add a
 * minute to every `db:reset`. Sharing a digest across seeded accounts is safe precisely
 * because they are seeded accounts — production accounts each get their own salt from the
 * registration path, which never calls this file.
 */
const hashCache = new Map<string, string>();
async function hashOnce(password: string): Promise<string> {
  const cached = hashCache.get(password);
  if (cached) return cached;
  const digest = await argon2.hash(password, ARGON2_OPTIONS);
  hashCache.set(password, digest);
  return digest;
}

/**
 * Encrypts a TOTP shared secret the way the API is expected to.
 *
 * Envelope: `v1.<iv>.<tag>.<ciphertext>`, each part base64url, AES-256-GCM, key from
 * TOTP_ENCRYPTION_KEY. The IV is derived rather than random so the seed stays
 * deterministic — acceptable for one fixed development account, never for real enrolment,
 * where a repeated IV under the same key is a break.
 */
function encryptTotpSecret(plaintext: string): string {
  const raw = process.env.TOTP_ENCRYPTION_KEY ?? '0'.repeat(64);
  const key =
    raw.length === 64 && /^[0-9a-f]+$/i.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
  const iv = createHash('sha256').update(`seed-totp-iv:${plaintext}`).digest().subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/** RFC 6238 test vector, so an authenticator app enrolled against it produces known codes. */
const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEPARTMENTS = [
  {
    name: 'Welding & Fabrication',
    prefix: 'WELD',
    description:
      'Arc, MIG and TIG processes, plate and pipe fabrication, and the inspection standards that decide whether a weld ships.',
  },
  {
    name: 'Automotive Technology',
    prefix: 'AUTO',
    description:
      'Engine diagnostics, drivetrain and chassis work on modern petrol, diesel and hybrid vehicles.',
  },
  {
    name: 'Electrical Installation',
    prefix: 'ELEC',
    description:
      'Domestic through industrial installation, testing and certification, to current wiring regulations.',
  },
  {
    name: 'HVAC & Refrigeration',
    prefix: 'HVAC',
    description:
      'Refrigeration theory, split and packaged systems, commercial chillers, and safe refrigerant handling.',
  },
  {
    name: 'CNC Machining',
    prefix: 'CNC',
    description: 'Turning, milling, workholding and CAM programming for production tolerances.',
  },
  {
    name: 'Industrial Plumbing',
    prefix: 'PLMB',
    description:
      'Pipefitting, steam and condensate systems, and backflow prevention for commercial sites.',
  },
] as const;

const COURSE_CATALOGUE: ReadonlyArray<{
  dept: number;
  name: string;
  level: number;
  durationValue: number;
  durationUnit: 'HOUR' | 'DAY' | 'WEEK' | 'MONTH';
  capacity: number;
  description: string;
}> = [
  {
    dept: 0,
    name: 'Shielded Metal Arc Welding: Level 1',
    level: 101,
    durationValue: 12,
    durationUnit: 'WEEK',
    capacity: 24,
    description:
      'Electrode selection, striking and running a bead, and flat and horizontal fillet welds to a repeatable standard.',
  },
  {
    dept: 0,
    name: 'GTAW / TIG for Stainless and Aluminium',
    level: 201,
    durationValue: 10,
    durationUnit: 'WEEK',
    capacity: 18,
    description:
      'Torch control, filler feed and purge technique for thin-wall stainless and aluminium assemblies.',
  },
  {
    dept: 0,
    name: 'Structural Plate and Pipe Fabrication',
    level: 301,
    durationValue: 6,
    durationUnit: 'MONTH',
    capacity: 22,
    description:
      'Layout, cutting, fit-up and distortion control on structural plate and 6G pipe joints.',
  },
  {
    dept: 1,
    name: 'Petrol Engine Diagnostics and Repair',
    level: 101,
    durationValue: 30,
    durationUnit: 'WEEK',
    capacity: 30,
    description:
      'Scan-tool diagnostics, compression and leak-down testing, and top-end overhaul on modern petrol engines.',
  },
  {
    dept: 1,
    name: 'Automotive Electrical and Battery Systems',
    level: 201,
    durationValue: 14,
    durationUnit: 'WEEK',
    capacity: 26,
    description:
      'Wiring diagrams, parasitic draw testing, CAN bus basics and safe high-voltage battery isolation.',
  },
  {
    dept: 1,
    name: 'Brake, Steering and Suspension Overhaul',
    level: 202,
    durationValue: 8,
    durationUnit: 'WEEK',
    capacity: 22,
    description:
      'Hydraulic and ABS service, geometry alignment, and strut and bush replacement to manufacturer spec.',
  },
  {
    dept: 2,
    name: 'Domestic Wiring and Consumer Units',
    level: 101,
    durationValue: 16,
    durationUnit: 'WEEK',
    capacity: 28,
    description:
      'Circuit design for dwellings, consumer unit installation, and initial verification and certification.',
  },
  {
    dept: 2,
    name: 'Three-Phase Industrial Installation',
    level: 201,
    durationValue: 5,
    durationUnit: 'MONTH',
    capacity: 20,
    description:
      'Distribution boards, containment, cable sizing and earthing arrangements for three-phase plant.',
  },
  {
    dept: 2,
    name: 'Motor Control and PLC Fundamentals',
    level: 301,
    durationValue: 12,
    durationUnit: 'WEEK',
    capacity: 18,
    description:
      'DOL and star-delta starters, contactor logic, and ladder programming on a compact PLC.',
  },
  {
    dept: 3,
    name: 'Refrigeration Cycle Fundamentals',
    level: 101,
    durationValue: 8,
    durationUnit: 'WEEK',
    capacity: 26,
    description:
      'Pressure-enthalpy behaviour, component roles, superheat and subcooling measurement.',
  },
  {
    dept: 3,
    name: 'Split-System Installation and Commissioning',
    level: 201,
    durationValue: 6,
    durationUnit: 'WEEK',
    capacity: 24,
    description:
      'Brazing, evacuation, charge weighing and commissioning records for residential and light commercial splits.',
  },
  {
    dept: 3,
    name: 'Commercial Chiller Maintenance',
    level: 301,
    durationValue: 4,
    durationUnit: 'MONTH',
    capacity: 16,
    description:
      'Scheduled maintenance, log interpretation and fault-finding on air- and water-cooled chillers.',
  },
  {
    dept: 4,
    name: 'CNC Turning: Setup and Operation',
    level: 101,
    durationValue: 10,
    durationUnit: 'WEEK',
    capacity: 20,
    description:
      'Workholding, tool offsets, first-article inspection and safe operation of a two-axis lathe.',
  },
  {
    dept: 4,
    name: 'CNC Milling and Fixture Design',
    level: 201,
    durationValue: 12,
    durationUnit: 'WEEK',
    capacity: 18,
    description:
      'Three-axis milling strategy, fixture design, and holding tolerance across a production run.',
  },
  {
    dept: 4,
    name: 'CAM Programming with G-Code',
    level: 301,
    durationValue: 60,
    durationUnit: 'HOUR',
    capacity: 16,
    description:
      'Toolpath generation, post-processing and hand-editing G-code to fix what CAM gets wrong.',
  },
  {
    dept: 5,
    name: 'Pipefitting and Threading Fundamentals',
    level: 101,
    durationValue: 8,
    durationUnit: 'WEEK',
    capacity: 24,
    description:
      'Measurement, cutting, threading and jointing of steel, copper and plastic pipework.',
  },
  {
    dept: 5,
    name: 'Industrial Steam and Condensate Lines',
    level: 201,
    durationValue: 5,
    durationUnit: 'MONTH',
    capacity: 18,
    description:
      'Steam trap selection, condensate recovery, expansion allowance and safe isolation procedure.',
  },
  {
    dept: 5,
    name: 'Backflow Prevention and Testing',
    level: 301,
    durationValue: 40,
    durationUnit: 'HOUR',
    capacity: 16,
    description:
      'Device types, hazard assessment, annual test procedure and the paperwork an inspector accepts.',
  },
];

/** The one course seeded at 29/30, so the capacity edge is reachable without setup. */
const NEARLY_FULL_COURSE_INDEX = 3;

const QUALIFICATIONS = [
  'City & Guilds Level 3 Diploma',
  'NVQ Level 4 in Engineering Maintenance',
  'BEng (Hons) Mechanical Engineering',
  'CSWIP 3.1 Welding Inspector',
  'HND Electrical & Electronic Engineering',
  'F-Gas Category I Certification',
] as const;

const MESSAGE_OPENERS = [
  'Quick question about the Thursday practical',
  'I have uploaded the revised bench layout',
  'Can we move the assessment to next week?',
  'The consumables order came in this morning',
  'Two students still need PPE sign-off',
  'Reminder: the workshop closes at 16:00 on Friday',
  'I have marked the fabrication drawings',
  'The compressor is back in service',
] as const;

// ---------------------------------------------------------------------------
// Seed steps
// ---------------------------------------------------------------------------

type SeededUser = { id: string; name: string; email: string };

async function seedDepartments() {
  const rows = [];
  for (const [index, dept] of DEPARTMENTS.entries()) {
    const slug = slugify(dept.name);
    const data = { name: dept.name, slug, description: dept.description };
    rows.push(
      await prisma.department.upsert({
        where: { slug },
        create: { id: did('department', slug), ...data, createdAt: at(-120 + index) },
        update: data,
      }),
    );
  }
  logger.info('seed.departments', { count: rows.length });
  return rows;
}

async function seedUsers(departmentIds: string[]) {
  const bulkHash = await hashOnce(BULK_PASSWORD);
  const demoHash = await hashOnce(DEMO_PASSWORD);

  async function upsertUser(spec: {
    email: string;
    name: string;
    role: 'STUDENT' | 'TEACHER' | 'ADMIN';
    // `| undefined` is explicit because the repo compiles with
    // exactOptionalPropertyTypes: callers below pass `status: undefined` /
    // `totp: undefined` positionally rather than omitting the key, and the body
    // already defaults both (`?? 'ACTIVE'`, `? ... : null`).
    status?: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | undefined;
    passwordHash: string;
    bio: string;
    phoneNumber: string;
    createdAt: Date;
    lastLoginAt: Date;
    totp?: { secret: string; enabledAt: Date } | undefined;
  }): Promise<SeededUser> {
    const common = {
      name: spec.name,
      role: spec.role,
      status: spec.status ?? ('ACTIVE' as const),
      passwordHash: spec.passwordHash,
      bio: spec.bio,
      phoneNumber: spec.phoneNumber,
      lastLoginAt: spec.lastLoginAt,
      totpSecret: spec.totp ? encryptTotpSecret(spec.totp.secret) : null,
      totpEnabledAt: spec.totp?.enabledAt ?? null,
    };
    return prisma.user.upsert({
      where: { email: spec.email },
      create: {
        id: did('user', spec.email),
        email: spec.email,
        createdAt: spec.createdAt,
        ...common,
      },
      update: common,
    });
  }

  // --- teachers -----------------------------------------------------------
  const teachers: SeededUser[] = [];
  for (let i = 0; i < 12; i += 1) {
    const isDemo = i === 0;
    const name = isDemo ? 'Marcus Halloway' : faker.person.fullName();
    const email = isDemo
      ? 'demo.teacher@skillwright.dev'
      : `${slugify(name)}.t${i}@skillwright.dev`;
    const rnd = prngFor(`teacher:${i}`);
    const user = await upsertUser({
      email,
      name,
      role: 'TEACHER',
      passwordHash: isDemo ? demoHash : bulkHash,
      bio: faker.lorem.sentence({ min: 12, max: 22 }),
      phoneNumber: `+92-300-${1000000 + Math.floor(rnd() * 8999999)}`,
      createdAt: at(-100 + i),
      lastLoginAt: at(-2, i % 12),
    });
    const departmentId = departmentIds[i % departmentIds.length]!;
    const profile = {
      departmentId,
      qualification: pick(QUALIFICATIONS, rnd),
      specialization: faker.person.jobArea(),
      // The last teacher has no staff number: an admin provisioned them before HR issued
      // one, which is the case the nullable column exists for.
      staffNo: i === 11 ? null : `EMP-${String(i + 1).padStart(3, '0')}`,
    };
    await prisma.teacherProfile.upsert({
      where: { userId: user.id },
      create: { id: did('teacherProfile', email), userId: user.id, ...profile },
      update: profile,
    });
    teachers.push(user);
  }

  // --- students -----------------------------------------------------------
  const students: SeededUser[] = [];
  for (let i = 0; i < 80; i += 1) {
    const isDemo = i === 0;
    const name = isDemo ? 'Dawn Reyes' : faker.person.fullName();
    const email = isDemo
      ? 'demo.student@skillwright.dev'
      : `${slugify(name)}.s${i}@skillwright.dev`;
    const rnd = prngFor(`student:${i}`);
    // Two students are deliberately not ACTIVE. Every `can()` rule that gates on status is
    // otherwise unreachable without hand-editing a row, and an untestable rule is a rule
    // that quietly rots.
    const status =
      i === 78 ? ('SUSPENDED' as const) : i === 79 ? ('PENDING_VERIFICATION' as const) : undefined;
    const user = await upsertUser({
      email,
      name,
      role: 'STUDENT',
      status,
      passwordHash: isDemo ? demoHash : bulkHash,
      bio: faker.lorem.sentence({ min: 8, max: 16 }),
      phoneNumber: `+92-301-${1000000 + Math.floor(rnd() * 8999999)}`,
      createdAt: at(-90 + (i % 60)),
      lastLoginAt: at(-1, i % 20),
    });
    const profile = {
      departmentId: departmentIds[i % departmentIds.length]!,
      enrollmentNo: `SW-2025-${String(i + 1).padStart(4, '0')}`,
      enrolledOn: at(-88 + (i % 60)),
    };
    await prisma.studentProfile.upsert({
      where: { userId: user.id },
      create: { id: did('studentProfile', email), userId: user.id, ...profile },
      update: profile,
    });
    students.push(user);
  }

  // --- admins -------------------------------------------------------------
  const admins: SeededUser[] = [];
  const adminSpecs = [
    { name: 'Priya Anand', email: 'demo.admin@skillwright.dev', demo: true, totp: false },
    // Not the demo admin: giving the demo account a second factor would make the
    // one-click demo login dead-end at an authenticator app nobody has enrolled.
    { name: 'Idris Okonkwo', email: 'idris.okonkwo@skillwright.dev', demo: false, totp: true },
    { name: 'Helen Vasquez', email: 'helen.vasquez@skillwright.dev', demo: false, totp: false },
  ] as const;

  for (const [i, spec] of adminSpecs.entries()) {
    const user = await upsertUser({
      email: spec.email,
      name: spec.name,
      role: 'ADMIN',
      passwordHash: spec.demo ? demoHash : bulkHash,
      bio: faker.lorem.sentence({ min: 10, max: 18 }),
      phoneNumber: `+92-302-${2000000 + i * 11111}`,
      createdAt: at(-130 + i),
      lastLoginAt: at(0, 8 + i),
      totp: spec.totp ? { secret: DEMO_TOTP_SECRET, enabledAt: at(-40) } : undefined,
    });

    if (spec.totp) {
      // Recovery codes are password-equivalent, so they are argon2id hashed exactly like
      // passwords. The plaintexts are printed in the banner; they are development codes.
      for (let c = 0; c < 4; c += 1) {
        const plain = `SW-RECOV-${String(c + 1).padStart(2, '0')}`;
        const id = did('recoveryCode', `${spec.email}:${c}`);
        await prisma.recoveryCode.upsert({
          where: { id },
          create: { id, userId: user.id, codeHash: await hashOnce(plain), createdAt: at(-40) },
          update: {},
        });
      }
    }
    admins.push(user);
  }

  logger.info('seed.users', {
    teachers: teachers.length,
    students: students.length,
    admins: admins.length,
  });
  return { teachers, students, admins };
}

async function seedCourses(departmentIds: string[], teachers: SeededUser[]) {
  const courses = [];
  for (const [index, spec] of COURSE_CATALOGUE.entries()) {
    const code = `${DEPARTMENTS[spec.dept]!.prefix}-${spec.level}`;
    const slug = slugify(`${spec.name}-${code}`);
    const teacher = teachers[(spec.dept * 2 + (index % 2)) % teachers.length]!;
    const capacity = index === NEARLY_FULL_COURSE_INDEX ? 30 : spec.capacity;

    const syllabusKey = `syllabi/${code.toLowerCase()}/${did('syllabusKey', code)}.pdf`;
    const syllabus = await prisma.upload.upsert({
      where: { key: syllabusKey },
      create: {
        id: did('syllabusUpload', code),
        key: syllabusKey,
        bucket: 'skillwright-uploads',
        contentType: 'application/pdf',
        sizeBytes: 180_000 + index * 4_100,
        originalName: `${slugify(spec.name)}-syllabus.pdf`,
        status: 'COMMITTED',
        ownerId: teacher.id,
        createdAt: at(-70 + index),
        committedAt: at(-70 + index, 1),
      },
      update: { status: 'COMMITTED', ownerId: teacher.id },
    });

    const data = {
      name: spec.name,
      slug,
      description: spec.description,
      departmentId: departmentIds[spec.dept]!,
      teacherId: teacher.id,
      durationValue: spec.durationValue,
      durationUnit: spec.durationUnit,
      capacity,
      startDate: at(-60 + index * 2),
      endDate: at(60 + index * 3),
      syllabusUploadId: syllabus.id,
      publishedAt: at(-65 + index),
    };

    courses.push(
      await prisma.course.upsert({
        where: { code },
        create: { id: did('course', code), code, createdAt: at(-70 + index), ...data },
        update: data,
      }),
    );
  }
  logger.info('seed.courses', { count: courses.length, published: courses.length });
  return courses;
}

async function seedEnrollments(
  courses: Array<{ id: string; code: string; capacity: number; teacherId: string }>,
  students: SeededUser[],
  admins: SeededUser[],
) {
  let total = 0;

  for (const [index, course] of courses.entries()) {
    const rnd = prngFor(`enrollment:${course.code}`);
    const plan =
      index === NEARLY_FULL_COURSE_INDEX
        ? { APPROVED: 29, PENDING: 4, REJECTED: 1, WITHDRAWN: 1, COMPLETED: 0 }
        : {
            APPROVED: 6 + Math.floor(rnd() * 8),
            PENDING: Math.floor(rnd() * 5),
            REJECTED: Math.floor(rnd() * 3),
            WITHDRAWN: Math.floor(rnd() * 3),
            COMPLETED: Math.floor(rnd() * 6),
          };

    const cohort = shuffled(students, `cohort:${course.code}`);
    let cursor = 0;
    let approved = 0;

    for (const [status, count] of Object.entries(plan) as Array<
      ['APPROVED' | 'PENDING' | 'REJECTED' | 'WITHDRAWN' | 'COMPLETED', number]
    >) {
      for (let n = 0; n < count; n += 1) {
        const student = cohort[cursor % cohort.length]!;
        cursor += 1;

        const decided = status !== 'PENDING';
        // Decisions alternate between the course's own teacher and an admin, because the
        // policy layer allows both and only seeded data proves the UI renders both.
        const decider = n % 4 === 0 ? admins[n % admins.length]!.id : course.teacherId;
        const data = {
          status,
          requestedAt: at(-50 + (cursor % 30)),
          decidedAt: decided ? at(-48 + (cursor % 30)) : null,
          decidedById: decided ? decider : null,
          decisionNote:
            status === 'REJECTED'
              ? 'Prerequisite not met: complete the Level 1 course first.'
              : status === 'WITHDRAWN'
                ? 'Withdrawn at the student’s request.'
                : null,
        };

        await prisma.enrollment.upsert({
          where: { studentId_courseId: { studentId: student.id, courseId: course.id } },
          create: {
            id: did('enrollment', `${course.code}:${student.id}`),
            studentId: student.id,
            courseId: course.id,
            ...data,
          },
          update: data,
        });

        if (status === 'APPROVED') approved += 1;
        total += 1;
      }
    }

    // approvedCount is denormalised, so the seed must leave it truthful — a seed that
    // violates the invariant it is meant to demonstrate is worse than no seed.
    await prisma.course.update({ where: { id: course.id }, data: { approvedCount: approved } });
  }

  logger.info('seed.enrollments', { count: total });
}

async function seedResources(courses: Array<{ id: string; code: string; teacherId: string }>) {
  const TYPES = ['DOCUMENT', 'DOCUMENT', 'VIDEO', 'LINK'] as const;
  const EXTERNAL_LINKS = [
    'https://www.osha.gov/laboratories/hazards',
    'https://www.aws.org/standards',
    'https://www.ashrae.org/technical-resources',
    'https://www.iec.ch/standards',
  ] as const;

  const resources = [];
  for (let i = 0; i < 60; i += 1) {
    const course = courses[i % courses.length]!;
    const type = TYPES[i % TYPES.length]!;
    const rnd = prngFor(`resource:${i}`);
    const key = `resource:${i}`;
    const title =
      type === 'VIDEO'
        ? `Workshop demonstration ${Math.floor(i / 4) + 1}: ${faker.lorem.words({ min: 2, max: 4 })}`
        : type === 'LINK'
          ? `Reference standard: ${faker.lorem.words({ min: 2, max: 4 })}`
          : `Handout ${Math.floor(i / 4) + 1}: ${faker.lorem.words({ min: 2, max: 5 })}`;

    let uploadId: string | null = null;
    let externalUrl: string | null = null;

    if (type === 'LINK') {
      externalUrl = pick(EXTERNAL_LINKS, rnd);
    } else {
      const ext = type === 'VIDEO' ? '.mp4' : '.pdf';
      const objectKey = `resources/${course.code.toLowerCase()}/${did('resourceKey', key)}${ext}`;
      const upload = await prisma.upload.upsert({
        where: { key: objectKey },
        create: {
          id: did('resourceUpload', key),
          key: objectKey,
          bucket: 'skillwright-uploads',
          contentType: type === 'VIDEO' ? 'video/mp4' : 'application/pdf',
          sizeBytes: type === 'VIDEO' ? 24_000_000 + i * 91_000 : 240_000 + i * 3_300,
          originalName: `${slugify(title)}${ext}`,
          status: 'COMMITTED',
          ownerId: course.teacherId,
          createdAt: at(-40 + (i % 30)),
          committedAt: at(-40 + (i % 30), 1),
        },
        update: { status: 'COMMITTED' },
      });
      uploadId = upload.id;
    }

    const id = did('resource', key);
    const data = {
      title,
      description: faker.lorem.sentence({ min: 10, max: 20 }),
      type,
      courseId: course.id,
      authorId: course.teacherId,
      uploadId,
      externalUrl,
      // Every third resource is public: enough to make the anonymous-visitor path visible
      // on the marketing pages without making the enrolment gate look decorative.
      isPublic: i % 3 === 0,
    };

    resources.push(
      await prisma.resource.upsert({
        where: { id },
        create: { id, createdAt: at(-40 + (i % 30)), ...data },
        update: data,
      }),
    );
  }

  logger.info('seed.resources', {
    count: resources.length,
    public: resources.filter((r) => r.isPublic).length,
  });
  return resources;
}

async function seedAnnouncements(authors: SeededUser[]) {
  const SPECS = [
    { title: 'Spring intake applications now open', type: 'ANNOUNCEMENT', published: true },
    { title: 'New TIG welding bays commissioned', type: 'NEWS', published: true },
    {
      title: 'Industry open day: employers on site',
      type: 'EVENT',
      published: true,
      eventOffset: 21,
    },
    { title: 'Revised PPE policy takes effect Monday', type: 'ANNOUNCEMENT', published: true },
    {
      title: 'Apprenticeship partnership with Northgate Engineering',
      type: 'NEWS',
      published: true,
    },
    {
      title: 'Workshop closure for annual electrical inspection',
      type: 'ANNOUNCEMENT',
      published: true,
      eventOffset: 9,
    },
    {
      title: 'Guest lecture: welding inspection in the field',
      type: 'EVENT',
      published: true,
      eventOffset: 14,
    },
    { title: 'Level 3 results published to student portals', type: 'NEWS', published: true },
    { title: 'Draft: summer timetable consultation', type: 'ANNOUNCEMENT', published: false },
    { title: 'Draft: new CNC simulator procurement', type: 'NEWS', published: false },
    { title: 'Draft: careers fair logistics', type: 'EVENT', published: false, eventOffset: 45 },
    { title: 'Draft: revised attendance policy', type: 'ANNOUNCEMENT', published: false },
  ] as const;

  const announcements = [];
  for (const [i, spec] of SPECS.entries()) {
    const slug = slugify(spec.title);
    const author = authors[i % authors.length]!;
    const data = {
      title: spec.title,
      content: faker.lorem.paragraphs({ min: 2, max: 4 }, '\n\n'),
      type: spec.type,
      authorId: author.id,
      eventDate: 'eventOffset' in spec ? at(spec.eventOffset) : null,
      publishedAt: spec.published ? at(-30 + i * 2) : null,
    };
    announcements.push(
      await prisma.announcement.upsert({
        where: { slug },
        create: { id: did('announcement', slug), slug, createdAt: at(-32 + i * 2), ...data },
        update: data,
      }),
    );
  }

  logger.info('seed.announcements', {
    count: announcements.length,
    published: announcements.filter((a) => a.publishedAt !== null).length,
  });
  return announcements;
}

async function seedComments(
  resources: Array<{ id: string }>,
  announcements: Array<{ id: string; publishedAt: Date | null }>,
  commenters: SeededUser[],
) {
  let count = 0;

  async function thread(
    parentKey: string,
    link: { resourceId?: string; announcementId?: string },
    index: number,
  ) {
    const rnd = prngFor(`comment:${parentKey}`);
    for (let top = 0; top < 2; top += 1) {
      const author = pick(commenters, rnd);
      const id = did('comment', `${parentKey}:${top}`);
      const data = {
        content: faker.lorem.sentences({ min: 1, max: 3 }),
        authorId: author.id,
        ...link,
        parentId: null,
      };
      const root = await prisma.comment.upsert({
        where: { id },
        create: { id, createdAt: at(-20 + (index % 15), top), ...data },
        update: data,
      });
      count += 1;

      // Exactly two levels. A third level is a thread nobody can read on a phone, and the
      // API's reply endpoint rejects a parent that already has a parent.
      if (top === 0) {
        const replyAuthor = pick(commenters, rnd);
        const replyId = did('comment', `${parentKey}:${top}:reply`);
        const replyData = {
          content: faker.lorem.sentences({ min: 1, max: 2 }),
          authorId: replyAuthor.id,
          ...link,
          parentId: root.id,
        };
        await prisma.comment.upsert({
          where: { id: replyId },
          create: { id: replyId, createdAt: at(-20 + (index % 15), top + 2), ...replyData },
          update: replyData,
        });
        count += 1;
      }
    }
  }

  for (const [i, resource] of resources.slice(0, 24).entries()) {
    await thread(`resource:${resource.id}`, { resourceId: resource.id }, i);
  }
  for (const [i, announcement] of announcements.filter((a) => a.publishedAt).entries()) {
    await thread(`announcement:${announcement.id}`, { announcementId: announcement.id }, i);
  }

  logger.info('seed.comments', { count });
}

async function seedConversations(
  teachers: SeededUser[],
  students: SeededUser[],
  admins: SeededUser[],
) {
  /** Sums to 400. Uneven on purpose: pagination bugs hide behind uniform fixtures. */
  const MESSAGE_COUNTS = [40, 38, 36, 34, 32, 30, 28, 26, 24, 22, 20, 32, 24, 14];

  let messageTotal = 0;

  for (let c = 0; c < 14; c += 1) {
    const rnd = prngFor(`conversation:${c}`);
    const teacher = teachers[c % teachers.length]!;
    const student = students[(c * 7) % students.length]!;

    // Conversations 0 and 1 seat an admin alongside a teacher and a student. The previous
    // schema's fixed (teacherId, studentId) pair physically could not express this, which
    // is why its admin chat shipped as a placeholder. Two rows here prove the N-participant
    // model actually works end to end.
    const members: SeededUser[] =
      c === 0
        ? [teacher, student, admins[1]!]
        : c === 1
          ? [teacher, students[(c * 7 + 3) % students.length]!, admins[0]!, admins[2]!]
          : c % 5 === 2
            ? [teacher, student, students[(c * 11) % students.length]!]
            : [teacher, student];

    const title =
      members.length > 2 ? `${faker.company.buzzNoun()} coordination — ${teacher.name}` : null;
    const count = MESSAGE_COUNTS[c]!;
    const conversationId = did('conversation', `${c}`);
    const lastMessageAt = at(-14 + c, count % 12);

    await prisma.conversation.upsert({
      where: { id: conversationId },
      create: {
        id: conversationId,
        title,
        nextSeq: BigInt(count + 1),
        createdAt: at(-30 + c),
        lastMessageAt,
      },
      update: { title, nextSeq: BigInt(count + 1), lastMessageAt },
    });

    // Messages first: a participant's lastReadSeq is only meaningful once the seqs exist.
    for (let s = 1; s <= count; s += 1) {
      const sender = members[(s - 1) % members.length]!;
      const clientMsgId = did('message', `${c}:${s}`);
      const content = `${pick(MESSAGE_OPENERS, rnd)}. ${faker.lorem.sentence({ min: 6, max: 18 })}`;
      const createdAt = at(-30 + c, Math.min(23, Math.floor((s / count) * 23)));
      const editedAt = s % 17 === 0 ? new Date(createdAt.getTime() + 120_000) : null;

      await prisma.message.upsert({
        where: { senderId_clientMsgId: { senderId: sender.id, clientMsgId } },
        create: {
          id: did('messageRow', `${c}:${s}`),
          conversationId,
          senderId: sender.id,
          seq: BigInt(s),
          content,
          clientMsgId,
          createdAt,
          editedAt,
        },
        update: { content, editedAt },
      });
      messageTotal += 1;
    }

    for (const [m, member] of members.entries()) {
      // Mixed read state: the first participant is caught up, everyone else is behind by a
      // widening margin, so the unread badge has something to render other than zero.
      const lastReadSeq = m === 0 ? count : Math.max(0, count - (2 + m * 5));
      await prisma.conversationParticipant.upsert({
        where: { conversationId_userId: { conversationId, userId: member.id } },
        create: {
          id: did('participant', `${c}:${member.id}`),
          conversationId,
          userId: member.id,
          lastReadSeq: BigInt(lastReadSeq),
          lastReadAt: lastReadSeq > 0 ? at(-14 + c, 6) : null,
          joinedAt: at(-30 + c),
        },
        update: {
          lastReadSeq: BigInt(lastReadSeq),
          lastReadAt: lastReadSeq > 0 ? at(-14 + c, 6) : null,
        },
      });
    }
  }

  logger.info('seed.conversations', { conversations: 14, messages: messageTotal });
}

async function seedNotifications(
  students: SeededUser[],
  teachers: SeededUser[],
  courses: Array<{ id: string; slug: string; name: string }>,
) {
  const STUDENT_TYPES = [
    'ENROLLMENT_APPROVED',
    'ENROLLMENT_REJECTED',
    'RESOURCE_PUBLISHED',
    'ANNOUNCEMENT_PUBLISHED',
    'MESSAGE_RECEIVED',
    'COMMENT_REPLIED',
  ] as const;

  let count = 0;

  for (const [i, student] of students.slice(0, 45).entries()) {
    const rnd = prngFor(`notification:${student.id}`);
    for (let n = 0; n < 3; n += 1) {
      const type = STUDENT_TYPES[(i + n) % STUDENT_TYPES.length]!;
      const course = courses[(i + n) % courses.length]!;
      const id = did('notification', `${student.id}:${n}`);
      const data = {
        userId: student.id,
        type,
        // Denormalised so rendering never joins to a row that may since have been deleted.
        payload: { courseName: course.name, courseSlug: course.slug, actorName: 'Skillwright' },
        linkPath: `/courses/${course.slug}`,
        readAt: rnd() > 0.55 ? at(-3, n) : null,
        createdAt: at(-6 + n, i % 12),
      };
      await prisma.notification.upsert({ where: { id }, create: { id, ...data }, update: data });
      count += 1;
    }
  }

  for (const [i, teacher] of teachers.entries()) {
    const id = did('notification', `${teacher.id}:enrollment`);
    const course = courses[i % courses.length]!;
    const data = {
      userId: teacher.id,
      type: 'ENROLLMENT_REQUESTED' as const,
      payload: { courseName: course.name, courseSlug: course.slug, pending: 3 },
      linkPath: `/courses/${course.slug}/enrollments`,
      readAt: null,
      createdAt: at(-1, i),
    };
    await prisma.notification.upsert({ where: { id }, create: { id, ...data }, update: data });
    count += 1;
  }

  logger.info('seed.notifications', { count });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function seed(): Promise<void> {
  faker.seed(42);

  const departments = await seedDepartments();
  const departmentIds = departments.map((d) => d.id);

  const { teachers, students, admins } = await seedUsers(departmentIds);
  const courses = await seedCourses(departmentIds, teachers);
  await seedEnrollments(courses, students, admins);

  const resources = await seedResources(courses);
  const announcements = await seedAnnouncements([...admins, ...teachers.slice(0, 4)]);
  await seedComments(resources, announcements, [...students.slice(0, 30), ...teachers, ...admins]);
  await seedConversations(teachers, students, admins);
  await seedNotifications(students, teachers, courses);

  const demoStudent = students[0]!;
  writeBanner(
    box([
      'Skillwright seed complete — development credentials',
      null,
      `student   demo.student@skillwright.dev   ${DEMO_PASSWORD}`,
      `teacher   demo.teacher@skillwright.dev   ${DEMO_PASSWORD}`,
      `admin     demo.admin@skillwright.dev     ${DEMO_PASSWORD}`,
      null,
      `Every other seeded account uses the password  ${BULK_PASSWORD}`,
      'TOTP-enabled admin: idris.okonkwo@skillwright.dev',
      `  authenticator secret  ${DEMO_TOTP_SECRET}`,
      '  recovery codes        SW-RECOV-01 … SW-RECOV-04',
      null,
      `SUSPENDED student             ${students[78]!.email}`,
      `PENDING_VERIFICATION student  ${students[79]!.email}`,
      null,
      `${COURSE_CATALOGUE[NEARLY_FULL_COURSE_INDEX]!.name}`,
      '  is seeded at 29 / 30 approved — one seat from the capacity edge.',
      null,
      'Avatars are derived, not stored. Example:',
      `  ${avatarUrlFor(demoStudent.id).slice(0, 72)}…`,
    ]),
  );
}

/** Draws a box that fits its content, so a longer course name never breaks the frame. */
function box(lines: Array<string | null>): string {
  const width = Math.max(...lines.map((l) => (l ?? '').length)) + 2;
  const top = `┌${'─'.repeat(width + 2)}┐`;
  const rule = `├${'─'.repeat(width + 2)}┤`;
  const bottom = `└${'─'.repeat(width + 2)}┘`;
  const body = lines.map((l) => (l === null ? rule : `│ ${l.padEnd(width)} │`));
  return ['', top, ...body, bottom, ''].join('\n');
}

/**
 * Only runs when this file is the process entry point.
 *
 * Importing the module must be free of side effects so tests can reuse `seed()` and the
 * fixture helpers without a stray invocation writing to whatever DATABASE_URL is set.
 */
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  await withAuditContext(
    { actorId: null, requestId: 'seed', ip: null, userAgent: 'prisma-seed' },
    async () => {
      try {
        await seed();
      } catch (error) {
        logger.error('seed.failed', { error });
        process.exitCode = 1;
      } finally {
        await prisma.$disconnect();
      }
    },
  );
}
