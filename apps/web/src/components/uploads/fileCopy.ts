/**
 * Human names for the MIME types `UPLOAD_LIMITS` accepts, and the sentence built
 * from them.
 *
 * Extracted from ResourceFormDialog when the course form needed the same copy for
 * the SYLLABUS purpose: two dialogs restating a twenty-entry map is two copies that
 * drift, and the drift would read as "PDF, Word, …" on one picker and a raw
 * `application/vnd…` string on another.
 *
 * Deliberately a `Record<string, string>` with a fallback rather than a closed map
 * over the accepted list: a MIME type added to the shared schema and not added here
 * then shows up as its raw string — visible and slightly ugly, which is the right
 * failure. A closed map would make widening the server's accepted set a compile error
 * in this file, and an object literal used as a whitelist is not a whitelist anyway
 * (LESSONS-LEARNED #29).
 */
export const MIME_LABEL: Readonly<Record<string, string>> = {
  'application/pdf': 'PDF',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-powerpoint': 'PowerPoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'text/plain': 'plain text',
  'text/markdown': 'Markdown',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/avif': 'AVIF',
  'video/mp4': 'MP4',
  'video/webm': 'WebM',
  'video/quicktime': 'QuickTime',
};

/** "PDF, Word, Excel, …" — one label per family, in the order the schema lists them. */
export function acceptedTypesSentence(mimeTypes: readonly string[]): string {
  const labels: string[] = [];
  for (const mime of mimeTypes) {
    const label = MIME_LABEL[mime] ?? mime;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.join(', ');
}
