/**
 * Realtime between the shared server and the simulated machines, with faults a test controls.
 *
 * Every committed write on the server becomes one `postgres_changes` event per changed row
 * (server.ts diffs the tables after each query and RPC), in the shape supabase-js hands a
 * `.on('postgres_changes', ...)` callback: `{ schema, table, eventType, new, old,
 * commit_timestamp, errors }`, with the full old row because the published tables are
 * REPLICA IDENTITY FULL (10-source-files.sql). The writer gets its own echo, as with Supabase.
 *
 * Per machine, delivery is one of:
 * - live: each event arrives `latencyMs` after the write (fake time), in commit order;
 * - held: events queue until `release()`, optionally reordered;
 * - disconnected: events are missed. `reconnect({ catchUp: true })` delivers what was missed
 *   (a server that buffered); `catchUp: false` is what Supabase Realtime actually does - the
 *   events are gone and only a reload brings the machine back.
 * `fault` decides per event and machine: drop it, duplicate it, or add delay.
 */
import { runOn, type MachineContext } from './context'

export type Row = Record<string, unknown>

export interface RealtimeEvent {
  seq: number
  table: string
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Row
  old: Row
  commit_timestamp: string
}

export type FaultDecision = { kind: 'deliver'; delayMs?: number } | { kind: 'drop' } | { kind: 'duplicate' }

export type FaultPolicy = (event: RealtimeEvent, machine: string) => FaultDecision

type Handler = (payload: Row) => void

class SimChannel {
  subscribed = false
  /** The `subscribe()` status callback: supabase-js calls it again on every rejoin. */
  status: ((status: string) => void) | null = null
  readonly handlers: Array<{ table: string | null; event: string; handler: Handler }> = []

  constructor(
    readonly name: string,
    private readonly link: MachineLink,
  ) {}

  on(type: string, filter: { event?: string; table?: string }, handler: Handler): this {
    if (type === 'postgres_changes') {
      this.handlers.push({ table: filter.table ?? null, event: filter.event ?? '*', handler })
    }
    return this
  }

  subscribe(callback?: (status: string) => void): this {
    this.subscribed = true
    this.link.channels.add(this)
    this.status = callback ?? null
    callback?.('SUBSCRIBED')
    return this
  }

  async unsubscribe(): Promise<'ok'> {
    this.subscribed = false
    this.link.channels.delete(this)
    return 'ok'
  }
}

export interface MachineLink {
  name: string
  ctx: MachineContext
  channels: Set<SimChannel>
  connected: boolean
  held: boolean
  queue: RealtimeEvent[]
  missed: RealtimeEvent[]
  inFlight: number
  /** Bumped on every disconnect: what was in flight on the old socket is lost with it. */
  epoch: number
  delivered: RealtimeEvent[]
  errors: unknown[]
}

export class RealtimeNetwork {
  latencyMs = 20
  fault: FaultPolicy = () => ({ kind: 'deliver' })
  private readonly links = new Map<string, MachineLink>()
  private seq = 0

  attach(name: string, ctx: MachineContext): MachineLink {
    const previous = this.links.get(name)
    const link: MachineLink = {
      name,
      ctx,
      channels: new Set(),
      connected: true,
      held: previous?.held ?? false,
      queue: [],
      missed: [],
      inFlight: 0,
      epoch: 0,
      delivered: [],
      errors: [],
    }
    this.links.set(name, link)
    return link
  }

  /** The machine went away (restart): its channels and anything queued for it are gone. */
  detach(name: string): void {
    const link = this.links.get(name)
    if (!link) return
    link.channels.clear()
    link.queue = []
    link.connected = false
  }

  link(name: string): MachineLink {
    const link = this.links.get(name)
    if (!link) throw new Error(`network: no machine ${name}`)
    return link
  }

  channel(link: MachineLink, name: string): SimChannel {
    return new SimChannel(name, link)
  }

  publish(events: Array<Omit<RealtimeEvent, 'seq'>>): void {
    for (const e of events) {
      const event = { ...e, seq: ++this.seq }
      for (const link of this.links.values()) {
        if (!link.connected) {
          if (link.channels.size > 0 || link.missed.length > 0) link.missed.push(event)
          continue
        }
        const decision = this.fault(event, link.name)
        if (decision.kind === 'drop') continue
        const copies = decision.kind === 'duplicate' ? 2 : 1
        for (let i = 0; i < copies; i++) this.enqueue(link, event, decision.kind === 'deliver' ? decision.delayMs ?? 0 : 0)
      }
    }
  }

  private enqueue(link: MachineLink, event: RealtimeEvent, extraDelayMs: number): void {
    if (link.held) {
      link.queue.push(event)
      return
    }
    link.inFlight += 1
    const epoch = link.epoch
    // Scheduled inside the receiving machine, so the handler and everything it awaits run there.
    runOn(link.ctx, () =>
      setTimeout(() => {
        link.inFlight -= 1
        if (link.epoch === epoch) this.deliver(link, event)
      }, this.latencyMs + extraDelayMs),
    )
  }

  private deliver(link: MachineLink, event: RealtimeEvent): void {
    if (!link.connected) return
    link.delivered.push(event)
    const payload: Row = {
      schema: 'public',
      table: event.table,
      eventType: event.eventType,
      new: structuredClone(event.new),
      old: structuredClone(event.old),
      commit_timestamp: event.commit_timestamp,
      errors: null,
    }
    runOn(link.ctx, () => {
      for (const channel of [...link.channels]) {
        if (!channel.subscribed) continue
        for (const { table, event: wanted, handler } of channel.handlers) {
          if (table && table !== event.table) continue
          if (wanted !== '*' && wanted !== event.eventType) continue
          try {
            handler(payload)
          } catch (error) {
            link.errors.push(error)
          }
        }
      }
    })
  }

  hold(name: string): void {
    this.link(name).held = true
  }

  /** Deliver what was held, in order or permuted by `order` (indexes into the held queue). */
  release(name: string, options: { order?: (count: number) => number[] } = {}): void {
    const link = this.link(name)
    link.held = false
    const queued = link.queue
    link.queue = []
    const order = options.order ? options.order(queued.length) : queued.map((_, i) => i)
    for (const i of order) this.enqueue(link, queued[i], 0)
  }

  /** The socket drops: supabase-js reports CHANNEL_ERROR on each channel and starts rejoining. */
  disconnect(name: string): void {
    const link = this.link(name)
    link.connected = false
    link.epoch += 1
    runOn(link.ctx, () => {
      for (const channel of [...link.channels]) channel.status?.('CHANNEL_ERROR')
    })
  }

  reconnect(name: string, options: { catchUp: boolean }): void {
    const link = this.link(name)
    link.connected = true
    const missed = link.missed
    link.missed = []
    if (options.catchUp) for (const event of missed) this.enqueue(link, event, 0)
    // The rejoin: each channel's status callback hears SUBSCRIBED again.
    runOn(link.ctx, () => {
      for (const channel of [...link.channels]) channel.status?.('SUBSCRIBED')
    })
  }

  /** Nothing in flight anywhere, ignoring held queues and disconnected machines. */
  idle(): boolean {
    for (const link of this.links.values()) if (link.inFlight > 0) return false
    return true
  }

  takeErrors(): unknown[] {
    const errors: unknown[] = []
    for (const link of this.links.values()) errors.push(...link.errors.splice(0))
    return errors
  }
}
