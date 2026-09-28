import { useCallback, useRef, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp, ShieldCheck, Upload } from 'lucide-react';
import {
  BULK_IMPORT_MAX_ROWS,
  createUserSchema,
  type BulkImportResult,
  type CreateUserInput,
} from '@skillwright/shared/schema';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogContent } from '@/components/ui/Dialog';
import { FormField } from '@/components/ui/FormField';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/Toast';

export interface UserBulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * A pasted line: email, name, role, department. Three commas is the whole format
 * and it is deliberately the smallest one that carries `createUserSchema`'s
 * required fields.
 */
const SAMPLE = [
  'dana.okafor@example.edu, Dana Okafor, STUDENT, dep-welding-1',
  'sam.reed@example.edu, Sam Reed, STUDENT, dep-welding-1',
  'nina.patel@example.edu, Nina Patel, TEACHER, dep-welding-1, CSWIP 3.1',
].join('\n');

/**
 * `Import cohort` — the thirty-click intake, made one dialog (Phase 4).
 *
 * THE DRY RUN IS THE DEFAULT FIRST ACTION, and that is the design rather than a
 * convenience. The first thing an admin does with an import is upload the wrong
 * file, and a wrong file that is a hundred rows of real students is not a mistake
 * anybody undoes by hand. So the primary button reads "Check this file", it sends
 * `dryRun: true`, and "Create N accounts" only becomes available after a check has
 * come back for the text that is currently in the box.
 *
 * WHICH MEANS THE PARSED ROWS ARE THE UNIT, and the parse is local. The textarea
 * is split and each line is run through `createUserSchema` — the SAME schema the
 * server binds — before anything is sent, so the row count, the role conditionals
 * and the per-row messages on screen are the server's own rules rather than a
 * second opinion. Rows that do not parse are shown immediately and are NOT sent:
 * sending them would only produce the same `VALIDATION_FAILED` entries with less
 * context, and a request that is going to be partly refused should not be made.
 *
 * WHAT IS NOT HERE: a CSV parser with quoted fields, embedded commas and a header
 * row. Every spreadsheet exports a comma-separated file, and a real RFC 4180
 * parser is a hundred lines of state machine that a school administrator will
 * never trigger and a future maintainer will have to keep correct. The format is
 * documented above the box, an example is one click away, and a person with a
 * genuinely awkward name is better served by pasting the column they need than by
 * discovering our parser does not handle quotes.
 */
export function UserBulkImportDialog({
  open,
  onOpenChange,
}: UserBulkImportDialogProps): ReactElement {
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ text: string; result: BulkImportResult } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * `text` → rows, and the ONE parse this dialog has. Split, trim, drop the blank
   * lines a trailing newline leaves behind, and hand each line to the shared
   * schema.
   *
   * The COMMA SPLIT IS NAIVE ON PURPOSE, and the limit is stated rather than
   * hidden: a name containing a comma (`Okafor, Dana`) becomes four fields and is
   * refused with a `VALIDATION_FAILED` on the department. That is a worse outcome
   * than a correct parse — and it is still the right trade for this scope, because
   * the failure is VISIBLE, names the row, and the person pastes a corrected line
   * in two seconds, whereas a hand-written parser is a thing that can be subtly
   * wrong in a way nobody notices until a real student is missing from the cohort.
   */
  const parse = useCallback(
    (input: string): { rows: CreateUserInput[]; bad: Array<{ line: number; message: string }> } => {
      const rows: CreateUserInput[] = [];
      const bad: Array<{ line: number; message: string }> = [];

      input
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .forEach((line, index) => {
          const [email, name, role, departmentId, qualification] = line
            .split(',')
            .map((part) => part.trim());
          const parsed = createUserSchema.safeParse({
            email,
            name,
            role,
            departmentId: departmentId === '' ? undefined : departmentId,
            ...(qualification === undefined || qualification === '' ? {} : { qualification }),
          });
          if (parsed.success) rows.push(parsed.data);
          else
            bad.push({
              line: index + 1,
              message: parsed.error.issues[0]?.message ?? 'Invalid row',
            });
        });

      return { rows, bad };
    },
    [],
  );

  const { rows, bad } = parse(text);

  /** A check is only usable for the text it was run against. */
  const checkIsCurrent = checked !== null && checked.text === text;
  const tooMany = rows.length > BULK_IMPORT_MAX_ROWS;

  const reset = useCallback(() => {
    setText('');
    setFileName(null);
    setChecked(null);
    if (fileInput.current) fileInput.current.value = '';
  }, []);

  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.post<BulkImportResult>('/users/bulk', { rows, dryRun }),
    onSuccess: async (result, dryRun) => {
      if (dryRun) {
        // A check that found problems is a SUCCESSFUL check. Saying otherwise —
        // an error toast over a table of useful, fixable rows — teaches people that
        // the dry run is something to avoid running.
        setChecked({ text, result });
        if (result.failed.length === 0) {
          toast.success(`${rows.length} rows are ready to import`, {
            description: 'Nothing has been created yet.',
          });
        }
        return;
      }

      setChecked(null);
      toast.success(
        result.created.length === 0
          ? 'No accounts were created'
          : `${result.created.length} account${result.created.length === 1 ? '' : 's'} created`,
        {
          description:
            result.failed.length > 0
              ? `${result.failed.length} row${result.failed.length === 1 ? '' : 's'} could not be imported — see the table.`
              : 'They set their own password through Forgot password.',
        },
      );
      reset();
      onOpenChange(false);
      // The new rows appear in the admin list without any local bookkeeping.
      await client.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error) => toast.fromError(error, 'Could not import that cohort'),
  });

  const busy = run.isPending;
  const canCheck = rows.length > 0 && bad.length === 0 && !tooMany && !busy;
  const canImport =
    canCheck &&
    checkIsCurrent &&
    checked?.result.failed.length === 0 &&
    checked?.result.dryRun === true;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        dismissible={!busy}
        title="Import cohort"
        description="One row per person: email, name, role, department. Add a fifth column for a teacher's qualification."
        footer={
          <>
            <Button
              variant="ghost"
              block
              className="sm:w-auto"
              disabled={busy}
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            {/*
              THE DRY RUN IS FIRST, ALWAYS. It is the primary button because the
              irreversible one should be the thing a person reaches for second, not
              first — and it is enabled the moment the box parses, so "check" is
              never more work than "commit".
            */}
            <Button
              variant="secondary"
              block
              className="sm:w-auto"
              leadingIcon={<ShieldCheck aria-hidden="true" className="size-4" />}
              disabled={!canCheck}
              loading={run.isPending && !checked}
              onClick={() => run.mutate(true)}
            >
              Check this file
            </Button>
            <Button
              block
              className="sm:w-auto"
              leadingIcon={<Upload aria-hidden="true" className="size-4" />}
              // Refused until a check for THIS text came back clean. There is no
              // path to here that skips the check, which is the whole feature.
              disabled={!canImport}
              loading={busy}
              onClick={() => run.mutate(false)}
            >
              {rows.length > 0
                ? `Create ${rows.length} account${rows.length === 1 ? '' : 's'}`
                : 'Create accounts'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <FormField
            label="Cohort"
            hint={`One person per line, comma separated. Up to ${BULK_IMPORT_MAX_ROWS} rows.`}
          >
            <Textarea
              autoResize
              rows={8}
              value={text}
              spellCheck={false}
              placeholder={SAMPLE}
              aria-label="Cohort rows"
              disabled={busy}
              onChange={(event) => {
                setText(event.target.value);
                // Any edit invalidates the previous check. Leaving it in place would
                // offer "Create 12 accounts" for a file that has since changed, and
                // the number on the button is the only thing telling them which file
                // they are about to import.
                setChecked(null);
              }}
            />
          </FormField>

          {/*
            A file input beside the textarea rather than instead of it. The brief
            allows either, and a school administrator's cohort is sitting in a
            spreadsheet they have not been told to flatten — so reading the file is
            the path most people will actually take, and the textarea is the one
            that works on a phone. Neither replaces the other.
          */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leadingIcon={<FileUp aria-hidden="true" className="size-4" />}
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              Choose a file
            </Button>
            {fileName ? <span className="text-xs text-fg-tertiary">{fileName}</span> : null}
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              aria-label="Choose a cohort file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                setChecked(null);
                void file.text().then((contents) => setText(contents));
              }}
            />
          </div>

          {tooMany ? (
            <p role="alert" className="text-sm font-medium text-danger-fg">
              {rows.length} rows is over the limit of {BULK_IMPORT_MAX_ROWS}. Import them in more
              than one go.
            </p>
          ) : null}

          {bad.length > 0 ? (
            <div role="alert" className="flex flex-col gap-2">
              <p className="text-sm font-medium text-danger-fg">
                {bad.length} row{bad.length === 1 ? '' : 's'} could not be read, so nothing has been
                sent.
              </p>
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Rows that could not be read</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-16 pb-1 font-medium text-fg-tertiary">
                      Row
                    </th>
                    <th scope="col" className="pb-1 font-medium text-fg-tertiary">
                      Problem
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bad.map((entry) => (
                    <tr key={entry.line}>
                      <td className="py-0.5 pr-2 font-mono text-fg-secondary">{entry.line}</td>
                      <td className="py-0.5 text-fg-secondary">{entry.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/*
            THE RESULTS TABLE. Failures with their ROW NUMBERS, one-based, because
            the person fixing the file is looking at a spreadsheet whose first row
            is row 1 — a zero-based index sends them one line up, which is worse
            than no number at all.
          */}
          {checkIsCurrent && checked !== null ? (
            <BulkImportResults result={checked.result} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The per-row outcome, as a table rather than a toast. */
function BulkImportResults({ result }: { result: BulkImportResult }): ReactElement {
  if (result.failed.length === 0) {
    return (
      <div
        role="status"
        className="rounded-md border border-success-line bg-success-soft px-3 py-2 text-sm text-success-fg"
      >
        {result.dryRun
          ? 'Every row is valid. Nothing has been created yet.'
          : 'Every row was imported.'}
      </div>
    );
  }

  return (
    <div role="status" className="flex flex-col gap-2">
      <p className="text-sm font-medium text-warning-fg">
        {result.failed.length} row{result.failed.length === 1 ? '' : 's'} failed.{' '}
        {result.dryRun
          ? 'Fix them and check again — nothing has been created yet.'
          : 'The other rows were created.'}
      </p>
      <div className="max-h-48 overflow-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Rows that could not be imported</caption>
          <thead>
            <tr>
              <th scope="col" className="w-16 pb-1 font-medium text-fg-tertiary">
                Row
              </th>
              <th scope="col" className="w-32 pb-1 font-medium text-fg-tertiary">
                Reason
              </th>
              <th scope="col" className="pb-1 font-medium text-fg-tertiary">
                Detail
              </th>
            </tr>
          </thead>
          <tbody>
            {result.failed.map((failure) => (
              <tr key={failure.row}>
                <td className="py-0.5 pr-2 font-mono text-fg-secondary">{failure.row}</td>
                <td className="py-0.5 pr-2 text-fg-secondary">{failure.code}</td>
                <td className="py-0.5 text-fg-secondary">{failure.detail ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
