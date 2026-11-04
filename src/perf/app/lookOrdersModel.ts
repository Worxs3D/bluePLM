/**
 * The order RPCs of `supabase/migrations/0513_supply_orders.sql` in memory, over the ui-look
 * boot's fake Supabase rows (`supply_order`, `supply_order_line`, `file`, `file_version`,
 * `drawing_pdf_render`, `file_version_output`), with the same rules, JSON shapes and `HINT`
 * refusal codes, so the Orders screens can be driven headlessly end to end. ui-look only.
 *
 * Not modelled: module access (the perf user has every module) and RLS (every vault is readable).
 * Lines RLS would hide are a per-order count (`hidden`) that only `line_count` sees, which is what
 * the "lines in vaults you can't see" note reads.
 */
import { FakeRpcRefusal, type FakeSupabase, type Row } from '@/test/fakeSupabase'

const KINDS = ['pdf', 'step', 'iges', 'stl', 'dxf', 'source'] as const
const TRANSITIONS = new Set([
  'draft>sent', 'sent>received', 'received>closed', 'draft>cancelled', 'sent>cancelled',
  'received>cancelled', 'cancelled>draft', 'sent>draft',
])
const HEADER_KEYS = new Set(['title', 'purpose', 'supplier_id', 'supplier_name', 'due_date', 'notes'])
const LINE_KEYS = new Set(['quantity', 'output_kinds', 'notes', 'file_version_id', 'drawing_version_id'])
const ADD_KEYS = new Set(['file_version_id', 'configuration', 'drawing_version_id', 'quantity', 'output_kinds'])

function refuse(message: string, hint: string, sqlState = '55000', details?: string): never {
  throw new FakeRpcRefusal(message, sqlState, hint, details)
}

const isDrawingName = (name: unknown) => /\.slddrw$/i.test(String(name ?? ''))

function kindsOf(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((k) => !(KINDS as readonly unknown[]).includes(k))) {
    refuse('Unknown output kind', 'BAD_KIND', '22023')
  }
  return KINDS.filter((k) => (value as unknown[]).includes(k))
}

function quantityOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1_000_000) {
    refuse('Quantity must be a whole number from 1', 'BAD_QUANTITY', '22023')
  }
  return value
}

export class LookOrdersModel {
  /** Lines RLS would hide from the signed-in user, per order (counted in `line_count` only). */
  readonly hidden = new Map<string, number>()
  /** RPCs that fail as if the server were down (the error scenes). */
  readonly failing = new Set<string>()
  private last = 0

  constructor(
    private readonly db: FakeSupabase,
    private readonly orgId: string,
  ) {}

  now(): string {
    this.last = Math.max(Date.now(), this.last + 1)
    return new Date(this.last).toISOString()
  }

  private insert(table: string, row: Row): Row {
    return this.db.seed(table as never, row as never) as unknown as Row
  }

  private rows(table: string): Row[] {
    return this.db.rows(table as never)
  }

  private find(table: string, id: unknown): Row | null {
    return id ? (this.rows(table).find((r) => r.id === id) ?? null) : null
  }

  orders(): Row[] {
    return this.rows('supply_order')
  }

  lines(orderId: string): Row[] {
    return this.rows('supply_order_line')
      .filter((l) => l.order_id === orderId)
      .sort((a, b) => Number(a.position) - Number(b.position))
  }

  private order(id: unknown): Row {
    const order = this.find('supply_order', id)
    if (!order || order.org_id !== this.orgId) refuse('Order not found', 'NOT_FOUND', '42501')
    return order
  }

  private draft(order: Row): void {
    if (order.status !== 'draft') refuse('Lines change only while the order is a draft', 'NOT_DRAFT')
  }

  /** What the triggers keep: line_count, updated_at, updated_by. */
  private touch(order: Row): Row {
    order.line_count = this.lines(String(order.id)).length + (this.hidden.get(String(order.id)) ?? 0)
    order.updated_at = this.now()
    order.updated_by = this.db.actorId
    return { ...order }
  }

  /** Forget every order (scenes rebuild their world through the RPCs). */
  reset(): void {
    this.db.removeRows('supply_order_line' as never, [...this.rows('supply_order_line')])
    this.db.removeRows('supply_order' as never, [...this.rows('supply_order')])
    this.hidden.clear()
    this.failing.clear()
  }

  private prefix(): string {
    const org = this.find('organization', this.orgId)
    const settings = (org?.settings ?? {}) as { orders?: { number_prefix?: unknown } }
    const prefix = settings.orders?.number_prefix
    return typeof prefix === 'string' && prefix ? prefix : 'ORD-'
  }

  private createRow(fields: Row): Row {
    const sequence = Math.max(0, ...this.orders().filter((o) => o.org_id === this.orgId).map((o) => Number(o.sequence))) + 1
    const at = this.now()
    return this.insert('supply_order', {
      purpose: 'purchase',
      status: 'draft',
      line_count: 0,
      ...fields,
      org_id: this.orgId,
      sequence,
      order_number: `${this.prefix()}${String(sequence).padStart(4, '0')}`,
      created_by: this.db.actorId,
      created_at: at,
      updated_by: this.db.actorId,
      updated_at: at,
    })
  }

  private headerFields(patch: Row): Row {
    const out: Row = {}
    for (const [key, value] of Object.entries(patch)) {
      if (!HEADER_KEYS.has(key)) refuse(`Unknown field ${key}`, 'BAD_PATCH', '22023')
      if (key === 'title' && (typeof value !== 'string' || !value.trim())) refuse('A title is required', 'BAD_PATCH', '22023')
      if (key === 'purpose' && value !== 'quote' && value !== 'purchase') refuse('Purpose is quote or purchase', 'BAD_PATCH', '22023')
      out[key] = typeof value === 'string' ? value.trim() || null : value
    }
    return out
  }

  create(a: Row): Row {
    const fields = this.headerFields({
      title: a.p_title,
      purpose: a.p_purpose ?? 'purchase',
      ...(a.p_supplier_id ? { supplier_id: a.p_supplier_id } : {}),
      ...(a.p_supplier_name ? { supplier_name: a.p_supplier_name } : {}),
      ...(a.p_due_date ? { due_date: a.p_due_date } : {}),
      ...(a.p_notes ? { notes: a.p_notes } : {}),
    })
    return { ok: true, order: { ...this.createRow(fields) } }
  }

  update(a: Row): Row {
    const order = this.order(a.p_order_id)
    if (order.status === 'closed' || order.status === 'cancelled') refuse('A closed or cancelled order is frozen', 'FROZEN')
    Object.assign(order, this.headerFields((a.p_patch ?? {}) as Row))
    return { ok: true, order: this.touch(order) }
  }

  /** The live, readable file and version of a version id, or a skip reason. */
  private pinned(versionId: unknown): { fv: Row; file: Row } | null {
    const fv = this.find('file_version', versionId)
    const file = fv ? this.find('file', fv.file_id) : null
    if (!fv || !file || file.org_id !== this.orgId || file.deleted_at) return null
    return { fv, file }
  }

  addLines(a: Row): Row {
    const order = this.order(a.p_order_id)
    this.draft(order)
    const elements = Array.isArray(a.p_lines) ? (a.p_lines as Row[]) : refuse('Lines must be a list', 'BAD_PATCH', '22023')
    for (const el of elements) {
      if (Object.keys(el).some((k) => !ADD_KEYS.has(k))) refuse('Unknown line key', 'BAD_PATCH', '22023')
    }
    let added = 0
    let updated = 0
    const skipped: Row[] = []
    for (const el of elements) {
      const quantity = 'quantity' in el ? quantityOf(el.quantity) : null
      const kinds = 'output_kinds' in el ? kindsOf(el.output_kinds) : null
      const configuration = typeof el.configuration === 'string' && el.configuration ? el.configuration : null
      const own = this.pinned(el.file_version_id)
      if (!own) {
        skipped.push({ file_version_id: el.file_version_id, reason: 'NOT_FOUND' })
        continue
      }
      const isDrawing = isDrawingName(own.file.file_name)
      const hasDrawingKey = 'drawing_version_id' in el
      const drawing = !isDrawing && el.drawing_version_id ? this.pinned(el.drawing_version_id) : null
      if (!isDrawing && el.drawing_version_id && !drawing) {
        skipped.push({ file_version_id: el.file_version_id, reason: 'NOT_FOUND' })
        continue
      }
      if (drawing && !isDrawingName(drawing.file.file_name)) {
        skipped.push({ file_version_id: el.file_version_id, reason: 'NOT_A_DRAWING' })
        continue
      }
      const snapshot: Row = {
        file_version_id: own.fv.id,
        vault_id: own.file.vault_id,
        file_name: own.file.file_name,
        part_number: own.fv.part_number ?? own.file.part_number,
        description: own.fv.description ?? own.file.description,
        revision: own.fv.revision,
        version: own.fv.version,
      }
      const drawingFields: Row = {
        drawing_file_id: drawing?.file.id ?? null,
        drawing_version_id: drawing?.fv.id ?? null,
        drawing_vault_id: drawing?.file.vault_id ?? null,
        drawing_file_name: drawing?.file.file_name ?? null,
        drawing_version: drawing?.fv.version ?? null,
      }
      const existing = this.lines(String(order.id)).find(
        (l) => l.file_id === own.file.id && (l.configuration ?? '') === (configuration ?? ''),
      )
      if (existing) {
        Object.assign(existing, snapshot, isDrawing || hasDrawingKey ? drawingFields : {}, {
          quantity: quantity ?? existing.quantity,
          output_kinds: kinds ?? existing.output_kinds,
          updated_at: this.now(),
        })
        updated++
        continue
      }
      const position = Math.max(0, ...this.lines(String(order.id)).map((l) => Number(l.position))) + 1
      this.insert('supply_order_line', {
        ...snapshot,
        ...drawingFields,
        order_id: order.id,
        org_id: this.orgId,
        position,
        file_id: own.file.id,
        configuration,
        quantity: quantity ?? 1,
        output_kinds: kinds ?? (isDrawing ? ['pdf'] : drawing ? ['pdf', 'step'] : ['step']),
        added_by: this.db.actorId,
        added_at: this.now(),
        updated_at: this.now(),
      })
      added++
    }
    this.touch(order)
    return { ok: true, added, updated, skipped }
  }

  updateLine(a: Row): Row {
    const line = this.find('supply_order_line', a.p_line_id)
    if (!line || line.org_id !== this.orgId) refuse('Line not found', 'NOT_FOUND', '42501')
    const order = this.order(line.order_id)
    this.draft(order)
    const patch = (a.p_patch ?? {}) as Row
    if (Object.keys(patch).some((k) => !LINE_KEYS.has(k))) refuse('Unknown line field', 'BAD_PATCH', '22023')
    if ('quantity' in patch) line.quantity = quantityOf(patch.quantity)
    if ('output_kinds' in patch) line.output_kinds = kindsOf(patch.output_kinds)
    if ('notes' in patch) line.notes = typeof patch.notes === 'string' && patch.notes.trim() ? patch.notes.trim() : null
    if ('file_version_id' in patch) {
      const own = this.pinned(patch.file_version_id)
      if (!own || own.file.id !== line.file_id) refuse('Another version of the same file only', 'BAD_PATCH', '22023')
      Object.assign(line, {
        file_version_id: own.fv.id,
        revision: own.fv.revision,
        version: own.fv.version,
        part_number: own.fv.part_number ?? own.file.part_number,
        description: own.fv.description ?? own.file.description,
      })
    }
    if ('drawing_version_id' in patch) {
      if (patch.drawing_version_id === null) {
        Object.assign(line, { drawing_file_id: null, drawing_version_id: null, drawing_vault_id: null, drawing_file_name: null, drawing_version: null })
      } else {
        if (isDrawingName(line.file_name)) refuse('A drawing line has no separate drawing', 'BAD_PATCH', '22023')
        const drawing = this.pinned(patch.drawing_version_id)
        if (!drawing) refuse('Drawing version not found', 'NOT_FOUND', '42501')
        if (!isDrawingName(drawing.file.file_name)) refuse('Not a drawing', 'BAD_PATCH', '22023')
        Object.assign(line, {
          drawing_file_id: drawing.file.id,
          drawing_version_id: drawing.fv.id,
          drawing_vault_id: drawing.file.vault_id,
          drawing_file_name: drawing.file.file_name,
          drawing_version: drawing.fv.version,
        })
      }
    }
    line.updated_at = this.now()
    this.touch(order)
    return { ok: true, line: { ...line } }
  }

  removeLines(a: Row): Row {
    const order = this.order(a.p_order_id)
    this.draft(order)
    const ids = new Set(Array.isArray(a.p_line_ids) ? a.p_line_ids : [])
    const doomed = this.lines(String(order.id)).filter((l) => ids.has(l.id))
    this.db.removeRows('supply_order_line' as never, doomed)
    this.touch(order)
    return { ok: true, removed: doomed.length }
  }

  /** As `supply_order_line_get_outputs`: what each included kind would send, and what is missing. */
  lineOutputs(line: Row): { outputs: Row[]; missing: string[] } {
    const isDrawing = isDrawingName(line.file_name)
    const own = line.file_id ? (line.file_version_id as string | null) : null
    const drawing = line.drawing_file_id ? (line.drawing_version_id as string | null) : null
    const outputs: Row[] = []
    const missing: string[] = []
    for (const kind of (line.output_kinds ?? []) as string[]) {
      const from =
        kind === 'pdf' || kind === 'dxf' ? (drawing ?? (isDrawing ? own : null))
          : kind === 'iges' || kind === 'stl' ? (isDrawing ? null : own)
            : own
      const configuration = (kind === 'step' || kind === 'stl') && !isDrawing ? ((line.configuration as string | null) ?? null) : null
      let found: Row | null = null
      if (from && kind === 'pdf') {
        const d = this.rows('drawing_pdf_render').find((r) => r.file_version_id === from)
        const base = String(from === drawing ? line.drawing_file_name : line.file_name).replace(/\.[^.]*$/, '')
        if (d) found = { kind, storage_hash: d.storage_hash, file_size: d.file_size, file_name: `${base}.pdf` }
      } else if (from && kind === 'source') {
        const fv = this.find('file_version', from)
        if (fv?.content_hash) found = { kind, storage_hash: fv.content_hash, file_size: fv.file_size ?? 0, file_name: line.file_name }
      } else if (from) {
        const o = this.rows('file_version_output').find(
          (r) => r.file_version_id === from && r.kind === kind && (r.configuration ?? '') === (configuration ?? ''),
        )
        if (o) found = { kind, storage_hash: o.storage_hash, file_size: o.file_size, file_name: o.file_name }
      }
      if (found) outputs.push(found)
      else missing.push(kind)
    }
    return { outputs, missing }
  }

  setStatus(a: Row): Row {
    const order = this.order(a.p_order_id)
    const status = String(a.p_status ?? '').trim().toLowerCase()
    if (!TRANSITIONS.has(`${order.status}>${status}`)) {
      refuse(`An order cannot go from ${String(order.status)} to ${status || 'nothing'}`, 'BAD_TRANSITION')
    }
    const lines = this.lines(String(order.id))
    const at = this.now()
    const missingAll: Row[] = []
    if (status === 'sent') {
      if (lines.length === 0) refuse('An order with no lines cannot be sent', 'EMPTY_ORDER')
      const results = lines.map((line) => ({ line, result: this.lineOutputs(line) }))
      for (const { line, result } of results) {
        if (result.missing.length > 0) missingAll.push({ line_id: line.id, kinds: result.missing })
      }
      // A line the user cannot see lacks its STEP: the server names it, the screen can only count it.
      if ((this.hidden.get(String(order.id)) ?? 0) > 0) missingAll.push({ line_id: `hidden-${String(order.id)}`, kinds: ['step'] })
      // The SQL raises after writing the lines; the raise rolls that back, so nothing changes here.
      if (missingAll.length > 0 && a.p_allow_missing !== true) {
        refuse('Some lines have no output for a kind they send', 'MISSING_OUTPUTS', '55000', JSON.stringify(missingAll))
      }
      for (const { line, result } of results) {
        line.sent_outputs = result.outputs
        line.missing_kinds = result.missing
      }
      Object.assign(order, { status, sent_by: this.db.actorId, sent_at: at })
    } else if (status === 'draft') {
      for (const line of lines) Object.assign(line, { sent_outputs: null, missing_kinds: null })
      Object.assign(order, { status, sent_by: null, sent_at: null, received_at: null, closed_at: null, cancelled_at: null })
    } else {
      order.status = status
      if (status === 'received') order.received_at = at
      if (status === 'closed') order.closed_at = at
      if (status === 'cancelled') order.cancelled_at = at
    }
    return { ok: true, order: this.touch(order), missing: missingAll }
  }

  duplicate(a: Row): Row {
    const source = this.order(a.p_order_id)
    const title = typeof a.p_title === 'string' && a.p_title.trim() ? a.p_title.trim() : source.title
    const copy = this.createRow({
      title,
      purpose: source.purpose,
      supplier_id: source.supplier_id,
      supplier_name: source.supplier_name,
      notes: source.notes,
    })
    let skipped = this.hidden.get(String(source.id)) ?? 0
    for (const line of this.lines(String(source.id))) {
      if (!line.file_id || !line.file_version_id) {
        skipped++
        continue
      }
      const { id: _id, sent_outputs: _s, missing_kinds: _m, ...rest } = line
      this.insert('supply_order_line', { ...rest, order_id: copy.id, added_by: this.db.actorId, added_at: this.now(), updated_at: this.now() })
    }
    return { ok: true, order: this.touch(copy), skipped }
  }

  delete(a: Row, isAdmin: boolean): Row {
    const order = this.order(a.p_order_id)
    if (order.status !== 'draft' && order.status !== 'cancelled') refuse('Only a draft or cancelled order can be deleted', 'NOT_ALLOWED', '42501')
    if (order.created_by !== this.db.actorId && !isAdmin) refuse('Only its creator or an administrator can delete an order', 'NOT_ALLOWED', '42501')
    this.db.removeRows('supply_order_line' as never, this.lines(String(order.id)))
    this.db.removeRows('supply_order' as never, [order])
    this.hidden.delete(String(order.id))
    return { ok: true }
  }

  /** Register every order RPC on the fake (untyped: `src/types/supabase.ts` predates 513). */
  register(isAdmin: () => boolean): void {
    const rpcs: Record<string, (a: Row) => Row> = {
      supply_order_create: (a) => this.create(a),
      supply_order_update: (a) => this.update(a),
      supply_order_add_lines: (a) => this.addLines(a),
      supply_order_update_line: (a) => this.updateLine(a),
      supply_order_remove_lines: (a) => this.removeLines(a),
      supply_order_set_status: (a) => this.setStatus(a),
      supply_order_duplicate: (a) => this.duplicate(a),
      supply_order_delete: (a) => this.delete(a, isAdmin()),
    }
    for (const [name, run] of Object.entries(rpcs)) {
      this.db.defineRpc(
        name,
        (args) => {
          if (this.failing.has(name)) throw new FakeRpcRefusal(`${name}: the server is unavailable (look scene)`, '08006')
          return run(args)
        },
        { untyped: true },
      )
    }
  }
}
