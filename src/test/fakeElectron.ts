/**
 * A fake disk, a fake SolidWorks service and the `window.electronAPI` that fronts them.
 *
 * Typed against `Window['electronAPI']` from `src/electron.d.ts`: every method here must have the
 * shape the preload exposes, so a renamed IPC or a changed response field fails to compile instead
 * of passing against an untyped fake. A method the code under test reaches for that is not
 * implemented returns `undefined` (the same as an older preload) and is recorded in `missing`, so
 * a test can assert on what it was never asked to model.
 *
 * The SolidWorks documents live beside the bytes: a write to a document's properties rewrites the
 * file on disk with a new hash and modified time, the way a Document Manager save does. That is
 * what makes "write to file, then check in" see new content.
 */
import { createHash } from 'node:crypto'

type ElectronAPI = Window['electronAPI']
type SolidWorksAPI = ElectronAPI['solidworks']

export interface SwConfiguration {
  name: string
  isActive?: boolean
  description?: string
  properties: Record<string, string>
}

export interface SwDocument {
  fileProperties: Record<string, string>
  configurations: SwConfiguration[]
}

export interface DiskEntry {
  /** The original-case absolute path. */
  path: string
  body: string
  readonly: boolean
  mtimeMs: number
  ino: number
  /** Present for SolidWorks documents; its properties are part of the bytes. */
  document?: SwDocument
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

const key = (path: string) => path.replace(/\//g, '\\').toLowerCase()

/** The bytes a document serializes to. Property order is normalized so a no-op write is a no-op. */
function serialize(entry: DiskEntry): string {
  if (!entry.document) return entry.body
  const sorted = (props: Record<string, string>) =>
    Object.fromEntries(Object.entries(props).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify({
    body: entry.body,
    file: sorted(entry.document.fileProperties),
    configurations: entry.document.configurations.map((c) => ({
      name: c.name,
      properties: sorted(c.properties),
    })),
  })
}

export class FakeDisk {
  private readonly entries = new Map<string, DiskEntry>()
  private nextIno = 1000
  clock = Date.parse('2026-10-20T09:00:00.000Z')

  tick(ms = 1000): number {
    this.clock += ms
    return this.clock
  }

  write(path: string, body: string, document?: SwDocument): DiskEntry {
    const existing = this.entries.get(key(path))
    const entry: DiskEntry = {
      path,
      body,
      readonly: existing?.readonly ?? false,
      mtimeMs: this.tick(),
      ino: existing?.ino ?? this.nextIno++,
      document: document ? structuredClone(document) : existing?.document,
    }
    this.entries.set(key(path), entry)
    return entry
  }

  get(path: string): DiskEntry | undefined {
    return this.entries.get(key(path))
  }

  require(path: string): DiskEntry {
    const entry = this.get(path)
    if (!entry) throw new Error(`fake disk: no file at ${path}`)
    return entry
  }

  rename(from: string, to: string): void {
    const entry = this.require(from)
    this.entries.delete(key(from))
    this.entries.set(key(to), { ...entry, path: to })
  }

  remove(path: string): void {
    this.entries.delete(key(path))
  }

  /** Mark a document's properties as saved: bytes, hash and modified time all move. */
  touch(path: string): void {
    this.require(path).mtimeMs = this.tick()
  }

  bytes(path: string): string {
    return serialize(this.require(path))
  }

  hash(path: string): string {
    return hashText(this.bytes(path))
  }

  all(): DiskEntry[] {
    return [...this.entries.values()]
  }
}

/** The service error codes the fake emits; wire-manifest.json must list each one. */
export const FAKE_SERVICE_ERROR_CODES = { readOnly: 'DM_FILE_READ_ONLY' } as const

/** Methods Electron's main process answers itself rather than forwarding to the service. */
export const ANSWERED_BY_MAIN = new Set(['getServiceStatus'])

/** The `solidworks.*` methods this fake implements, for the manifest check. */
export const FAKE_SOLIDWORKS_METHODS = [
  'getServiceStatus',
  'getOpenDocuments',
  'isDocumentOpen',
  'setDocumentReadOnly',
  'getReferences',
  'getConfigurations',
  'getProperties',
  'setProperties',
  'setPropertiesBatch',
] as const

/** A scripted answer for the next call to `action`, replayed before the model answers. */
export type ScriptedResponse = { action: keyof SolidWorksAPI; response: unknown }

export interface FakeElectron {
  api: ElectronAPI
  disk: FakeDisk
  /** Calls made, in order: `readFile`, `solidworks.setPropertiesBatch`, ... */
  calls: Array<{ method: string; args: unknown[] }>
  /** Methods the code under test reached for that the fake does not implement. */
  missing: Set<string>
  /** Queue an exact service response (a recorded one, or a failure) ahead of the model. */
  script(action: keyof SolidWorksAPI, response: unknown): void
  service: { running: boolean; documentManagerAvailable: boolean }
}

function recorded<T extends object>(
  target: T,
  prefix: string,
  calls: FakeElectron['calls'],
  missing: Set<string>,
): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(obj, prop, receiver)
      const value = Reflect.get(obj, prop, receiver)
      if (value === undefined) {
        if (prop !== 'then') missing.add(`${prefix}${prop}`)
        return undefined
      }
      if (typeof value !== 'function' || prop === 'solidworks') return value
      return (...args: unknown[]) => {
        calls.push({ method: `${prefix}${prop}`, args })
        return (value as (...a: unknown[]) => unknown).apply(obj, args)
      }
    },
  })
}

export function createFakeElectron(disk = new FakeDisk()): FakeElectron {
  const calls: FakeElectron['calls'] = []
  const missing = new Set<string>()
  const scripted: ScriptedResponse[] = []
  const service = { running: true, documentManagerAvailable: true }

  const takeScript = (action: keyof SolidWorksAPI): unknown => {
    const index = scripted.findIndex((s) => s.action === action)
    return index < 0 ? undefined : scripted.splice(index, 1)[0].response
  }

  const documentOf = (path: string) => {
    const entry = disk.get(path)
    if (!entry?.document) return { entry, error: `Could not open document: ${path}` }
    return { entry, document: entry.document }
  }

  const readOnlyRefusal = {
    success: false,
    error: 'The file is read-only',
    errorCode: FAKE_SERVICE_ERROR_CODES.readOnly,
  }

  const writeScope = (doc: SwDocument, properties: Record<string, string>, configuration?: string) => {
    if (!configuration) {
      Object.assign(doc.fileProperties, properties)
      return true
    }
    const target = doc.configurations.find((c) => c.name === configuration)
    if (!target) return false
    Object.assign(target.properties, properties)
    return true
  }

  const solidworks: Partial<SolidWorksAPI> = {
    async getServiceStatus() {
      return {
        success: true,
        data: {
          running: service.running,
          documentManagerAvailable: service.documentManagerAvailable,
          version: '1.21.2',
        },
      }
    },
    async getOpenDocuments() {
      return { success: true, data: { solidWorksRunning: false, documents: [], count: 0 } }
    },
    async isDocumentOpen(filePath) {
      return { success: true, data: { filePath, isOpen: false, solidWorksRunning: false } }
    },
    async setDocumentReadOnly() {
      return { success: false, error: 'SolidWorks is not running' }
    },
    async getReferences() {
      return { success: false, error: 'REFERENCES_UNRESOLVED' }
    },
    async getConfigurations(filePath) {
      const replay = takeScript('getConfigurations')
      if (replay) return replay as Awaited<ReturnType<SolidWorksAPI['getConfigurations']>>
      const { document, error } = documentOf(filePath)
      if (!document) return { success: false, error }
      const active = document.configurations.find((c) => c.isActive) ?? document.configurations[0]
      return {
        success: true,
        data: {
          filePath,
          activeConfiguration: active?.name ?? '',
          configurations: document.configurations.map((c) => ({
            name: c.name,
            isActive: c === active,
            description: c.description ?? '',
            properties: { ...c.properties },
          })),
          count: document.configurations.length,
        },
      }
    },
    async getProperties(filePath) {
      const replay = takeScript('getProperties')
      if (replay) return replay as Awaited<ReturnType<SolidWorksAPI['getProperties']>>
      const { document, error } = documentOf(filePath)
      if (!document) return { success: false, error }
      return {
        success: true,
        data: {
          filePath,
          fileProperties: { ...document.fileProperties },
          configurationProperties: Object.fromEntries(
            document.configurations.map((c) => [c.name, { ...c.properties }]),
          ),
          configurations: document.configurations.map((c) => c.name),
        },
      }
    },
    async setProperties(filePath, properties, configuration) {
      const replay = takeScript('setProperties')
      if (replay) return replay as Awaited<ReturnType<SolidWorksAPI['setProperties']>>
      const { entry, document, error } = documentOf(filePath)
      if (!document || !entry) return { success: false, error }
      if (entry.readonly) return readOnlyRefusal
      if (!writeScope(document, properties, configuration)) {
        return { success: false, error: `Configuration not found: ${configuration}` }
      }
      disk.touch(filePath)
      return {
        success: true,
        data: {
          filePath,
          propertiesSet: Object.keys(properties).length,
          configuration: configuration ?? '',
        },
      }
    },
    async setPropertiesBatch(filePath, configProperties) {
      const replay = takeScript('setPropertiesBatch')
      if (replay) return replay as Awaited<ReturnType<SolidWorksAPI['setPropertiesBatch']>>
      const { entry, document, error } = documentOf(filePath)
      if (!document || !entry) return { success: false, error }
      if (entry.readonly) return readOnlyRefusal
      const failedConfigurations: Record<string, string> = {}
      let processed = 0
      let propertiesSet = 0
      for (const [configuration, properties] of Object.entries(configProperties)) {
        if (writeScope(document, properties, configuration)) {
          processed += 1
          propertiesSet += Object.keys(properties).length
        } else {
          failedConfigurations[configuration] = 'Configuration not found'
        }
      }
      if (processed === 0) return { success: false, error: 'No configuration was written' }
      disk.touch(filePath)
      return {
        success: true,
        data: {
          filePath,
          configurationsProcessed: processed,
          failedConfigurations: Object.keys(failedConfigurations).length ? failedConfigurations : null,
          propertiesSet,
          propertiesFailed: 0,
          failedProperties: null,
        },
      }
    },
  }

  const api: Partial<ElectronAPI> = {
    log() {},
    async getMachineId() {
      return 'machine-test'
    },
    async getMachineName() {
      return 'TEST-PC'
    },
    async readFile(path) {
      const entry = disk.get(path)
      if (!entry) return { success: false, error: 'ENOENT' }
      const bytes = disk.bytes(path)
      return {
        success: true,
        data: Buffer.from(bytes).toString('base64'),
        hash: hashText(bytes),
        size: bytes.length,
      }
    },
    async hashFile(path) {
      const entry = disk.get(path)
      if (!entry) return { success: false, error: 'ENOENT' }
      return { success: true, hash: disk.hash(path), size: disk.bytes(path).length }
    },
    async fileExists(path) {
      return !!disk.get(path)
    },
    async checkFileLock() {
      return { success: true, locked: false }
    },
    async isReadonly(path) {
      const entry = disk.get(path)
      if (!entry) return { success: false, error: 'ENOENT' }
      return { success: true, readonly: entry.readonly }
    },
    async setReadonly(path, readonly) {
      const entry = disk.get(path)
      if (!entry) return { success: false, error: 'ENOENT' }
      entry.readonly = readonly
      return { success: true }
    },
    async setReadonlyBatch(files) {
      const results = files.map(({ path, readonly }) => {
        const entry = disk.get(path)
        if (!entry) return { path, success: false, error: 'ENOENT' }
        entry.readonly = readonly
        return { path, success: true }
      })
      return { success: results.every((r) => r.success), results }
    },
    async statFile(path) {
      const entry = disk.get(path)
      if (!entry) return { success: false, error: 'ENOENT' }
      return {
        success: true,
        size: disk.bytes(path).length,
        modifiedTime: new Date(entry.mtimeMs).toISOString(),
        isDirectory: false,
      }
    },
  }

  const fake: FakeElectron = {
    api: undefined as unknown as ElectronAPI,
    disk,
    calls,
    missing,
    service,
    script(action, response) {
      scripted.push({ action, response })
    },
  }
  const proxiedSolidworks = recorded(solidworks as SolidWorksAPI, 'solidworks.', calls, missing)
  fake.api = recorded({ ...api, solidworks: proxiedSolidworks } as ElectronAPI, '', calls, missing)
  return fake
}
