import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { BRAND } from '@skillwright/shared/brand';
import { api } from '@/lib/api';
import { splitHeadline } from '@/lib/headline';
import { qk } from '@/lib/query';
import type {
  AnnouncementHit,
  CourseHit,
  ResourceHit,
  SearchGroup,
  SearchResult,
} from '@/lib/types';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SkeletonList } from '@/components/ui/Skeleton';
import { Route } from '@/routes/_app/search';

/*
 * Type labels, local for the same reason Announcements.tsx keeps its own: these
 * describe WHAT a thing is, not a state it moves through, so they do not belong
 * in StatusChip — and three short maps beat importing them out of form dialogs
 * the search page has no other business with.
 */
const RESOURCE_TYPE_LABEL: Record<ResourceHit['type'], string> = {
  DOCUMENT: 'Document',
  VIDEO: 'Video',
  LINK: 'Link',
};

const ANNOUNCEMENT_TYPE_LABEL: Record<AnnouncementHit['type'], string> = {
  NEWS: 'News',
  EVENT: 'Event',
  ANNOUNCEMENT: 'Announcement',
};

/**
 * Same ceiling as the API's own `searchQuerySchema`. Sending more would be a 422
 * the user cannot see past, so the input refuses it at the keystroke instead.
 */
const MAX_QUERY_LENGTH = 120;

/**
 * One highlighted fragment. `ts_headline` output is USER CONTENT carrying `<b>`
 * markers, so it goes through lib/headline.ts and renders as ordinary children —
 * never `dangerouslySetInnerHTML`, which would execute whatever a description
 * once contained.
 */
function Headline({ text }: { text: string }) {
  const segments = splitHeadline(text);
  if (segments.length === 0) return null;
  return (
    <p className="line-clamp-2 text-xs text-fg-secondary">
      {segments.map((segment, index) =>
        segment.marked ? (
          <mark key={index} className="rounded-xs bg-brand-soft px-0.5 text-brand-on-soft">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

/** `12` while every match fits, `Best 5 of 12` once the per-group cap bites. */
function totalLabel(total: number, shown: number): string {
  if (total <= shown) return `${total} ${total === 1 ? 'match' : 'matches'}`;
  return `Best ${shown} of ${total}`;
}

interface HitLike {
  id: string;
  linkPath: string;
}

interface SearchSectionProps<T extends HitLike> {
  /** Id prefix, so the section heading and its `aria-labelledby` stay paired. */
  id: string;
  heading: string;
  group: SearchGroup<T>;
  /**
   * The entity's full filtered list, when one exists — resources have no global
   * list page (their home is the owning course), so their section offers none.
   */
  seeAllHref?: string;
  onOpenHref: (path: string) => void;
  renderHit: (hit: T) => ReactNode;
}

/**
 * One grouped result set. The whole hit is ONE anchor carrying the server-built
 * `linkPath`: native link semantics keep middle-click, copy-address and keyboard
 * activation working, and `href` drives `navigate({ href })` after preventDefault
 * exactly as NotificationBell's rows do — it is a server-built path, not one of
 * the router's literals.
 */
function SearchSection<T extends HitLike>({
  id,
  heading,
  group,
  seeAllHref,
  onOpenHref,
  renderHit,
}: SearchSectionProps<T>) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="font-display text-lg font-semibold">
          {heading}
        </h2>
        <p className="shrink-0 text-xs tabular-nums text-fg-tertiary">
          {totalLabel(group.total, group.hits.length)}
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {group.hits.map((hit) => (
          <li
            key={hit.id}
            className="rounded-[var(--card-radius)] border border-[var(--card-border)] bg-[var(--card-bg)]"
          >
            <a
              href={hit.linkPath}
              onClick={(event) => {
                event.preventDefault();
                onOpenHref(hit.linkPath);
              }}
              className="flex flex-col gap-1 rounded-[var(--card-radius)] p-3 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-line-focus"
            >
              {renderHit(hit)}
            </a>
          </li>
        ))}
      </ul>

      {seeAllHref && group.total > group.hits.length ? (
        <a
          href={seeAllHref}
          onClick={(event) => {
            event.preventDefault();
            onOpenHref(seeAllHref);
          }}
          className="text-sm text-fg-link underline underline-offset-4 outline-none hover:decoration-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-focus"
        >
          See all {group.total} matches
        </a>
      ) : null}
    </section>
  );
}

/**
 * The cross-entity results page behind the shell's search affordance — "the page
 * is the product": the shell only collects a term, this screen does the rest.
 *
 * No policy gate anywhere, deliberately (LESSONS-LEARNED #15/#31): the server
 * scopes every group through its own module's visibility mirror, anonymous
 * callers included, so the UI asks nothing and hides nothing — the route is
 * session-gated by the `_app` layout and that is the whole gate.
 */
export function SearchResultsPage() {
  const search = Route.useSearch();
  /*
   * Two bindings, two jobs — the same split Notifications.tsx makes: the typed
   * one updates THIS route's `q`; the untyped one follows the hits'
   * server-built `linkPath`s to whatever route they name.
   */
  const navigate = useNavigate({ from: Route.fullPath });
  const navigateByHref = useNavigate();

  // Local mirror of the URL query so typing does not push a history entry per
  // keystroke; the URL is updated on a debounce below (Courses.tsx's pattern).
  const [term, setTerm] = useState(search.q ?? '');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((search.q ?? '') === term) return;
      void navigate({
        search: (previous) => ({ ...previous, q: term || undefined }),
        replace: true,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [term, search.q, navigate]);

  /*
   * The endpoint rejects an empty term outright and a whitespace-only one after
   * ITS OWN trim (searchQuerySchema), so the request waits for a trimmed
   * character. An absent or blank q fires nothing and shows the start state.
   */
  const hasQuery = Boolean(search.q && search.q.trim());

  const results = useQuery({
    queryKey: qk.search({ q: search.q }),
    queryFn: () => api.get<SearchResult>('/search', { query: { q: search.q } }),
    enabled: hasQuery,
    // Keeps the previous term's groups on screen while the next ones load, same
    // as Courses.tsx — retyping must not collapse the page to a skeleton.
    placeholderData: (previous) => previous,
  });

  function clearSearch() {
    setTerm('');
    void navigate({ search: {} });
  }

  const data = results.data;
  const grandTotal = data
    ? data.courses.total + data.resources.total + data.announcements.total
    : 0;
  const encodedQ = encodeURIComponent(search.q ?? '');

  let body: ReactNode;
  if (!hasQuery) {
    body = (
      <EmptyState
        variant="empty"
        title={`Search ${BRAND.name}`}
        description="Look across courses, resources and announcements. You are only ever shown what you are entitled to see."
      />
    );
  } else if (results.isPending && !data) {
    body = <SkeletonList rows={6} />;
  } else if (results.isError) {
    body = (
      <EmptyState
        variant="error"
        title="Search did not load"
        description="Nothing you did caused this."
        actionLabel="Try again"
        onAction={() => void results.refetch()}
      />
    );
  } else if (data && grandTotal === 0) {
    body = (
      <EmptyState
        variant="no-results"
        title="No matches"
        description={`Nothing matched “${search.q}”. Try fewer words, a different spelling, or a course code like WELD-2.`}
        actionLabel="Clear search"
        onAction={clearSearch}
      />
    );
  } else if (data) {
    body = (
      <div className="flex flex-col gap-8">
        <p aria-live="polite" className="sr-only">
          {grandTotal} {grandTotal === 1 ? 'result' : 'results'}
        </p>

        <SearchSection<CourseHit>
          id="courses"
          heading="Courses"
          group={data.courses}
          seeAllHref={`/courses?q=${encodedQ}`}
          onOpenHref={(path) => void navigateByHref({ href: path })}
          renderHit={(course) => (
            <>
              <span className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-fg">{course.name}</span>
                <span className="shrink-0 font-mono text-2xs text-fg-tertiary">{course.code}</span>
              </span>
              <Headline text={course.headline} />
            </>
          )}
        />

        <SearchSection<ResourceHit>
          id="resources"
          heading="Resources"
          group={data.resources}
          onOpenHref={(path) => void navigateByHref({ href: path })}
          renderHit={(resource) => (
            <>
              <span className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-fg">
                  {resource.title}
                </span>
                <span className="shrink-0 text-2xs text-fg-tertiary">
                  {RESOURCE_TYPE_LABEL[resource.type]}
                </span>
              </span>
              <span className="text-2xs text-fg-tertiary">In {resource.courseName}</span>
              <Headline text={resource.headline} />
            </>
          )}
        />

        <SearchSection<AnnouncementHit>
          id="announcements"
          heading="Announcements"
          group={data.announcements}
          seeAllHref={`/announcements?q=${encodedQ}`}
          onOpenHref={(path) => void navigateByHref({ href: path })}
          renderHit={(announcement) => (
            <>
              <span className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-fg">
                  {announcement.title}
                </span>
                <span className="shrink-0 text-2xs text-fg-tertiary">
                  {ANNOUNCEMENT_TYPE_LABEL[announcement.type]}
                </span>
              </span>
              <Headline text={announcement.headline} />
            </>
          )}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Search"
        description="Ranked matches across courses, resources and announcements."
      />

      <div className="pb-5">
        <Input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Try “welding” or “WELD-2”"
          aria-label="Search courses, resources and announcements"
          leading={<Search aria-hidden="true" className="size-4" />}
          maxLength={MAX_QUERY_LENGTH}
          className="md:w-96"
        />
      </div>

      {body}
    </div>
  );
}
