/**
 * Deterministic fallback avatar for a user.
 *
 * `User` has no avatar URL column by design: an avatar is either an uploaded object
 * (`User.avatarUpload`) or it is derived from the user's id. Deriving it costs no storage,
 * never 404s, and means a seeded account is never a grey silhouette.
 *
 * It lives in the data package rather than in the web app because the API embeds it in
 * notification payloads and message previews too. Two implementations of "which avatar"
 * would eventually disagree, and a face that changes between the list and the detail view
 * reads as a bug even when the data is correct.
 */
export function avatarUrlFor(userId: string): string {
  const params = new URLSearchParams({
    seed: userId,
    backgroundColor: 'b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf',
    backgroundType: 'gradientLinear',
    radius: '50',
  });
  return `https://api.dicebear.com/9.x/notionists/svg?${params.toString()}`;
}
