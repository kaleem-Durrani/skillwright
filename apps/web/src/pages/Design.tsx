import { useState, type ReactNode } from 'react';
import { Download, Info, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { DataList } from '@/components/ui/DataList';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/Dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { FormField } from '@/components/ui/FormField';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Pagination } from '@/components/ui/Pagination';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/Select';
import { Separator } from '@/components/ui/Separator';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/Sheet';
import {
  Skeleton,
  SkeletonCard,
  SkeletonList,
  SkeletonStats,
  SkeletonThread,
} from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { StatusChip, STATUS_MAP, type StatusKey } from '@/components/ui/StatusChip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';
import { Tooltip } from '@/components/ui/Tooltip';
import { OtpInput } from '@/components/auth/OtpInput';

/**
 * /design — the visual regression surface.
 *
 * Every primitive, every variant, every state, rendered in BOTH themes at once.
 * The two columns are `[data-theme-preview]` subtrees, so this page proves the
 * light/dark contract without needing two browser windows and without any
 * component knowing which theme it is in.
 *
 * It is deliberately data-free: nothing here fetches, so a screenshot diff of
 * this page is caused by a token or a component change and nothing else.
 */
export function DesignPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="safe-top gutter-safe sticky top-0 z-30 flex h-[var(--shell-topbar-h)] items-center gap-3 border-b border-line-subtle bg-surface/90 backdrop-blur-md">
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-md bg-brand font-display text-sm font-bold text-fg-on-brand"
        >
          SW
        </span>
        <h1 className="font-display text-base font-semibold">Design system</h1>
        <div className="flex-1" />
        <ThemeToggle />
      </header>

      <div className="gutter-safe py-6">
        <p className="measure pb-6 text-sm text-fg-secondary">
          Both themes, side by side, from the same components. Below <code>lg</code> they stack —
          this page follows the same mobile-first rules as the app it documents.
        </p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
          <ThemePane theme="light" />
          <ThemePane theme="dark" />
        </div>
      </div>
    </div>
  );
}

function ThemePane({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <section
      data-theme-preview={theme}
      aria-label={`${theme} theme`}
      className="overflow-hidden rounded-xl border border-line-subtle bg-canvas"
    >
      <div className="sticky top-[calc(var(--shell-topbar-h)+var(--shell-safe-top))] z-20 border-b border-line-subtle bg-surface px-4 py-2">
        <h2 className="font-display text-sm font-semibold tracking-wide text-fg uppercase">
          {theme}
        </h2>
      </div>
      <div className="flex flex-col gap-8 p-4">
        <Gallery />
      </div>
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-display text-sm font-semibold tracking-wide text-fg-tertiary uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

const SEMANTIC_SWATCHES: Array<{ name: string; className: string }> = [
  { name: 'canvas', className: 'bg-canvas' },
  { name: 'surface', className: 'bg-surface' },
  { name: 'raised', className: 'bg-raised' },
  { name: 'sunken', className: 'bg-sunken' },
  { name: 'hover', className: 'bg-hover' },
  { name: 'selected', className: 'bg-selected' },
  { name: 'brand', className: 'bg-brand' },
  { name: 'brand-soft', className: 'bg-brand-soft' },
  { name: 'success', className: 'bg-success' },
  { name: 'warning', className: 'bg-warning' },
  { name: 'danger', className: 'bg-danger' },
  { name: 'info', className: 'bg-info' },
];

const VIZ = [
  'bg-viz-1',
  'bg-viz-2',
  'bg-viz-3',
  'bg-viz-4',
  'bg-viz-5',
  'bg-viz-6',
  'bg-viz-7',
  'bg-viz-8',
];

const TYPE_SCALE: Array<{ name: string; className: string }> = [
  { name: '5xl display', className: 'text-5xl font-display font-semibold' },
  { name: '4xl display', className: 'text-4xl font-display font-semibold' },
  { name: '3xl display', className: 'text-3xl font-display font-semibold' },
  { name: '2xl display', className: 'text-2xl font-display font-semibold' },
  { name: 'xl', className: 'text-xl font-medium' },
  { name: 'lg', className: 'text-lg' },
  { name: 'base', className: 'text-base' },
  { name: 'sm', className: 'text-sm' },
  { name: 'xs', className: 'text-xs' },
  { name: '2xs', className: 'text-2xs' },
];

interface DemoRow {
  id: string;
  name: string;
  course: string;
  status: StatusKey;
}

const DEMO_ROWS: DemoRow[] = [
  { id: '1', name: 'Ada Lovelace', course: 'MIG Welding I', status: 'APPROVED' },
  { id: '2', name: 'Grace Hopper', course: 'Fabrication Basics', status: 'PENDING' },
  { id: '3', name: 'Katherine Johnson', course: 'Pipe Welding', status: 'REJECTED' },
];

function Gallery() {
  const [otp, setOtp] = useState('12');
  const [checked, setChecked] = useState(true);
  const [page, setPage] = useState(3);

  return (
    <>
      <Section title="Semantic colour">
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {SEMANTIC_SWATCHES.map((swatch) => (
            <li key={swatch.name} className="flex flex-col gap-1">
              <span
                className={cn('h-10 w-full rounded-md border border-line-subtle', swatch.className)}
              />
              <span className="truncate text-2xs text-fg-tertiary">{swatch.name}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-1">
          {VIZ.map((className) => (
            <span key={className} className={cn('h-6 flex-1 rounded-xs', className)} />
          ))}
        </div>
      </Section>

      <Section title="Type scale">
        <ul className="flex flex-col gap-2">
          {TYPE_SCALE.map((entry) => (
            <li key={entry.name} className="flex items-baseline gap-3">
              <span className="w-24 shrink-0 font-mono text-2xs text-fg-tertiary">
                {entry.name}
              </span>
              <span className={cn('truncate', entry.className)}>Weld the seam</span>
            </li>
          ))}
        </ul>
        <p className="font-mono text-xs text-fg-secondary">IBM Plex Mono — 0123456789 · id_9f3a</p>
      </Section>

      <Section title="Button — variants">
        <Row>
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link</Button>
        </Row>
      </Section>

      <Section title="Button — sizes, icons, states">
        <Row>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </Row>
        <Row>
          <Button leadingIcon={<Plus aria-hidden="true" className="size-4" />}>Leading</Button>
          <Button trailingIcon={<Download aria-hidden="true" className="size-4" />}>
            Trailing
          </Button>
          <Button loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button variant="danger" loading>
            Deleting
          </Button>
        </Row>
        <Button block>Block (the mobile default for a form action)</Button>
        <Row>
          <IconButton aria-label="Add something" icon={<Plus className="size-5" />} />
          <IconButton
            aria-label="Delete something"
            variant="danger"
            icon={<Trash2 className="size-5" />}
          />
          <IconButton
            aria-label="More information"
            variant="secondary"
            icon={<Info className="size-5" />}
          />
        </Row>
      </Section>

      <Section title="Form controls">
        <FormField label="Email" required hint="We only use this to sign you in.">
          <Input type="email" placeholder="you@example.com" />
        </FormField>
        <FormField label="Password" required error="That password is too short">
          <Input type="password" defaultValue="short" />
        </FormField>
        <FormField label="Disabled">
          <Input disabled defaultValue="Read only" />
        </FormField>
        <FormField label="With adornments">
          <Input leading={<Info aria-hidden="true" className="size-4" />} placeholder="Search" />
        </FormField>
        <FormField label="Notes" hint="Grows with the content.">
          <Textarea autoResize placeholder="Type here" />
        </FormField>
        <FormField label="Department" required>
          <Select defaultValue="welding">
            <SelectTrigger placeholder="Choose one" />
            <SelectContent>
              <SelectItem value="welding" hint="12 courses">
                Welding
              </SelectItem>
              <SelectItem value="fabrication" hint="8 courses">
                Fabrication
              </SelectItem>
              <SelectItem value="electrical" disabled>
                Electrical (closed)
              </SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <div className="flex flex-col">
          <Checkbox
            checked={checked}
            onCheckedChange={(value) => setChecked(value === true)}
            label="Email me about enrolment decisions"
            hint="You can change this at any time."
          />
          <Checkbox checked="indeterminate" label="Indeterminate" />
          <Checkbox disabled label="Disabled" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>One-time code</Label>
          <OtpInput label="Demo one-time code" value={otp} onChange={setOtp} />
        </div>
      </Section>

      <Section title="Card">
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-1">
              <CardTitle>MIG Welding I</CardTitle>
              <CardDescription>WLD-101 · Fabrication department</CardDescription>
            </div>
            <StatusChip status="PUBLISHED" />
          </CardHeader>
          <CardContent>
            An introduction to gas metal arc welding, covering machine setup, wire selection and lap
            joints.
          </CardContent>
          <CardFooter>
            <Button variant="ghost" block className="sm:w-auto">
              Details
            </Button>
            <Button block className="sm:w-auto">
              Request enrolment
            </Button>
          </CardFooter>
        </Card>
        <Row>
          <Card variant="raised" className="flex-1">
            Raised
          </Card>
          <Card variant="sunken" className="flex-1">
            Sunken
          </Card>
          <Card variant="ghost" className="flex-1">
            Ghost
          </Card>
        </Row>
      </Section>

      <Section title="Badge and StatusChip">
        <Row>
          <Badge tone="neutral">Neutral</Badge>
          <Badge tone="brand">Brand</Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
          <Badge tone="info">Info</Badge>
        </Row>
        <Row>
          <Badge variant="solid" tone="brand">
            Solid
          </Badge>
          <Badge variant="outline" tone="brand">
            Outline
          </Badge>
          <Badge size="sm" tone="neutral">
            Small
          </Badge>
        </Row>
        <Row>
          {(Object.keys(STATUS_MAP) as StatusKey[]).map((status) => (
            <StatusChip key={status} status={status} />
          ))}
        </Row>
      </Section>

      <Section title="Avatar, Spinner, Separator">
        <Row>
          <Avatar name="Ada Lovelace" size="xs" />
          <Avatar name="Grace Hopper" size="sm" />
          <Avatar name="Katherine Johnson" size="md" presence="online" />
          <Avatar name="Mary Jackson" size="lg" />
          <Avatar name="Annie Easley" size="xl" presence="offline" />
        </Row>
        <Row>
          <Spinner size="sm" />
          <Spinner size="md" />
          <Spinner size="lg" label="Loading" />
        </Row>
        <Separator />
        <Separator label="or" />
      </Section>

      <Section title="Skeletons (they mirror the real layout)">
        <SkeletonStats count={2} />
        <SkeletonCard />
        <SkeletonList rows={2} />
        <SkeletonThread rows={3} />
        <Row>
          <Skeleton shape="chip" />
          <Skeleton shape="circle" className="size-10" />
          <Skeleton shape="control" className="w-40" />
        </Row>
      </Section>

      <Section title="EmptyState — three distinct variants">
        <EmptyState variant="empty" compact onAction={() => undefined} />
        <EmptyState variant="no-results" compact onAction={() => undefined} />
        <EmptyState variant="error" compact onAction={() => undefined} requestId="req_01J8XK4M2Q" />
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="resources">
          <TabsList>
            <TabsTrigger value="resources">Resources</TabsTrigger>
            <TabsTrigger value="students" count={4}>
              Students
            </TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="resources" className="pt-2 text-sm text-fg-secondary">
            Resource list goes here.
          </TabsContent>
          <TabsContent value="students" className="pt-2 text-sm text-fg-secondary">
            Enrolment queue goes here.
          </TabsContent>
          <TabsContent value="settings" className="pt-2 text-sm text-fg-secondary">
            Course settings go here.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Overlays">
        <Row>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open dialog</Button>
            </DialogTrigger>
            <DialogContent
              title="Reject this request?"
              description="The student will be told, and will see your reason."
              footer={
                <>
                  <Button variant="ghost" block className="sm:w-auto">
                    Cancel
                  </Button>
                  <Button variant="danger" block className="sm:w-auto">
                    Reject
                  </Button>
                </>
              }
            >
              <p className="text-fg-secondary">
                Bottom sheet below <code>sm</code>, centred card above it.
              </p>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary">Open sheet</Button>
            </SheetTrigger>
            <SheetContent title="Filters" description="Bottom sheet on mobile, side panel from md.">
              <div className="flex flex-col gap-3">
                <Checkbox label="Published only" defaultChecked />
                <Checkbox label="Has open places" />
                <Checkbox label="My department" />
              </div>
            </SheetContent>
          </Sheet>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">Open menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem icon={<Download className="size-4" />}>Download</DropdownMenuItem>
              <DropdownMenuItem>Duplicate</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive icon={<Trash2 className="size-4" />}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip content="Only a pointer user ever sees this.">
            <Button variant="ghost">Hover me</Button>
          </Tooltip>
        </Row>

        <Row>
          <Button variant="secondary" onClick={() => toast.success('Enrolment approved')}>
            Toast: success
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.error('Could not save', { description: 'Reference: req_01J8XK4M2Q' })
            }
          >
            Toast: error
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.info('Resource published', {
                action: { label: 'Undo', onClick: () => undefined },
              })
            }
          >
            Toast: with action
          </Button>
        </Row>
      </Section>

      <Section title="ScrollArea">
        <ScrollArea className="h-32 rounded-md border border-line-subtle">
          <ul className="p-2 text-sm">
            {Array.from({ length: 12 }, (_, index) => (
              <li key={index} className="px-2 py-1.5 text-fg-secondary">
                Scrollable row {index + 1}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </Section>

      <Section title="DataList — cards below md, table from md">
        <DataList
          items={DEMO_ROWS}
          caption="Demo enrolments"
          getKey={(row) => row.id}
          columns={[
            { id: 'name', header: 'Student', cell: (row) => row.name },
            { id: 'course', header: 'Course', cell: (row) => row.course },
            {
              id: 'status',
              header: 'Status',
              align: 'end',
              cell: (row) => <StatusChip status={row.status} />,
            },
          ]}
          renderCard={(row) => (
            <Card className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{row.name}</span>
                <span className="truncate text-xs text-fg-tertiary">{row.course}</span>
              </div>
              <StatusChip status={row.status} />
            </Card>
          )}
        />
        <DataList
          items={[] as DemoRow[]}
          caption="Empty demo"
          getKey={(row) => row.id}
          columns={[{ id: 'name', header: 'Student', cell: (row) => row.name }]}
          renderCard={(row) => <Card>{row.name}</Card>}
          empty={<EmptyState variant="no-results" compact onAction={() => undefined} />}
        />
        <DataList
          items={[] as DemoRow[]}
          loading
          skeletonRows={2}
          caption="Loading demo"
          getKey={(row) => row.id}
          columns={[{ id: 'name', header: 'Student', cell: (row) => row.name }]}
          renderCard={(row) => <Card>{row.name}</Card>}
        />
      </Section>

      <Section title="Pagination">
        <Pagination
          label="Demo pagination"
          page={page}
          totalPages={12}
          total={238}
          limit={20}
          onPageChange={setPage}
        />
      </Section>

      <Section title="ErrorBoundary">
        <ErrorBoundary>
          <Exploder />
        </ErrorBoundary>
      </Section>
    </>
  );
}

/** Throws on demand so the boundary's real fallback is visible, not described. */
function Exploder() {
  const [boom, setBoom] = useState(false);
  if (boom) throw new Error('Deliberate failure from the design gallery');
  return (
    <Button variant="secondary" onClick={() => setBoom(true)}>
      Trigger a render error
    </Button>
  );
}
