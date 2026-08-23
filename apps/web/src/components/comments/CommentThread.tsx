import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
/*
 * `createCommentSchema` / `updateCommentSchema` are wire-body VALUES, not DTOs a
 * screen renders — per the note atop `@/lib/types`, they come straight from this
 * specifier rather than through that re-export barrel. They are used here only to
 * mirror the server's own `min(1).max(5000)` client-side, on the same reasoning
 * `RejectDialog` in CourseDetail.tsx applies to `rejectEnrollmentSchema`: a button
 * that would 422 is disabled instead of sent.
 */
import { createCommentSchema, updateCommentSchema } from '@skillwright/shared/schema';
import { api, type Paginated } from '@/lib/api';
import { usePolicy } from '@/lib/policy';
import { formatRelative } from '@/lib/format';
import type { CommentDto } from '@/lib/types';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';

/**
 * A comment attaches to exactly one parent — the CHECK `createCommentSchema`
 * mirrors (comment.ts:29-42) — so the props are the same union rather than two
 * optional fields either of which could be left unset by mistake.
 */
export type CommentThreadProps =
  | { resourceId: string; announcementId?: undefined }
  | { announcementId: string; resourceId?: undefined };

type CommentTarget = { resourceId: string } | { announcementId: string };

function targetOf(props: CommentThreadProps): CommentTarget {
  return props.resourceId !== undefined
    ? { resourceId: props.resourceId }
    : { announcementId: props.announcementId };
}

/**
 * `qk` (`@/lib/query`) has no `comments` entry, and this file does not own that
 * module — the same position Messages.tsx's `Thread` records for `qk.conversations`
 * needing a page it did not have. The key is built locally instead: TanStack Query
 * matches `invalidateQueries` by PREFIX, so invalidating `['comments', target]`
 * also reaches every `['comments', target, parentId]` reply list below it, which is
 * exactly the "one mutation, every affected list" behaviour `qk`'s own keys give
 * the rest of the app.
 */
function threadKey(target: CommentTarget): QueryKey {
  return ['comments', target];
}

function listComments(target: CommentTarget, parentId?: string): Promise<Paginated<CommentDto>> {
  // Oldest first: a discussion reads top-to-bottom, unlike `paginationQuerySchema`'s
  // `order: 'desc'` default (pagination.ts:16), which suits a list of rows sorted by
  // recency rather than a thread meant to be read in the order it was written.
  return api.get<Paginated<CommentDto>>('/comments', {
    query: { ...target, parentId, limit: 100, order: 'asc' },
  });
}

/**
 * The comment thread for one resource or one announcement — top-level comments,
 * each with its replies and a reply box, one level deep. It owns every query and
 * mutation against `/comments`; nothing about a comment is read or written outside
 * this file.
 *
 * `comment:read` and `comment:create` are FLAT per-role rows — `anonymous: deny`,
 * every signed-in role `allow` (policy.ts:290-302) — and no rule in either reads a
 * Subject field. `policy.can()` with no subject is therefore the CORRECT call here,
 * not the anti-pattern LESSONS-LEARNED #15 warns a LIST against: that warning is
 * about a rule which DOES read a subject (`isPublic`, `enrollmentStatus`, …) being
 * asked with none. Neither rule below does.
 */
export function CommentThread(props: CommentThreadProps) {
  const target = targetOf(props);
  const policy = usePolicy();
  const client = useQueryClient();
  const queryKey = threadKey(target);

  const canRead = policy.can('comment:read');
  const canCreate = policy.can('comment:create');

  const topLevel = useQuery({
    queryKey,
    queryFn: () => listComments(target),
    enabled: canRead,
  });

  const [draft, setDraft] = useState('');
  const isValid = createCommentSchema.safeParse({ ...target, content: draft }).success;

  const post = useMutation({
    mutationFn: (content: string) => api.post<CommentDto>('/comments', { ...target, content }),
    onSuccess: async () => {
      setDraft('');
      await client.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.fromError(error, 'Could not post that comment'),
  });

  // Anonymous is the one caller `comment:read` denies outright (policy.ts:290-296) —
  // never part of the logged-out surface even on a published resource — so the
  // query above stays `enabled: false` for them and this says why, rather than
  // leaving the panel blank.
  if (!canRead) {
    return (
      <EmptyState
        variant="empty"
        compact
        title="Sign in to see comments"
        description="Comments are visible to signed-in students, teachers and admins."
      />
    );
  }

  const rows = topLevel.data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      {canCreate ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isValid || post.isPending) return;
            post.mutate(draft.trim());
          }}
        >
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            autoResize
            aria-label="Write a comment"
            placeholder="Share your thoughts…"
          />
          <Button
            type="submit"
            size="sm"
            className="self-end"
            loading={post.isPending}
            disabled={!isValid}
          >
            Post comment
          </Button>
        </form>
      ) : null}

      {topLevel.isPending ? (
        <SkeletonList rows={2} />
      ) : rows.length === 0 ? (
        <EmptyState
          variant="empty"
          compact
          title="No comments yet"
          description="Be the first to say something about this."
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((comment) => (
            <li key={comment.id}>
              <CommentRow comment={comment} target={target} threadKey={queryKey} nested={false} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * One comment — top-level or a reply, `nested` tells which. `nested` rows render
 * no Reply control and fetch no replies of their own: the schema's `parentId` does
 * not itself limit depth, so refusing to offer the affordance is what keeps the
 * thread one level deep rather than something the data happens not to contain yet.
 *
 * Which controls render is read straight off the DTO — `comment.canEdit` /
 * `comment.canDelete` — computed server-side against `comment:update` /
 * `comment:delete`, never re-derived here: `comment:delete` for a TEACHER is
 * `or(isAuthor, ownsCourse)` (policy.ts:311-317), and `ownsCourse` needs the
 * comment's COURSE, which this DTO does not carry at all — only `resourceId` /
 * `announcementId`. There is no subject this component could build that rule from.
 */
function CommentRow({
  comment,
  target,
  threadKey,
  nested,
}: {
  comment: CommentDto;
  target: CommentTarget;
  threadKey: QueryKey;
  nested: boolean;
}) {
  const policy = usePolicy();
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: threadKey });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [replying, setReplying] = useState(false);

  const isValidEdit = updateCommentSchema.safeParse({ content: draft }).success;

  const save = useMutation({
    mutationFn: () => api.patch<CommentDto>(`/comments/${comment.id}`, { content: draft.trim() }),
    onSuccess: async () => {
      setEditing(false);
      await invalidate();
    },
    onError: (error) => toast.fromError(error, 'Could not save that edit'),
  });

  const remove = useMutation({
    mutationFn: () => api.del<void>(`/comments/${comment.id}`),
    onSuccess: async () => {
      setConfirmDelete(false);
      await invalidate();
    },
    onError: (error) => toast.fromError(error, 'Could not delete that comment'),
  });

  // A reply is never itself replied to (`nested` rows get no control for it), and
  // for a top-level row `comment:create` is the same flat, subject-free check the
  // thread's own composer used above.
  const canReply = !nested && policy.can('comment:create');

  return (
    <div className="flex gap-3">
      <Avatar name={comment.author.name} src={comment.author.avatarUrl} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium text-fg">{comment.author.name}</span>
          <span className="text-2xs text-fg-tertiary">
            {formatRelative(comment.createdAt)}
            {comment.editedAt ? ' · edited' : ''}
          </span>
        </div>

        {editing ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!isValidEdit || save.isPending) return;
              save.mutate();
            }}
          >
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoResize
              aria-label="Edit your comment"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setDraft(comment.content);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" loading={save.isPending} disabled={!isValidEdit}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm break-words whitespace-pre-wrap text-fg-secondary">
            {comment.content}
          </p>
        )}

        {!editing ? (
          <div className="flex items-center gap-1 pt-0.5">
            {canReply ? (
              <Button variant="ghost" size="sm" onClick={() => setReplying((value) => !value)}>
                Reply
              </Button>
            ) : null}
            {comment.canEdit ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {comment.canDelete ? (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}

        {replying ? (
          <ReplyComposer
            authorName={comment.author.name}
            target={target}
            parentId={comment.id}
            threadKey={threadKey}
            onDone={() => setReplying(false)}
          />
        ) : null}

        {!nested && comment.replyCount > 0 ? (
          <RepliesList target={target} parentId={comment.id} threadKey={threadKey} />
        ) : null}
      </div>

      <DeleteCommentDialog
        open={confirmDelete}
        pending={remove.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

/** The replies under ONE top-level comment — its own query, keyed under the thread's. */
function RepliesList({
  target,
  parentId,
  threadKey,
}: {
  target: CommentTarget;
  parentId: string;
  threadKey: QueryKey;
}) {
  const replies = useQuery({
    // Nested under `threadKey` rather than a sibling of it, so invalidating the
    // thread's own key (every mutation in this file does) reaches this one too —
    // TanStack's prefix match on `['comments', target]` covers
    // `['comments', target, parentId]` for any `parentId`.
    queryKey: [...threadKey, parentId],
    queryFn: () => listComments(target, parentId),
  });

  if (replies.isPending) {
    return (
      <div className="pt-1 ps-4">
        <Spinner size="sm" label="Loading replies" />
      </div>
    );
  }

  const rows = replies.data?.data ?? [];
  if (rows.length === 0) return null;

  return (
    <ul className="flex flex-col gap-3 border-s border-line-subtle ps-4 pt-2">
      {rows.map((reply) => (
        <li key={reply.id}>
          <CommentRow comment={reply} target={target} threadKey={threadKey} nested />
        </li>
      ))}
    </ul>
  );
}

function ReplyComposer({
  authorName,
  target,
  parentId,
  threadKey,
  onDone,
}: {
  authorName: string;
  target: CommentTarget;
  parentId: string;
  threadKey: QueryKey;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [content, setContent] = useState('');
  const isValid = createCommentSchema.safeParse({ ...target, parentId, content }).success;

  const post = useMutation({
    mutationFn: () =>
      api.post<CommentDto>('/comments', { ...target, parentId, content: content.trim() }),
    onSuccess: async () => {
      setContent('');
      onDone();
      await client.invalidateQueries({ queryKey: threadKey });
    },
    onError: (error) => toast.fromError(error, 'Could not post that reply'),
  });

  return (
    <form
      className="flex flex-col gap-2 pt-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isValid || post.isPending) return;
        post.mutate();
      }}
    >
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        autoResize
        aria-label={`Reply to ${authorName}`}
        placeholder="Write a reply…"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={post.isPending} disabled={!isValid}>
          Reply
        </Button>
      </div>
    </form>
  );
}

/**
 * Soft confirmation only — this component has no visibility into what the
 * `/comments` service actually does on delete (it does not exist yet; this page
 * does not own it), so the copy promises no more than "it stops being shown",
 * which is true under either a hard or a soft delete.
 */
function DeleteCommentDialog({
  open,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        title="Delete this comment?"
        footer={
          <>
            <Button variant="ghost" block className="sm:w-auto" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="danger"
              block
              className="sm:w-auto"
              loading={pending}
              onClick={onConfirm}
            >
              Delete comment
            </Button>
          </>
        }
      >
        <p className="text-fg-secondary">It will no longer be shown in this discussion.</p>
      </DialogContent>
    </Dialog>
  );
}
