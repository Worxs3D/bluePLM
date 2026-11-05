import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: () => ({}) }))
vi.mock('@/lib/supabase/versionOutputs', () => ({ listOutputsForVersions: vi.fn() }))

import type { SupplyOrderLine } from '@/types/orders'
import type { OutputRequest } from '@/types/outputRequests'
import type { VersionOutput } from '@/types/versionOutputs'

import { lineKindSource, resolveLineOutputs, type ResolveOutputsDeps } from './outputs'

function orderLine(p: Partial<SupplyOrderLine> = {}): SupplyOrderLine {
  return {
    id: 'line-1',
    orderId: 'order-1',
    orgId: 'org',
    position: 1,
    fileId: 'part',
    fileVersionId: 'part-v2',
    vaultId: 'vault',
    drawingVaultId: null,
    configuration: null,
    drawingFileId: null,
    drawingVersionId: null,
    quantity: 1,
    outputKinds: ['step'],
    notes: null,
    fileName: 'Bracket.SLDPRT',
    partNumber: 'BR-1',
    description: 'Bracket',
    revision: 'A',
    version: 2,
    drawingFileName: null,
    drawingVersion: null,
    sentOutputs: null,
    missingKinds: null,
    addedBy: null,
    addedAt: '2026-01-01T00:00:00Z',
    updatedAt: null,
    ...p,
  }
}

function output(p: Partial<VersionOutput> & Pick<VersionOutput, 'kind' | 'fileId' | 'fileVersionId'>): VersionOutput {
  return {
    id: `${p.fileVersionId}-${p.kind}`,
    configuration: null,
    storageHash: `${p.fileVersionId}-${p.kind}-hash`,
    fileSize: 10,
    fileName: null,
    closureExact: true,
    generatedBy: null,
    generatedAt: 'now',
    ...p,
  }
}

const withDrawing = orderLine({
  drawingFileId: 'drw',
  drawingVersionId: 'drw-v4',
  drawingFileName: 'Bracket.SLDDRW',
  drawingVersion: 4,
  configuration: 'Long',
  outputKinds: ['pdf', 'step', 'source'],
})

describe('lineKindSource', () => {
  it('takes drawing exports from the drawing version and model exports from the model', () => {
    expect(lineKindSource(withDrawing, 'pdf')).toMatchObject({ fileVersionId: 'drw-v4', version: 4, configuration: null })
    expect(lineKindSource(withDrawing, 'dxf')).toMatchObject({ fileVersionId: 'drw-v4' })
    expect(lineKindSource(withDrawing, 'step')).toMatchObject({ fileVersionId: 'part-v2', configuration: 'Long' })
    expect(lineKindSource(withDrawing, 'stl')).toMatchObject({ configuration: 'Long' })
    // IGES exports the saved configuration only.
    expect(lineKindSource(withDrawing, 'iges')).toMatchObject({ configuration: null })
    expect(lineKindSource(withDrawing, 'source')).toMatchObject({ fileVersionId: 'part-v2' })
  })

  it('gives a part without a drawing no PDF or DXF', () => {
    const part = orderLine()
    expect(lineKindSource(part, 'pdf')).toBeNull()
    expect(lineKindSource(part, 'dxf')).toBeNull()
  })

  it('takes a drawing-only line\'s PDF, DXF and STEP from the drawing itself', () => {
    const drawing = orderLine({ fileId: 'drw', fileVersionId: 'drw-v1', fileName: 'A.SLDDRW', version: 1 })
    expect(lineKindSource(drawing, 'pdf')).toMatchObject({ fileVersionId: 'drw-v1' })
    expect(lineKindSource(drawing, 'step')).toMatchObject({ fileVersionId: 'drw-v1' })
    expect(lineKindSource(drawing, 'iges')).toBeNull()
  })
})

describe('resolveLineOutputs', () => {
  const deps = (outputs: VersionOutput[], contents: Record<string, string> = {}): ResolveOutputsDeps => ({
    outputsForVersions: vi.fn(async (ids: readonly string[]) => {
      const map = new Map<string, VersionOutput[]>()
      for (const o of outputs) if (ids.includes(o.fileVersionId)) map.set(o.fileVersionId, [...(map.get(o.fileVersionId) ?? []), o])
      return map
    }),
    versionContent: vi.fn(async (ids: readonly string[]) => {
      const map = new Map<string, { contentHash: string; fileSize: number }>()
      for (const id of ids) if (contents[id]) map.set(id, { contentHash: contents[id], fileSize: 7 })
      return map
    }),
  })

  it('marks every kind ready, missing or unsupported, with the line\'s kinds included', async () => {
    const d = deps(
      [
        output({ kind: 'pdf', fileId: 'drw', fileVersionId: 'drw-v4' }),
        // The saved configuration's STEP is not the configured line's.
        output({ kind: 'step', fileId: 'part', fileVersionId: 'part-v2' }),
        output({ kind: 'stl', fileId: 'part', fileVersionId: 'part-v2', configuration: 'Long', fileName: 'B.stl' }),
      ],
      { 'part-v2': 'source-hash' },
    )
    const states = (await resolveLineOutputs([withDrawing], d)).get('line-1')!
    expect(states.map((s) => [s.kind, s.status, s.included])).toEqual([
      ['pdf', 'ready', true],
      ['step', 'missing', true],
      ['iges', 'missing', false],
      ['stl', 'ready', false],
      ['dxf', 'missing', false],
      ['source', 'ready', true],
    ])
    expect(states.find((s) => s.kind === 'source')?.output).toEqual({
      storageHash: 'source-hash',
      fileSize: 7,
      fileName: 'Bracket.SLDPRT',
    })
  })

  it('lists a purged file\'s kinds as missing, not unsupported', async () => {
    const purged = orderLine({
      fileId: null,
      fileVersionId: null,
      drawingFileName: 'Bracket.SLDDRW',
      outputKinds: ['pdf', 'step'],
    })
    const states = (await resolveLineOutputs([purged], deps([]))).get('line-1')!
    expect(states.filter((s) => s.included).map((s) => [s.kind, s.status])).toEqual([
      ['pdf', 'missing'],
      ['step', 'missing'],
    ])
  })

  it('answers a sent line from what was recorded, without reading', async () => {
    const d = deps([output({ kind: 'step', fileId: 'part', fileVersionId: 'part-v2', storageHash: 'newer' })])
    const sent = orderLine({
      outputKinds: ['step', 'pdf'],
      sentOutputs: [{ kind: 'step', storageHash: 'sent-hash', fileSize: 3, fileName: 'BR-1.step' }],
      missingKinds: ['pdf'],
    })
    const states = (await resolveLineOutputs([sent], d)).get('line-1')!
    expect(states.find((s) => s.kind === 'step')).toEqual({
      kind: 'step',
      status: 'ready',
      included: true,
      output: { storageHash: 'sent-hash', fileSize: 3, fileName: 'BR-1.step' },
    })
    expect(states.find((s) => s.kind === 'pdf')?.status).toBe('unsupported')
    expect(d.outputsForVersions).not.toHaveBeenCalled()
  })
})

describe('resolveLineOutputs with output requests', () => {
  const request = (p: Partial<OutputRequest> & Pick<OutputRequest, 'fileVersionId' | 'kind'>): OutputRequest => ({
    id: `${p.fileVersionId}-${p.kind}-req`,
    orgId: 'org',
    vaultId: 'vault',
    configuration: null,
    status: 'pending',
    requestedBy: 'u1',
    requestedAt: '2026-11-04T10:00:00Z',
    claimedBy: null,
    claimedAt: null,
    finishedAt: null,
    error: null,
    orderId: null,
    ...p,
  })

  it('marks a missing kind with a pending or claimed request as requested, matched on version, kind and configuration', async () => {
    const activeRequests = vi.fn(async () => [
      request({ fileVersionId: 'drw-v4', kind: 'pdf', status: 'claimed' }),
      // The saved configuration's STEP is not what the configured line needs.
      request({ fileVersionId: 'part-v2', kind: 'step' }),
      request({ fileVersionId: 'part-v2', kind: 'stl', configuration: 'Long' }),
      // A finished request is not waiting for anything.
      request({ fileVersionId: 'part-v2', kind: 'iges', status: 'failed' }),
    ])
    const d: ResolveOutputsDeps = {
      outputsForVersions: vi.fn(async () => new Map()),
      versionContent: vi.fn(async () => new Map()),
      activeRequests,
    }
    const states = (await resolveLineOutputs([withDrawing], d)).get('line-1')!
    expect(states.map((s) => [s.kind, s.status])).toEqual([
      ['pdf', 'requested'],
      ['step', 'missing'],
      ['iges', 'missing'],
      ['stl', 'requested'],
      ['dxf', 'missing'],
      ['source', 'missing'],
    ])
    expect(states[0].request).toEqual({
      id: 'drw-v4-pdf-req',
      status: 'claimed',
      requestedBy: 'u1',
      requestedAt: '2026-11-04T10:00:00Z',
    })
    expect(activeRequests).toHaveBeenCalledWith(expect.arrayContaining(['drw-v4', 'part-v2']))
  })

  it('keeps an output that exists ready, whatever is requested', async () => {
    const d: ResolveOutputsDeps = {
      outputsForVersions: vi.fn(async () => new Map([['drw-v4', [output({ kind: 'pdf', fileId: 'drw', fileVersionId: 'drw-v4' })]]])),
      versionContent: vi.fn(async () => new Map()),
      activeRequests: vi.fn(async () => [request({ fileVersionId: 'drw-v4', kind: 'pdf' })]),
    }
    const states = (await resolveLineOutputs([withDrawing], d)).get('line-1')!
    expect(states[0]).toMatchObject({ kind: 'pdf', status: 'ready' })
  })
})
