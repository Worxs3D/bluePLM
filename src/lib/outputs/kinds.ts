/**
 * Which outputs a file can have, and the organization's auto-generation setting. Pure.
 */

import type { ModelOutputKind, OrgOutputSettings, VersionOutputKind } from '@/types/versionOutputs'

const DRAWING = /\.slddrw$/i
const MODEL = /\.(sldprt|sldasm)$/i

export function isDrawingFile(path: string): boolean {
  return DRAWING.test(path)
}

/** A part or an assembly. */
export function isModelFile(path: string): boolean {
  return MODEL.test(path)
}

/**
 * The outputs a file of this path can have: drawings PDF, STEP (of the model the drawing shows,
 * named with the drawing's metadata) and DXF; parts and assemblies STEP, IGES, STL.
 */
export function outputKindsForPath(path: string): VersionOutputKind[] {
  if (isDrawingFile(path)) return ['pdf', 'step', 'dxf']
  if (isModelFile(path)) return ['step', 'iges', 'stl']
  return []
}

export function supportsOutputKind(path: string, kind: VersionOutputKind): boolean {
  return outputKindsForPath(path).includes(kind)
}

/**
 * Kinds exported with a configuration (STEP and STL); IGES and DXF export the saved one only. A
 * drawing's STEP exports the configuration its views show, so it takes none either.
 */
export function kindTakesConfiguration(kind: VersionOutputKind, path?: string): boolean {
  if (path && isDrawingFile(path)) return false
  return kind === 'step' || kind === 'stl'
}

/** The kinds a file gets a "Generate" row and a parent-column icon for: drawings PDF and STEP, models STEP. */
export function primaryOutputKinds(path: string): VersionOutputKind[] {
  if (isDrawingFile(path)) return ['pdf', 'step']
  if (isModelFile(path)) return ['step']
  return []
}

export function isModelOutputKind(kind: VersionOutputKind): kind is ModelOutputKind {
  return kind !== 'pdf'
}

/** The file extension of an output, without the dot. */
export function outputExtension(kind: VersionOutputKind): string {
  switch (kind) {
    case 'pdf':
      return 'pdf'
    case 'step':
      return 'step'
    case 'iges':
      return 'igs'
    case 'stl':
      return 'stl'
    case 'dxf':
      return 'dxf'
  }
}

/** The label a menu shows for a kind (file-format names, not translated). */
export function outputKindLabel(kind: VersionOutputKind): string {
  return kind.toUpperCase()
}

export interface AutoOutputSettings {
  pdf: boolean
  step: boolean
}

/** `organization.settings.outputs.auto_on_checkin` with its defaults (both on). */
export function autoOutputSettings(
  settings: { outputs?: OrgOutputSettings } | null | undefined,
): AutoOutputSettings {
  const auto = settings?.outputs?.auto_on_checkin
  return { pdf: auto?.pdf !== false, step: auto?.step !== false }
}
