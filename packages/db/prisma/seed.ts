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
import { faker } from '@faker-js/faker';
import argon2 from 'argon2';
import { encodeTime, encodeRandom } from 'ulid';
import { prisma } from '../src/index.js';
import { encryptTotpSecret } from '../src/totp.js';
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
 * The TOTP secret is encrypted by `encryptTotpSecret` from @skillwright/db, which is
 * the SAME function apps/api's `decryptSecret` is written against.
 *
 * There used to be a private copy here with a different envelope and a different key
 * variable, so this admin's every correct authenticator code was rejected. One
 * implementation now, and apps/api/test/auth.test.ts asserts the round trip.
 *
 * `deterministicIv` keeps re-seeding idempotent. It is safe for exactly this one
 * fixed development account and would be a complete break of GCM anywhere else.
 */
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

/**
 * The course that demonstrates Phase 9's model: TWO intakes. Its first offering is
 * already running (the dates every other course has); the second opens later — the
 * "spring cohort" CourseDetail.tsx promises and this seed used to announce with
 * nothing backing it.
 */
const TWO_INTAKE_COURSE_INDEX = 0;
const SPRING_START_OFFSET = 75;

const QUALIFICATIONS = [
  'City & Guilds Level 3 Diploma',
  'NVQ Level 4 in Engineering Maintenance',
  'BEng (Hons) Mechanical Engineering',
  'CSWIP 3.1 Welding Inspector',
  'HND Electrical & Electronic Engineering',
  'F-Gas Category I Certification',
] as const;

/**
 * The modelled catalogue those six free-text strings were always describing.
 *
 * `QUALIFICATIONS` above feeds `TeacherProfile.qualification` — a teacher's own record
 * of their own training, which migration 0013 deliberately left as prose. This list is
 * the OTHER thing: a row an AWARD is issued against, which is what `POST /certificates`
 * requires a `qualificationId` for. With this step absent the `Qualification` table is
 * empty, `GET /qualifications` returns `[]`, and the issue dialog has nothing to offer —
 * so the whole certificate feature, which migration 0013 built and the tests exercise,
 * cannot be reached in the demo. That is the gap this closes.
 *
 * The names are the six strings verbatim, so a reader holding the old seed in one hand
 * and this in the other can match them line for line; `code`, `level` and
 * `awardingBody` are the halves the single free-text column could not carry, and the
 * reason each is a separate column is the argument schema.prisma makes on
 * `Qualification`:
 *
 *   - `code` is the number an employer looks the standard up BY ("CSWIP 3.1"), which is
 *     why it is the @unique natural key this seed upserts on.
 *   - `level` is a string, not a number, because these six are not one scale — C&G runs
 *     to 5, NVQ to 8, F-Gas has categories, and a BEng sits on a national framework at
 *     Level 6. A numeric level would be a lie about four of the six.
 *   - `awardingBody` is the second thing a fraudulent certificate is checked against,
 *     after the reference. Every entry names a real body that runs that standard in the
 *     UK, because a catalogue row that names a body nobody recognises is not a
 *     verification aid, it is decoration.
 */
const QUALIFICATION_CATALOGUE: ReadonlyArray<{
  code: string;
  name: string;
  level: string;
  awardingBody: string;
}> = [
  {
    code: 'C&G-L3-DIP',
    name: 'City & Guilds Level 3 Diploma',
    level: 'Level 3',
    awardingBody: 'City & Guilds',
  },
  {
    code: 'NVQ-L4-ENG-MAINT',
    name: 'NVQ Level 4 in Engineering Maintenance',
    level: 'Level 4',
    awardingBody: 'City & Guilds',
  },
  {
    code: 'BENG-MECH-HONS',
    name: 'BEng (Hons) Mechanical Engineering',
    level: 'Level 6',
    awardingBody: 'Engineering Council',
  },
  {
    code: 'CSWIP-3-1',
    name: 'CSWIP 3.1 Welding Inspector',
    level: 'Grade 3.1',
    awardingBody: 'BSI',
  },
  {
    code: 'HND-EEE',
    name: 'HND Electrical & Electronic Engineering',
    level: 'Level 4',
    awardingBody: 'Pearson',
  },
  {
    code: 'FGAS-CAT-I',
    name: 'F-Gas Category I Certification',
    level: 'Category I',
    awardingBody: 'BSI',
  },
];

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

/**
 * The `Qualification` catalogue, keyed on `code`.
 *
 * An upsert on the `@unique` natural key rather than a bare `create`, because the seed's
 * second property is idempotency and a certificate issue dialog is a thing a developer
 * opens after a `db:seed` that has already run once. The id is derived from the code
 * with `did`, so two developers on two machines get the same row id and a screenshot in
 * a bug report still refers to the same qualification.
 *
 * `createdAt` is written on create only — the `update` deliberately does NOT touch it,
 * so a re-seed leaves the original creation date alone. That is the whole difference
 * between an idempotent catalogue and one that rewrites its own history every run.
 */
async function seedQualifications() {
  const rows = [];
  for (const spec of QUALIFICATION_CATALOGUE) {
    const data = {
      name: spec.name,
      level: spec.level,
      awardingBody: spec.awardingBody,
    };
    rows.push(
      await prisma.qualification.upsert({
        where: { code: spec.code },
        create: {
          id: did('qualification', spec.code),
          code: spec.code,
          ...data,
          createdAt: at(-180),
        },
        update: data,
      }),
    );
  }
  logger.info('seed.qualifications', { count: rows.length });
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
      totpSecret: spec.totp ? encryptTotpSecret(spec.totp.secret, { deterministicIv: true }) : null,
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

type SeededOffering = { id: string; capacity: number; startDate: Date };
type SeededCourse = {
  id: string;
  code: string;
  slug: string;
  name: string;
  teacherId: string;
  offerings: SeededOffering[];
};

async function seedCourses(
  departmentIds: string[],
  teachers: SeededUser[],
): Promise<SeededCourse[]> {
  const courses: SeededCourse[] = [];
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
      syllabusUploadId: syllabus.id,
      publishedAt: at(-65 + index),
    };

    const course = await prisma.course.upsert({
      where: { code },
      create: { id: did('course', code), code, createdAt: at(-70 + index), ...data },
      update: data,
    });

    // Intakes. Every course gets the run it has always had; the demo course gets a
    // second, future one so "apply again for the spring cohort" is backed by a row.
    const offerings: SeededOffering[] = [];
    const intakes: Array<{ key: string; startDate: Date; endDate: Date }> = [
      { key: '1', startDate: at(-60 + index * 2), endDate: at(60 + index * 3) },
    ];
    if (index === TWO_INTAKE_COURSE_INDEX) {
      intakes.push({
        key: 'spring',
        startDate: at(SPRING_START_OFFSET),
        endDate: at(SPRING_START_OFFSET + 90),
      });
    }
    for (const intake of intakes) {
      const offeringData = {
        courseId: course.id,
        capacity,
        startDate: intake.startDate,
        endDate: intake.endDate,
      };
      const offering = await prisma.courseOffering.upsert({
        where: { id: did('offering', `${code}:${intake.key}`) },
        create: { id: did('offering', `${code}:${intake.key}`), ...offeringData },
        update: offeringData,
      });
      offerings.push({ id: offering.id, capacity, startDate: intake.startDate });
    }

    courses.push({
      id: course.id,
      code,
      slug: course.slug,
      name: course.name,
      teacherId: course.teacherId,
      offerings,
    });
  }
  logger.info('seed.courses', {
    count: courses.length,
    published: courses.length,
    offerings: courses.reduce((sum, course) => sum + course.offerings.length, 0),
  });
  return courses;
}

/**
 * A seat the chain can hang off: the enrolment row PLUS the names the certificate
 * banner and the award below need, resolved here rather than re-queried later.
 *
 * Returned rather than re-derived because the award has to point at a REAL row with a
 * real `@@unique([studentId, offeringId])` behind it. A certificate is issued against
 * an enrolment, never against a student — `issueCertificateSchema` names the seat for
 * exactly the reason in the shared schema's own comment — so anything this seed wrote
 * that did not come from one of these rows would be a certificate no route could have
 * produced.
 */
type CompletedSeat = {
  id: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  teacherId: string;
  offeringStartDate: Date;
  /** Filled by `demoAwardSeat`, which is the only caller of `seedAward`. */
  qualificationCode?: string;
};

async function seedEnrollments(
  courses: SeededCourse[],
  students: SeededUser[],
  admins: SeededUser[],
): Promise<CompletedSeat[]> {
  let total = 0;
  const completed: CompletedSeat[] = [];

  for (const [index, course] of courses.entries()) {
    // The running intake carries the plan this seed has always had; the future
    // spring intake of the two-intake course is just OPEN — a handful of PENDING
    // applications and no decisions yet, which is what "applications now open" means.
    const plansByOffering: Array<
      Record<'APPROVED' | 'PENDING' | 'REJECTED' | 'WITHDRAWN' | 'COMPLETED', number>
    > = course.offerings.map((_offering, offeringIndex) => {
      if (offeringIndex > 0 && index === TWO_INTAKE_COURSE_INDEX) {
        return { APPROVED: 0, PENDING: 3, REJECTED: 0, WITHDRAWN: 0, COMPLETED: 0 };
      }
      return index === NEARLY_FULL_COURSE_INDEX
        ? { APPROVED: 29, PENDING: 4, REJECTED: 1, WITHDRAWN: 1, COMPLETED: 0 }
        : {
            APPROVED: 6 + Math.floor(prngFor(`enrollment:${course.code}`)() * 8),
            PENDING: Math.floor(prngFor(`enrollment:${course.code}:p`)() * 5),
            REJECTED: Math.floor(prngFor(`enrollment:${course.code}:r`)() * 3),
            WITHDRAWN: Math.floor(prngFor(`enrollment:${course.code}:w`)() * 3),
            COMPLETED: Math.floor(prngFor(`enrollment:${course.code}:c`)() * 6),
          };
    });

    for (const [offeringIndex, offering] of course.offerings.entries()) {
      const plan = plansByOffering[offeringIndex]!;
      const cohort = shuffled(students, `cohort:${course.code}:${offeringIndex}`);
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
          /*
           * `completedAt` and `completedById`, and the same rule as `approvedCount`
           * below: this seed has always written COMPLETED seats, and until this it
           * wrote them with `completedAt` NULL. schema.prisma calls that column "the
           * ONLY thing that distinguishes a completed student from one merely
           * approved" — so those rows were claiming a completion with no date on it,
           * which is the exact defect a seed is supposed to make visible rather than
           * produce. A certificate is dated from the SEAT (`issuedAt` is the
           * registrar's date, not the completion's), so the demo read "awarded on
           * <nothing>" until this was fixed.
           *
           * The decider signs it, for the same reason they sign the decision: the
           * column is an attribution and an unattributed qualification is the thing
           * schema.prisma's `completedById` comment exists to prevent.
           */
          const isCompleted = status === 'COMPLETED';
          const data = {
            status,
            requestedAt: at(-50 + (cursor % 30)),
            decidedAt: decided ? at(-48 + (cursor % 30)) : null,
            decidedById: decided ? decider : null,
            completedAt: isCompleted ? at(-10 + (cursor % 30)) : null,
            completedById: isCompleted ? decider : null,
            decisionNote:
              status === 'REJECTED'
                ? 'Prerequisite not met: complete the Level 1 course first.'
                : status === 'WITHDRAWN'
                  ? 'Withdrawn at the student’s request.'
                  : null,
          };

          const row = await prisma.enrollment.upsert({
            where: { studentId_offeringId: { studentId: student.id, offeringId: offering.id } },
            create: {
              id: did('enrollment', `${course.code}:${offeringIndex}:${student.id}`),
              studentId: student.id,
              offeringId: offering.id,
              ...data,
            },
            update: data,
          });

          if (isCompleted) {
            completed.push({
              id: row.id,
              studentId: student.id,
              studentName: student.name,
              studentEmail: student.email,
              courseId: course.id,
              courseName: course.name,
              courseCode: course.code,
              teacherId: course.teacherId,
              offeringStartDate: offering.startDate,
            });
          }

          if (status === 'APPROVED') approved += 1;
          total += 1;
        }
      }

      // approvedCount is denormalised, so the seed must leave it truthful — a seed that
      // violates the invariant it is meant to demonstrate is worse than no seed.
      await prisma.courseOffering.update({
        where: { id: offering.id },
        data: { approvedCount: approved },
      });
    }
  }

  logger.info('seed.enrollments', { count: total, completed: completed.length });
  return completed;
}

/**
 * The register behind every COMPLETED seat.
 *
 * WHY COMPLETED SEATS AND NOT ALL OF THEM. The seed's own chain, written out on
 * `issueCertificateSchema` and in migration 0013, is
 *
 *     seat -> attend -> submit -> be assessed -> complete -> qualify -> verify
 *
 * and the arrow this step supplies is the one the seed had been skipping: a
 * COMPLETED enrolment with no `AttendanceRecord` under it asserts a completion nobody
 * can look at. It is the same class of defect as the `completedAt: null` this seed was
 * also writing, and it was invisible for the same reason — the row existed, the column
 * asserting it did not.
 *
 * It is scoped to COMPLETED seats because that is the only seat the chain runs on.
 * A PENDING applicant has not started and an APPROVED student is mid-course; giving
 * them registers would be inventing a timetable the course data does not describe, and
 * `CourseOffering.endDate` is `at(60 + index * 3)` — a course that has not finished.
 * Marking somebody PRESENT for a session that has not happened is the one thing a
 * register must never say.
 *
 * SESSIONS ARE WEEKLY FROM THE OFFERING'S OWN `startDate`, not from EPOCH, so the
 * register agrees with the intake it belongs to. `sessionDate` is `@db.Date` — a bare
 * calendar date — so each is pinned to UTC midnight rather than inheriting the hour
 * from the offering, which would make the same day compare unequal to itself.
 *
 * Upserted on `@@unique([enrollmentId, sessionDate])`, the same key the model calls
 * "the read path for per-enrollment history", so a re-run converges on the same rows.
 */
async function seedAttendance(seats: CompletedSeat[]) {
  const SESSIONS_PER_COURSE = 8;
  const STATUSES = [
    'PRESENT',
    'PRESENT',
    'PRESENT',
    'PRESENT',
    'PRESENT',
    'LATE',
    'ABSENT',
  ] as const;

  let count = 0;
  for (const seat of seats) {
    const rnd = prngFor(`attendance:${seat.courseCode}:${seat.id}`);
    for (let session = 0; session < SESSIONS_PER_COURSE; session += 1) {
      const status = pick(STATUSES, rnd);
      // `+ 7` is the weekly cadence; `setUTCHours(0,0,0,0)` is the `@db.Date` half.
      const sessionDate = new Date(seat.offeringStartDate.getTime() + session * 7 * DAY_MS);
      sessionDate.setUTCHours(0, 0, 0, 0);

      const data = {
        status,
        // The course's own teacher, because that is who the register belongs to and
        // `markedById` is an attribution rather than a formality.
        markedById: seat.teacherId,
        note:
          status === 'ABSENT'
            ? 'Notified; no reason given.'
            : status === 'LATE'
              ? 'Arrived after the practical had started.'
              : null,
      };

      await prisma.attendanceRecord.upsert({
        where: { enrollmentId_sessionDate: { enrollmentId: seat.id, sessionDate } },
        create: {
          id: did('attendance', `${seat.id}:${sessionDate.toISOString().slice(0, 10)}`),
          enrollmentId: seat.id,
          sessionDate,
          ...data,
        },
        update: data,
      });
      count += 1;
    }
  }

  logger.info('seed.attendance', { count, enrollments: seats.length });
}

/** The 32 symbols a person can transcribe off a printout. See shared/src/schema/certificate.ts. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A certificate reference for a SEEDED award, and the reason it is not a random one.
 *
 * `reference` is `@unique` and it is the whole security argument of
 * `GET /certificates/verify/:reference` (shared/src/schema/certificate.ts, and the
 * comment on `generateReference` in certificates.service.ts). Nothing about that
 * argument may be weakened here, so the SHAPE is reproduced exactly: 26 Crockford
 * base32 characters, last one masked to three bits, alphabet identical, and the same
 * bit-packing loop as the server's so a seeded reference is indistinguishable in form
 * from a minted one — which it must be, because the verify route validates it with
 * the same `referenceSchema` and a seeded row that failed that would be a certificate
 * the one unauthenticated route refuses to answer for.
 *
 * WHAT IS DELIBERATELY NOT REPRODUCED IS THE ENTROPY SOURCE: the bytes come from
 * `prngFor`, not `randomBytes`. This seed is DETERMINISTIC and IDEMPOTENT by
 * construction, and `reference` being unique is precisely what makes a random value
 * fatal here — an upsert keyed on it would find nothing on the second run and INSERT
 * A SECOND AWARD, so `pnpm db:seed` would quietly double every certificate in the demo
 * every time anybody ran it. A stable value keyed on the seat is the only thing an
 * idempotent seed can write into a unique column it has to look the row up by.
 *
 * A reader who wants to know whether a seeded reference is safe to paste into a
 * verifier should know the answer up front: it is not, and it does not need to be. It
 * is development data in a development database, its whole value is that a screenshot
 * in a bug report refers to the same row on the reader's machine, and no production
 * path can ever reach this function.
 */
export function seededReference(key: string): string {
  const rnd = prngFor(`reference:${key}`);
  const bytes = Array.from({ length: 16 }, () => Math.floor(rnd() * 256));

  let out = '';
  let bitBuffer = 0;
  let bitsHeld = 0;
  let index = 0;
  for (let produced = 0; produced < 26; produced += 1) {
    while (bitsHeld < 5) {
      // The 17th read is past the end of the array and coerces to zero, which is
      // exactly what makes the final character carry three real bits rather than
      // five. `generateReference` does the same arithmetic; the mask below is what
      // makes the two agree.
      bitBuffer = (bitBuffer << 8) | (bytes[index] ?? 0);
      bitsHeld += 8;
      index += 1;
    }
    const value = (bitBuffer >> (bitsHeld - 5)) & 0b11111;
    bitsHeld -= 5;
    out += produced === 25 ? CROCKFORD[value & 0b111] : CROCKFORD[value];
  }
  return out;
}

/**
 * ONE pre-awarded certificate, hanging off a real COMPLETED seat.
 *
 * Six qualifications are seeded (see `seedQualifications`) and no award was, so the
 * catalogue existed and nothing had ever been issued against it: `GET /certificates`
 * was empty, the holder's Qualifications tab was empty, and the one unauthenticated
 * route in the system — `GET /certificates/verify/:reference` — had no row to answer
 * for. The feature could be demonstrated only by driving the issue dialog, which is a
 * UI test wearing a seed's clothes.
 *
 * The chain is seeded END TO END rather than the award alone, because the award is the
 * only row in it that is not already here: the seat was seeded (COMPLETED, with a
 * `completedAt` as of this change), the register behind it is `seedAttendance`, and
 * what this adds is the last arrow. A certificate with no register behind its seat is
 * the same unbacked claim in a different table.
 *
 * ONE award, not one per catalogue entry, and deliberately: the catalogue is six rows
 * so the ISSUE DIALOG has something to offer, while a demo award is one person's
 * record. Seeding six would put a certificate on accounts that never sat the course
 * those standards belong to — CSWIP 3.1 is a welding-inspector standard and handing it
 * to whoever happened to be first in the array would make the demo data a lie in the
 * one place it is most checked.
 *
 * NO `artifactUploadId`, and the reason is worth stating because the alternative looks
 * like completeness. The issue route renders a PDF and pushes it through the presign ->
 * PUT -> commit path, so a real certificate's artefact is an object in the bucket; the
 * seed has no object-store client and inventing a plausible `Upload` row would produce
 * a COMMITTED upload pointing at a key no object exists behind — a Download button that
 * mints a valid presigned URL and then 404s, which is worse than no button because it
 * looks like the feature working. The null case is a STATE THIS PRODUCT ALREADY RENDERS
 * HONESTLY: `certificateSchema.artifact` is nullable, `downloadUrlFor` answers 409 for
 * it, and the SPA says "The document for this certificate is not available. The
 * qualification is still recorded." — the exact truth about this row.
 */
async function seedAward(seat: CompletedSeat) {
  const qualificationCode = seat.qualificationCode;
  if (!qualificationCode) {
    throw new Error('seed.awards: no qualification chosen for this seat; see demoAwardSeat.');
  }
  const qualification = await prisma.qualification.findFirstOrThrow({
    where: { code: qualificationCode },
    select: { id: true, code: true, name: true, awardingBody: true },
  });

  const reference = seededReference(`${seat.id}:${qualification.id}`);
  const issuedAt = at(-5);

  const data = {
    studentId: seat.studentId,
    qualificationId: qualification.id,
    enrollmentId: seat.id,
    issuedById: seat.teacherId,
    reference,
    issuedAt,
    // Null, and never populated: see the note on the function. Stated here as an
    // explicit `undefined` rather than left to the column default so that adding an
    // `@default` to the model later cannot silently start writing one.
    artifactUploadId: null,
  };

  const row = await prisma.studentQualification.upsert({
    where: { reference },
    create: { id: did('award', reference), ...data },
    update: data,
  });

  logger.info('seed.awards', { count: 1, reference, code: qualification.code });
  return {
    ...row,
    qualificationName: qualification.name,
    awardingBody: qualification.awardingBody,
    // Carried for the banner only. The award's holder and its course are facts the
    // banner states and nothing reads, but they are read by whoever runs the seed.
    studentName: seat.studentName,
    studentEmail: seat.studentEmail,
    courseName: seat.courseName,
  };
}

/**
 * The standard a seat in a given DEPARTMENT can plausibly lead to, and nothing wider.
 *
 * The award could have been handed the first entry of the catalogue and nobody would
 * have checked — but CSWIP 3.1 is a welding-inspector standard, and putting it on a
 * student who sat an electrical course makes the demo data wrong in the one place it
 * is most likely to be looked at seriously. The table is one line per department, which
 * is the whole cost of not doing that.
 *
 * A department with no entry THROWS rather than defaulting. There are six departments
 * and six qualifications, so a missing entry means somebody added a department and did
 * not decide what its students can be awarded — a decision that belongs to whoever made
 * that change, loudly, and not to a `?? 'C&G-L3-DIP'` at three in the morning.
 */
const AWARD_BY_DEPARTMENT_PREFIX: Record<string, string> = {
  WELD: 'CSWIP-3-1',
  AUTO: 'C&G-L3-DIP',
  ELEC: 'HND-EEE',
  HVAC: 'FGAS-CAT-I',
  CNC: 'NVQ-L4-ENG-MAINT',
  PLMB: 'C&G-L3-DIP',
};

/**
 * Which completed seat carries the demo award.
 *
 * THE DEMO STUDENT'S OWN, so the account printed at the top of the banner is the
 * account whose Qualifications tab is not empty the moment somebody signs in — the
 * whole reason a demo row exists is that it is one click from the login card.
 *
 * `?? completed[0]` is a fallback for a catalogue change that leaves the demo student
 * without a completed seat, and it is here so that change degrades the DEMO rather
 * than failing `db:seed` outright. It is not silent: the banner names the holder's
 * email, so a fallback is visible in the output of the run that caused it.
 */
function demoAwardSeat(completed: CompletedSeat[], demoStudent: SeededUser): CompletedSeat {
  const seat = completed.find((row) => row.studentId === demoStudent.id) ?? completed[0];
  if (!seat) {
    throw new Error(
      'seed.awards: no COMPLETED enrolment to award a certificate against. The demo award ' +
        'hangs off a real seat because that is what the issue route requires, and a ' +
        'certificate with no seat is a row nothing in this system can produce.',
    );
  }
  const prefix = seat.courseCode.split('-')[0]!;
  const code = AWARD_BY_DEPARTMENT_PREFIX[prefix];
  if (!code) {
    throw new Error(
      `seed.awards: no awardable qualification is mapped to department "${prefix}" ` +
        '(see AWARD_BY_DEPARTMENT_PREFIX).',
    );
  }
  return { ...seat, qualificationCode: code };
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

  /**
   * `notificationPayloadSchema` requires `title` and `body` — they are the only two keys
   * the SPA renders, and the payload is denormalised on write precisely so that rendering
   * never joins to a row that may since have been soft-deleted.
   *
   * This seed used to write only the context keys, so every seeded row failed the
   * response schema's `safeParse` and served `{title: '', body: ''}`: 147 notifications
   * that existed, counted, and rendered blank.
   */
  const copyFor = (
    type: (typeof STUDENT_TYPES)[number] | 'ENROLLMENT_REQUESTED',
    courseName: string,
  ): { title: string; body: string } => {
    switch (type) {
      case 'ENROLLMENT_APPROVED':
        return { title: 'Enrolment approved', body: `You have a seat on ${courseName}.` };
      case 'ENROLLMENT_REJECTED':
        return {
          title: 'Enrolment declined',
          body: `Your request for ${courseName} was not approved.`,
        };
      case 'RESOURCE_PUBLISHED':
        return { title: 'New resource', body: `Material was added to ${courseName}.` };
      case 'ANNOUNCEMENT_PUBLISHED':
        return { title: 'New announcement', body: `Your teacher posted in ${courseName}.` };
      case 'MESSAGE_RECEIVED':
        return { title: 'New message', body: `You have an unread message about ${courseName}.` };
      case 'COMMENT_REPLIED':
        return { title: 'New reply', body: `Someone replied to your comment in ${courseName}.` };
      case 'ENROLLMENT_REQUESTED':
        return {
          title: 'Enrolment requests waiting',
          body: `3 students applied to ${courseName}.`,
        };
    }
  };

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
        payload: { ...copyFor(type, course.name), courseSlug: course.slug },
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
      payload: { ...copyFor('ENROLLMENT_REQUESTED', course.name), courseSlug: course.slug },
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

  // The award catalogue. Seeded before users because it depends on nothing and a
  // certificate cannot be issued without it — the demo's "issue a certificate" path
  // starts at a COMPLETED seat and a `qualificationId`, and this step is what supplies
  // the second of those two.
  const qualifications = await seedQualifications();

  const { teachers, students, admins } = await seedUsers(departmentIds);
  const courses = await seedCourses(departmentIds, teachers);
  const completedSeats = await seedEnrollments(courses, students, admins);

  // The register behind every completed seat, before the award that depends on it —
  // the same order the chain runs in, so a reader can follow it top to bottom.
  await seedAttendance(completedSeats);

  const demoStudent = students[0]!;
  const award = await seedAward(demoAwardSeat(completedSeats, demoStudent));

  const resources = await seedResources(courses);
  const announcements = await seedAnnouncements([...admins, ...teachers.slice(0, 4)]);
  await seedComments(resources, announcements, [...students.slice(0, 30), ...teachers, ...admins]);
  await seedConversations(teachers, students, admins);
  await seedNotifications(students, teachers, courses);

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
      `${COURSE_CATALOGUE[TWO_INTAKE_COURSE_INDEX]!.name}`,
      `  has TWO intakes: one running now, one starting in ${SPRING_START_OFFSET} days —`,
      '  the spring cohort "applications now open" points at.',
      null,
      'AWARD CATALOGUE — what a certificate can be issued against:',
      ...qualifications.map((q) => `  ${q.code}  ${q.name}  (${q.awardingBody})`),
      '  a COMPLETED seat + any of these is the demo path to a certificate.',
      null,
      'ONE AWARD IS ALREADY ISSUED, so the chain is visible before you click anything:',
      `  ${award.qualificationName}  (${award.awardingBody})`,
      `  holder   ${award.studentName}  <${award.studentEmail}>`,
      `  from     ${award.courseName} — a COMPLETED seat with a register behind it`,
      `  verify   GET /api/v1/certificates/verify/${award.reference}`,
      '  its PDF is NOT seeded: the document is rendered at issue time, so the holder',
      '  sees the honest "not available" line rather than a download that 404s.',
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
