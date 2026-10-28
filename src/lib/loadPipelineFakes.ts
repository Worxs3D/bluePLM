/**
 * Counting fakes for the edges of the load pipeline, shared by the allocation harness
 * (loadPipeline.alloc.harness.test.ts) and the performance gate (src/perf/*.perf.test.ts).
 *
 * Each fake does the real work of the thing it stands in for, as far as cost goes (IndexedDB
 * structured-clones on put and get, a Supabase response is a fresh copy), and counts every call,
 * so a test can assert how many round trips an operation makes and how that grows with the vault.
 * Nothing here imports app code, so a `vi.mock` factory can import this module.
 */

// ---------------------------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------------------------

export interface IndexedDbCounters {
  opens: number
  gets: number
  puts: number
  deletes: number
  clears: number
  getAlls: number
  /** Records handed back by getAll / getAllKeys. */
  getAllRows: number
  /** Rows written: a put of `{ files: [...] }` counts its files, any other put counts one. */
  putRows: number
}

export interface FakeIndexedDb {
  /** Per database name. */
  counters: Map<string, IndexedDbCounters>
  counter: (dbName: string) => IndexedDbCounters
  reset: () => void
}

function emptyIndexedDbCounters(): IndexedDbCounters {
  return { opens: 0, gets: 0, puts: 0, deletes: 0, clears: 0, getAlls: 0, getAllRows: 0, putRows: 0 }
}

class FakeRequest {
  result: unknown = undefined
  error: unknown = null
  onsuccess: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onblocked: ((event: unknown) => void) | null = null
  onupgradeneeded: ((event: unknown) => void) | null = null
}

function settle(request: FakeRequest, result: unknown): FakeRequest {
  queueMicrotask(() => {
    request.result = result
    request.onsuccess?.({ target: request })
  })
  return request
}

interface StoreData {
  keyPath: string
  records: Map<unknown, unknown>
  indexes: Map<string, string>
}

/**
 * An in-memory IndexedDB covering what the app's caches use: object stores with a keyPath,
 * property indexes queried with getAll / getAllKeys over `IDBKeyRange.only`, get / put / delete /
 * clear, transactions with `oncomplete`, and deleteDatabase. Installs `indexedDB` and
 * `IDBKeyRange` on globalThis.
 */
export function installFakeIndexedDB(): FakeIndexedDb {
  const databases = new Map<string, Map<string, StoreData>>()
  const counters = new Map<string, IndexedDbCounters>()
  const counter = (dbName: string) => {
    let value = counters.get(dbName)
    if (!value) {
      value = emptyIndexedDbCounters()
      counters.set(dbName, value)
    }
    return value
  }

  const matchesRange = (value: unknown, range: unknown) =>
    range === undefined || range === null || (range as { value: unknown }).value === value

  const makeStore = (dbName: string, data: StoreData) => {
    const count = () => counter(dbName)
    const matching = (property: string, range: unknown) =>
      [...data.records.values()].filter((record) =>
        matchesRange((record as Record<string, unknown>)[property], range),
      )
    return {
      createIndex(name: string, property: string) {
        data.indexes.set(name, property)
      },
      index(name: string) {
        const property = data.indexes.get(name) ?? name
        return {
          getAll(range?: unknown) {
            const rows = matching(property, range)
            count().getAlls += 1
            count().getAllRows += rows.length
            return settle(new FakeRequest(), rows.map((row) => structuredClone(row)))
          },
          getAllKeys(range?: unknown) {
            const rows = matching(property, range)
            count().getAlls += 1
            count().getAllRows += rows.length
            return settle(
              new FakeRequest(),
              rows.map((row) => (row as Record<string, unknown>)[data.keyPath]),
            )
          },
        }
      },
      get(key: unknown) {
        count().gets += 1
        // The real IndexedDB hands back a deserialised copy.
        return settle(new FakeRequest(), structuredClone(data.records.get(key)))
      },
      getAll() {
        const rows = [...data.records.values()]
        count().getAlls += 1
        count().getAllRows += rows.length
        return settle(new FakeRequest(), rows.map((row) => structuredClone(row)))
      },
      put(value: Record<string, unknown>) {
        count().puts += 1
        count().putRows += Array.isArray(value.files) ? value.files.length : 1
        // ... and stores a serialised one.
        data.records.set(value[data.keyPath], structuredClone(value))
        return settle(new FakeRequest(), value[data.keyPath])
      },
      delete(key: unknown) {
        count().deletes += 1
        data.records.delete(key)
        return settle(new FakeRequest(), undefined)
      },
      clear() {
        count().clears += 1
        data.records.clear()
        return settle(new FakeRequest(), undefined)
      },
    }
  }

  const makeDb = (dbName: string) => {
    const stores = databases.get(dbName)!
    const db = {
      name: dbName,
      onclose: null as (() => void) | null,
      onversionchange: null as (() => void) | null,
      objectStoreNames: { contains: (name: string) => stores.has(name) },
      createObjectStore(name: string, options?: { keyPath?: string }) {
        const data: StoreData = { keyPath: options?.keyPath ?? 'id', records: new Map(), indexes: new Map() }
        stores.set(name, data)
        return makeStore(dbName, data)
      },
      deleteObjectStore(name: string) {
        stores.delete(name)
      },
      transaction() {
        const transaction = {
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onabort: null as (() => void) | null,
          error: null,
          objectStore: (name: string) => {
            const data = stores.get(name)
            if (!data) throw new Error(`fake IndexedDB: no object store ${name} in ${dbName}`)
            return makeStore(dbName, data)
          },
          abort: () => {
            transaction.onabort?.()
          },
        }
        // After the requests queued in this tick have settled, like a real transaction.
        setTimeout(() => transaction.oncomplete?.(), 0)
        return transaction
      },
      close: () => undefined,
    }
    return db
  }

  const globals = globalThis as { indexedDB?: unknown; IDBKeyRange?: unknown }
  globals.indexedDB = {
    open(name: string) {
      const request = new FakeRequest()
      counter(name).opens += 1
      const isNew = !databases.has(name)
      if (isNew) databases.set(name, new Map())
      queueMicrotask(() => {
        const db = makeDb(name)
        request.result = db
        if (isNew) request.onupgradeneeded?.({ target: request })
        request.onsuccess?.({ target: request })
      })
      return request
    },
    deleteDatabase(name: string) {
      databases.delete(name)
      return settle(new FakeRequest(), undefined)
    },
  }
  globals.IDBKeyRange = { only: (value: unknown) => ({ value }) }

  return { counters, counter, reset: () => counters.clear() }
}

// ---------------------------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------------------------

export interface RecordedQuery {
  kind: 'rpc' | 'table' | 'storage'
  /** RPC name, table name, or storage bucket. */
  name: string
  /** select / insert / update / upsert / delete for a table; the method for storage and rpc. */
  op: string
  filters: Array<[string, unknown[]]>
  args?: unknown
  payload?: unknown
}

export interface QueryResponse {
  data?: unknown
  error?: unknown
  count?: number | null
}

export type QueryResponder = (query: RecordedQuery) => QueryResponse | Promise<QueryResponse>

export interface RecordingSupabase {
  /** Stands in for the SupabaseClient; anything not modelled here records a call and resolves empty. */
  client: unknown
  calls: RecordedQuery[]
  setResponder: (responder: QueryResponder) => void
  reset: () => void
  /** Calls grouped as `rpc:name`, `table:name:op` or `storage:bucket:op`. */
  summary: () => Record<string, number>
}

const TABLE_OPS = new Set(['select', 'insert', 'update', 'upsert', 'delete'])

export function createRecordingSupabase(): RecordingSupabase {
  const calls: RecordedQuery[] = []
  let responder: QueryResponder = () => ({ data: null, error: null })

  const respond = (query: RecordedQuery) => {
    calls.push(query)
    return Promise.resolve(responder(query)).then((response) => ({
      data: response.data ?? null,
      error: response.error ?? null,
      count: response.count ?? null,
    }))
  }

  const tableBuilder = (table: string) => {
    const query: RecordedQuery = { kind: 'table', name: table, op: 'select', filters: [] }
    let opSet = false
    let pending: Promise<QueryResponse> | null = null
    const run = () => (pending ??= respond(query))
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === 'then') {
            return (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
              run().then(onFulfilled, onRejected)
          }
          if (typeof prop !== 'string') return undefined
          return (...args: unknown[]) => {
            if (TABLE_OPS.has(prop) && !(prop === 'select' && opSet)) {
              query.op = prop
              opSet = true
              if (prop !== 'select' && prop !== 'delete') query.payload = args[0]
            } else {
              query.filters.push([prop, args])
            }
            return builder
          }
        },
      },
    )
    return builder
  }

  const storageBucket = (bucket: string) =>
    new Proxy(
      {},
      {
        get(_, prop) {
          if (typeof prop !== 'string' || prop === 'then') return undefined
          return (...args: unknown[]) =>
            respond({ kind: 'storage', name: bucket, op: prop, filters: [], args })
        },
      },
    )

  const channel = () => {
    const subscription: Record<string, unknown> = {
      on: () => subscription,
      subscribe: () => subscription,
      unsubscribe: () => Promise.resolve('ok'),
    }
    return subscription
  }

  const client = new Proxy(
    {
      from: (table: string) => tableBuilder(table),
      rpc: (name: string, args?: unknown) => respond({ kind: 'rpc', name, op: 'rpc', filters: [], args }),
      storage: { from: (bucket: string) => storageBucket(bucket) },
      channel,
      removeChannel: () => Promise.resolve('ok'),
      removeAllChannels: () => Promise.resolve([]),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        getUser: () => Promise.resolve({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
    } as Record<string, unknown>,
    {
      get(target, prop) {
        if (typeof prop === 'string' && prop in target) return target[prop]
        return undefined
      },
    },
  )

  return {
    client,
    calls,
    setResponder: (next) => {
      responder = next
    },
    reset: () => {
      calls.length = 0
    },
    summary: () => {
      const out: Record<string, number> = {}
      for (const call of calls) {
        const key =
          call.kind === 'rpc' ? `rpc:${call.name}` : `${call.kind}:${call.name}:${call.op}`
        out[key] = (out[key] ?? 0) + 1
      }
      return out
    },
  }
}

/** One client per test file: `vi.mock('@/lib/supabase/client')` factories hand this out. */
export const recordingSupabase = createRecordingSupabase()

// ---------------------------------------------------------------------------------------------
// electronAPI (IPC)
// ---------------------------------------------------------------------------------------------

export interface CountingElectronApi {
  api: Record<string, unknown>
  /** Calls per method name. */
  calls: Map<string, number>
  /** Items handed to computeFileHashes, summed over every call. */
  hashRequestItems: () => number
  /** Calls excluding `log`. */
  functionalCalls: () => number
  reset: () => void
}

type ElectronMethod = (...args: unknown[]) => unknown

/**
 * A `window.electronAPI` that counts every call. Methods in `implementations` run as given; any
 * other method resolves `{ success: true }`, so a call nobody expected is still counted instead of
 * crashing the run.
 */
export function createCountingElectronApi(
  implementations: Record<string, ElectronMethod>,
): CountingElectronApi {
  const calls = new Map<string, number>()
  let hashItems = 0
  const record = (name: string) => calls.set(name, (calls.get(name) ?? 0) + 1)

  const api = new Proxy({} as Record<string, unknown>, {
    get(_, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined
      return (...args: unknown[]) => {
        record(prop)
        if (prop === 'computeFileHashes' && Array.isArray(args[0])) hashItems += args[0].length
        const implementation = implementations[prop]
        return implementation ? implementation(...args) : Promise.resolve({ success: true })
      }
    },
  })

  return {
    api,
    calls,
    hashRequestItems: () => hashItems,
    functionalCalls: () => {
      let total = 0
      for (const [name, count] of calls) if (name !== 'log') total += count
      return total
    },
    reset: () => {
      calls.clear()
      hashItems = 0
    },
  }
}

// ---------------------------------------------------------------------------------------------
// localStorage (the persist middleware's backing storage)
// ---------------------------------------------------------------------------------------------

export interface CountingStorage {
  storage: { getItem: (name: string) => string | null; setItem: (name: string, value: string) => void; removeItem: (name: string) => void }
  setItemCalls: () => number
  setItemBytes: () => number
  lastBytes: () => number
  reset: () => void
}

export function createCountingStorage(): CountingStorage {
  const values = new Map<string, string>()
  let writes = 0
  let bytes = 0
  let last = 0
  return {
    storage: {
      getItem: (name) => values.get(name) ?? null,
      setItem: (name, value) => {
        writes += 1
        bytes += value.length
        last = value.length
        values.set(name, value)
      },
      removeItem: (name) => {
        values.delete(name)
      },
    },
    setItemCalls: () => writes,
    setItemBytes: () => bytes,
    lastBytes: () => last,
    reset: () => {
      writes = 0
      bytes = 0
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------------------------

/**
 * How much faster than the input a measure grew between two sizes: 1 is linear, the size ratio
 * is quadratic. `growthOver(10, 100, 1_000, 10_000)` is 1.
 */
export function growthOver(smallValue: number, largeValue: number, smallSize: number, largeSize: number): number {
  const sizeRatio = largeSize / smallSize
  if (smallValue === 0) return largeValue === 0 ? 0 : Number.POSITIVE_INFINITY
  return largeValue / smallValue / sizeRatio
}
