/**
 * The "Open with references" pipeline against a fake desktop bridge: what is staged, retargeted,
 * made read-only and recorded, when a cache entry is reused, and when nothing is opened at all.
 * Real SOLIDWORKS (does it load every staged child, read-only) is not covered by any test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/reviews', () => ({ getVersionDependencyClosure: vi.fn() }))

import { joinLocalPath, packageRelativePath } from '@/lib/reviewPackage/layout'
import type { StageOptions } from '@/lib/reviewPackage/stage'
import type { MergedClosure, PackageFile, StagedFile } from '@/lib/reviewPackage/types'

import { EXPECTED_SW_SERVICE_VERSION } from '@/lib/swServiceVersion'

import { parseMarker } from './marker'
import { isOpenableWithReferences, openVersionWithReferences, type VersionOpenApi, type VersionOpenDeps } from './open'

const ROOT = '11111111-1111-4111-8111-111111111111'
const ENTRY = 'C:\\Users\\u\\AppData\\Roaming\\BluePLM\\version-open-cache\\v111111111111'

function pkg(id: string, path: string, hash: string, extra: Partial<PackageFile> = {}): PackageFile {
  return {
    fileVersionId: id,
    fileId: `f-${id}`,
    filePath: path,
    fileName: path.split('/').pop()!,
    version: 3,
    revision: 'A',
    contentHash: hash,
    fileSize: 10,
    exact: true,
    isRoot: id === ROOT,
    deleted: false,
    ...extra,
  }
}

const FILES = [
  pkg(ROOT, 'Top/Frame.SLDASM', 'hroot'),
  pkg('v-sub', 'Top/Sub.SLDASM', 'hsub'),
  pkg('v-part', 'Parts/Bolt.SLDPRT', 'hpart'),
]

function closureOf(files: PackageFile[] = FILES, extra: Partial<MergedClosure> = {}): MergedClosure {
  return { files, missing: [], conflicts: [], exact: files.every((f) => f.exact), totalBytes: 30, ...extra }
}

interface Fake {
  api: VersionOpenApi
  calls: string[]
  disk: Map<string, { size: number; modifiedTime: string }>
  marker: { value: string | null }
  opened: string[]
  serviceRunning: boolean
  serviceVersion: string
  openDocs: string[]
}

function fakeApi(): Fake {
  const f: Fake = {
    calls: [],
    disk: new Map(),
    marker: { value: null },
    opened: [],
    serviceRunning: true,
    serviceVersion: EXPECTED_SW_SERVICE_VERSION,
    openDocs: [],
    api: null as unknown as VersionOpenApi,
  }
  f.api = {
    versionOpen: {
      prepareEntry: async () => ({ success: true, path: ENTRY, marker: f.marker.value }),
      beginRestage: async () => {
        f.calls.push('beginRestage')
        f.marker.value = null
        return { success: true }
      },
      writeMarker: async (_entry: string, content: string) => {
        f.calls.push('writeMarker')
        f.marker.value = content
        return { success: true }
      },
    },
    statFile: async (path: string) => {
      const d = f.disk.get(path)
      return d ? { success: true, size: d.size, modifiedTime: d.modifiedTime } : { success: false }
    },
    setReadonlyBatch: async (files: Array<{ path: string; readonly: boolean }>) => {
      f.calls.push(`readonly:${files.length}`)
      return { success: true }
    },
    hashFile: async (path: string) => ({ success: true, hash: `retargeted:${path.split('\\').pop()}` }),
    openFile: async (path: string) => {
      f.opened.push(path)
      return { success: true }
    },
    solidworks: {
      getServiceStatus: async () => ({
        success: true,
        data: { running: f.serviceRunning, version: f.serviceVersion },
      }),
      getOpenDocuments: async () => ({
        success: true,
        data: { solidWorksRunning: true, documents: f.openDocs.map((filePath) => ({ filePath })) },
      }),
      retargetReferences: async (args: { packageRoot: string; files?: string[] }) => {
        f.calls.push(`retarget:${args.files?.length ?? 0}`)
        return {
          success: true,
          data: {
            packageRoot: args.packageRoot,
            files: (args.files ?? []).map((filePath) => ({ filePath, status: 'retargeted' as const, references: [] })),
            summary: { total: 0, retargeted: 0, unchanged: 0, failed: 0, missingReferences: 0 },
          },
        }
      },
    },
  } as unknown as VersionOpenApi
  return f
}

function deps(fake: Fake, closure: MergedClosure = closureOf(), stageResult?: (files: readonly PackageFile[], root: string) => StagedFile[]) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const stage = vi.fn(async (files: readonly PackageFile[], root: string, _options: StageOptions) => {
    const staged =
      stageResult?.(files, root) ??
      files.map((file) => {
        const packagePath = packageRelativePath(file.filePath)
        const localPath = joinLocalPath(root, packagePath)
        fake.disk.set(localPath, { size: file.fileSize, modifiedTime: `m-${file.contentHash}` })
        return { file, localPath, packagePath, status: 'downloaded' as const }
      })
    return staged
  })
  const d: VersionOpenDeps = {
    api: () => fake.api,
    closure: vi.fn(async () => closure),
    stage: stage as unknown as VersionOpenDeps['stage'],
    orgId: () => 'org-1',
    vaultRoots: () => ['C:\\Vault'],
    now: () => new Date('2026-11-04T10:00:00.000Z'),
  }
  return { d, stage }
}

let fake: Fake
beforeEach(() => {
  fake = fakeApi()
})

describe('isOpenableWithReferences', () => {
  it('takes parts, assemblies and drawings only', () => {
    expect(isOpenableWithReferences('a.SLDPRT')).toBe(true)
    expect(isOpenableWithReferences('a.sldasm')).toBe(true)
    expect(isOpenableWithReferences('a.SLDDRW')).toBe(true)
    expect(isOpenableWithReferences('a.pdf')).toBe(false)
    expect(isOpenableWithReferences('a.step')).toBe(false)
  })
})

describe('openVersionWithReferences', () => {
  it('stages the closure, retargets assemblies, makes it read-only, writes the marker last, opens the root', async () => {
    const { d, stage } = deps(fake)
    const result = await openVersionWithReferences(ROOT, {}, d)

    expect(result).toMatchObject({ status: 'opened', reused: false, exact: true, approximate: false })
    expect(stage).toHaveBeenCalledTimes(1)
    expect(stage.mock.calls[0][1]).toBe(ENTRY)
    expect(fake.calls).toEqual(['beginRestage', 'retarget:2', 'readonly:3', 'writeMarker'])
    expect(fake.opened).toEqual([`${ENTRY}\\Top\\Frame.SLDASM`])

    const marker = parseMarker(fake.marker.value)!
    expect(marker.fileVersionId).toBe(ROOT)
    expect(marker.rootPath).toBe('Top/Frame.SLDASM')
    expect(marker.files.map((f) => [f.path, f.packagedHash !== null])).toEqual([
      ['Top/Frame.SLDASM', true],
      ['Top/Sub.SLDASM', true],
      ['Parts/Bolt.SLDPRT', false],
    ])
  })

  it('reuses a complete entry without staging or retargeting', async () => {
    await openVersionWithReferences(ROOT, {}, deps(fake).d)
    fake.calls = []
    fake.opened = []
    const { d, stage } = deps(fake)
    const result = await openVersionWithReferences(ROOT, {}, d)

    expect(result).toMatchObject({ status: 'opened', reused: true })
    expect(stage).not.toHaveBeenCalled()
    expect(fake.calls).toEqual([])
    expect(fake.opened).toHaveLength(1)
  })

  it('restages when a staged file changed on disk, and hands the retargeted hashes to staging', async () => {
    await openVersionWithReferences(ROOT, {}, deps(fake).d)
    fake.disk.set(`${ENTRY}\\Parts\\Bolt.SLDPRT`, { size: 999, modifiedTime: 'later' })
    const { d, stage } = deps(fake)
    const result = await openVersionWithReferences(ROOT, {}, d)

    expect(result).toMatchObject({ status: 'opened', reused: false })
    const previous = stage.mock.calls[0]![2].previousPackagedHashes as Map<string, string>
    expect(previous.get('top/frame.sldasm|hroot')).toBe('retargeted:Frame.SLDASM')
  })

  it('restages when the closure is no longer the one the entry was staged from', async () => {
    await openVersionWithReferences(ROOT, {}, deps(fake).d)
    const changed = closureOf([FILES[0], FILES[1], pkg('v-part2', 'Parts/Bolt.SLDPRT', 'hpart2')])
    const { d, stage } = deps(fake, changed)
    await openVersionWithReferences(ROOT, {}, d)
    expect(stage).toHaveBeenCalledTimes(1)
  })

  it('opens an approximate closure and says so', async () => {
    const approx = closureOf([FILES[0], pkg('v-sub', 'Top/Sub.SLDASM', 'hsub', { exact: false })])
    const result = await openVersionWithReferences(ROOT, {}, deps(fake, approx).d)
    expect(result).toMatchObject({ status: 'opened', exact: false, approximate: true })
  })

  it('reports missing references and conflicts with the open', async () => {
    const closure = closureOf(FILES, {
      exact: false,
      missing: [{ referencePath: 'C:/Toolbox/screw.sldprt', parentPath: null, parentVersionId: null, referenceType: 'component' }],
      conflicts: [
        { filePath: 'Parts/Bolt.SLDPRT', keptFileVersionId: 'a', keptVersion: 2, droppedFileVersionId: 'b', droppedVersion: 1 },
      ],
    })
    const result = await openVersionWithReferences(ROOT, {}, deps(fake, closure).d)
    expect(result).toMatchObject({ status: 'opened', exact: false, approximate: false, missing: 1, conflicts: 1 })
  })

  it('refuses while a same-named document is open outside the entry', async () => {
    fake.openDocs = ['C:\\Vault\\Parts\\Bolt.SLDPRT']
    const { d, stage } = deps(fake)
    const result = await openVersionWithReferences(ROOT, {}, d)
    expect(result).toEqual({ status: 'same_name_open', documents: ['C:\\Vault\\Parts\\Bolt.SLDPRT'] })
    expect(stage).not.toHaveBeenCalled()
    expect(fake.opened).toEqual([])
  })

  it('does not count documents already open from the entry itself', async () => {
    fake.openDocs = [`${ENTRY}\\Top\\Frame.SLDASM`]
    const result = await openVersionWithReferences(ROOT, {}, deps(fake).d)
    expect(result.status).toBe('opened')
  })

  it('needs the service to retarget an assembly, and opens nothing without it', async () => {
    fake.serviceRunning = false
    expect(await openVersionWithReferences(ROOT, {}, deps(fake).d)).toEqual({
      status: 'needs_service',
      reason: 'service_offline',
    })
    fake.serviceRunning = true
    fake.serviceVersion = '1.20.0'
    expect(await openVersionWithReferences(ROOT, {}, deps(fake).d)).toEqual({
      status: 'needs_service',
      reason: 'service_outdated',
    })
    expect(fake.opened).toEqual([])
  })

  it('opens a part with no references without the service', async () => {
    fake.serviceRunning = false
    const partId = '22222222-2222-4222-8222-222222222222'
    const part = closureOf([pkg(partId, 'Parts/Plate.SLDPRT', 'hplate', { isRoot: true })])
    const result = await openVersionWithReferences(partId, {}, deps(fake, part).d)
    expect(result).toMatchObject({ status: 'opened', exact: true })
    expect(fake.calls).not.toContain('retarget:0')
  })

  it('fails without opening when a file cannot be staged, and writes no marker', async () => {
    const { d } = deps(fake, closureOf(), (files, root) =>
      files.map((file, i) => ({
        file,
        localPath: joinLocalPath(root, packageRelativePath(file.filePath)),
        packagePath: packageRelativePath(file.filePath),
        status: i === 2 ? ('failed' as const) : ('downloaded' as const),
        error: i === 2 ? 'HTTP 404' : undefined,
      })),
    )
    const result = await openVersionWithReferences(ROOT, {}, d)
    expect(result).toMatchObject({ status: 'failed', failedFiles: ['Parts/Bolt.SLDPRT'] })
    expect(fake.marker.value).toBeNull()
    expect(fake.opened).toEqual([])
  })

  it('is unsupported for a version that is not a SOLIDWORKS document', async () => {
    const pdf = closureOf([pkg(ROOT, 'Docs/spec.pdf', 'hpdf')])
    expect(await openVersionWithReferences(ROOT, {}, deps(fake, pdf).d)).toEqual({ status: 'unsupported' })
  })

  it('stops when cancelled', async () => {
    const result = await openVersionWithReferences(ROOT, { isCancelled: () => true }, deps(fake).d)
    expect(result).toEqual({ status: 'cancelled' })
    expect(fake.opened).toEqual([])
  })

  it('joins a second open of the same version while the first runs', async () => {
    const { d, stage } = deps(fake)
    const [a, b] = await Promise.all([openVersionWithReferences(ROOT, {}, d), openVersionWithReferences(ROOT, {}, d)])
    expect(a).toBe(b)
    expect(stage).toHaveBeenCalledTimes(1)
  })

  it('never throws', async () => {
    const { d } = deps(fake)
    d.closure = async () => {
      throw new Error('offline')
    }
    expect(await openVersionWithReferences(ROOT, {}, d)).toEqual({ status: 'failed', error: 'offline' })
  })
})
