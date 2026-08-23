import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import type { CourseDetail } from '@/lib/types';
import { api } from '@/lib/api';
import { subject, usePolicy } from '@/lib/policy';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

export interface CoursePublishButtonProps {
  /** The facts `course:publish` reads: whose course it is, and whether it is live. */
  course: {
    id: string;
    publishedAt: string | null;
    teacherId: string;
  };
}

/**
 * Publish/unpublish as its OWN affordance, never folded into edit: `course:publish`
 * is a distinct action with its own policy row (`ownsCourse` for TEACHER, bare
 * allow for ADMIN), so it gets its own gate and its own button.
 *
 * The body is ALWAYS sent explicitly — `{ published: boolean }` — even though the
 * route now tolerates an absent one. An absent body would make the verb's meaning
 * depend on which client sent it; this control states its intent every time.
 *
 * Unpublish asks no confirmation because it is reversible by construction — the
 * same button brings the course straight back.
 */
export function CoursePublishButton({ course }: CoursePublishButtonProps) {
  const policy = usePolicy();
  const client = useQueryClient();

  // Asked WITH the subject the rule reads — `ownsCourse` matches on
  // `Subject.courseTeacherId`, so a subject-free call here would deny the one
  // teacher this button exists for (LESSONS-LEARNED #15).
  const allowed = policy.can('course:publish', subject({ courseTeacherId: course.teacherId }));

  const isPublished = course.publishedAt !== null;

  // Hooks stay above any early return — the gate decides RENDERING, not whether
  // this component's hooks run.
  const publish = useMutation({
    mutationFn: () =>
      api.post<CourseDetail>(`/courses/${course.id}/publish`, { published: !isPublished }),
    onSuccess: async (updated) => {
      toast.success(updated.publishedAt ? 'Course published' : 'Course unpublished', {
        description: updated.publishedAt
          ? 'It is now listed in the catalogue.'
          : 'It no longer appears in the public catalogue.',
      });
      await client.invalidateQueries({ queryKey: ['courses'] });
    },
    onError: () =>
      toast.fromError(
        null,
        isPublished ? 'Could not unpublish that course' : 'Could not publish that course',
      ),
  });

  // Nothing permitted means no button at all — an always-disabled control advertises
  // a capability the user does not have (the argument Gate.tsx makes).
  if (!allowed) return null;

  return (
    <Button variant="ghost" size="sm" loading={publish.isPending} onClick={() => publish.mutate()}>
      {isPublished ? (
        <EyeOff aria-hidden="true" className="size-4" />
      ) : (
        <Eye aria-hidden="true" className="size-4" />
      )}
      {isPublished ? 'Unpublish' : 'Publish'}
    </Button>
  );
}
