/**
 * The ONLY place the product name is spelled.
 *
 * Rebranding a codebase is normally an archaeology exercise because the name is
 * baked into page titles, email footers, storage prefixes and seed data. Here it
 * is one object; `pnpm check:brand` fails the build if a literal "Skillwright"
 * appears anywhere outside this file.
 */
export const BRAND = {
  name: 'Skillwright',
  tagline: 'Where skills are made.',
  domain: 'skillwright.dev',
  supportEmail: 'support@skillwright.dev',
  emailFrom: 'Skillwright <no-reply@skillwright.dev>',
  /**
   * Object-store key prefix. Every upload key is `${assetFolder}/${entity}/${ulid}${ext}`,
   * so a bucket can host more than one deployment without collision.
   */
  assetFolder: 'skillwright',
  copyrightHolder: 'Skillwright',
  repoUrl: 'https://github.com/kaleem-Durrani/skillwright',
} as const;

export type Brand = typeof BRAND;
