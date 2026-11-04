/**
 * Reading every row of a query, page by page, so a list is never silently cut at a server's
 * `max-rows` or a fixed limit. Pure apart from the query it is given.
 */

import { isRow } from './rows'

/** Rows one page asks for: at or under PostgREST's usual `max-rows`. */
export const ORDER_PAGE_SIZE = 1000

export type PageQuery = (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>

/**
 * Every row of an ordered query, page by page, until a page comes back empty. A server whose
 * `max-rows` is below the page size still gets read whole: a page shorter than asked for but not
 * empty is followed by the next one, and only an empty page ends it. Throws on a query error.
 */
export async function readAllPages(query: PageQuery, pageSize = ORDER_PAGE_SIZE): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; ) {
    const { data, error } = await query(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const rows = (Array.isArray(data) ? data : []).filter(isRow)
    if (rows.length === 0) return out
    out.push(...rows)
    from += rows.length
  }
}

