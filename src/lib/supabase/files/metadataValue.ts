/**
 * The value a non-check-in writer may put into `files.part_number` / `files.description`.
 *
 * Only check-in can clear these columns, because only check-in carries the user's pending edit,
 * and only that edit can mean "make it empty". Every other writer (upload, adopting a value
 * read from the file) is relaying what it found, and finding nothing is not an instruction to
 * empty the row. So null, undefined and blank strings all read as "no value" here.
 */
export function nonEmptyText(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  return value
}
