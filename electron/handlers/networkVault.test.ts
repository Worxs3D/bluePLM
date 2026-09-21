import { describe, expect, it } from 'vitest'
import { credentialTargetForNetworkRoot } from './networkVault'

describe('credentialTargetForNetworkRoot', () => {
  it.each([
    ['\\\\fileserver\\BluePLM', 'fileserver'],
    [' \\\\nas.worxs3d.local\\vault\\engineering ', 'nas.worxs3d.local'],
  ])('derives the SMB server from %s', (networkRoot, expected) => {
    expect(credentialTargetForNetworkRoot(networkRoot)).toBe(expected)
  })

  it.each(['Z:\\BluePLM', '\\\\fileserver', '\\\\..\\share', '\\\\server;bad\\share'])(
    'refuses an unsafe or ambiguous root %s',
    (networkRoot) => {
      expect(credentialTargetForNetworkRoot(networkRoot)).toBeNull()
    },
  )
})
