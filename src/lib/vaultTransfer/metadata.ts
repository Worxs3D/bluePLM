/**
 * The metadata a transferred file carries into the destination vault.
 *
 * What the user sees is what travels: the overlay's value, so a part number the user cleared on
 * the source stays cleared and an edit that has not been checked in yet is not lost. Everything
 * else the row holds in `custom_properties` comes along, with the two per-configuration maps
 * resolved through the same overlay.
 *
 * Pure, like the overlay it builds on.
 */

import { CONFIG_DESCRIPTIONS_KEY, CONFIG_TABS_KEY } from '@/lib/metadata/divergence'
import {
  resolveConfigurationDescriptions,
  resolveConfigurationTabs,
  resolveFileMetadata,
} from '@/lib/metadata/overlay'
import type { LocalFile } from '@/stores/types'
import type { Json } from '@/types/supabase'

export interface TransferMetadata {
  partNumber: string | null
  description: string | null
  revision: string | null
  customProperties: { [key: string]: Json | undefined }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A JSON-shaped deep copy, so the destination row never shares structure with the source row. */
function cloneCustomProperties(value: unknown): { [key: string]: Json | undefined } {
  if (!isPlainObject(value)) return {}
  return JSON.parse(JSON.stringify(value)) as { [key: string]: Json | undefined }
}

export function buildTransferMetadata(file: LocalFile): TransferMetadata {
  const { partNumber, description, revision } = resolveFileMetadata(file)
  const customProperties = cloneCustomProperties(file.pdmData?.custom_properties)

  const tabs = resolveConfigurationTabs(file)
  if (Object.keys(tabs).length > 0) customProperties[CONFIG_TABS_KEY] = tabs

  const descriptions = resolveConfigurationDescriptions(file)
  if (Object.keys(descriptions).length > 0) customProperties[CONFIG_DESCRIPTIONS_KEY] = descriptions

  return {
    partNumber: partNumber.value,
    description: description.value,
    revision: revision.value,
    customProperties,
  }
}
