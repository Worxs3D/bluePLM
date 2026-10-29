import { afterEach, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createMdbAuthAuthority } from './mdbAuthAuthority'
import {
  createMdbEncryptedAuthRecordStore,
  createSafeStorageMdbAuthPersistence,
} from './mdbAuthPersistence'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
it('confirms absence after clear and handles a previously missing record', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdb-auth-test-'))
  roots.push(root)
  const file = path.join(root, 'session.enc')
  const store = createMdbEncryptedAuthRecordStore(file)
  await store.clear()
  await store.write(new Uint8Array([1, 2, 3]))
  await store.clear()
  expect(await createMdbEncryptedAuthRecordStore(file).read()).toBeNull()
})
it('fails closed when encryption is unavailable and propagates clear IO errors', async () => {
  const store = {
    read: async () => null,
    write: async () => {},
    clear: async () => {
      throw new Error('IO failure')
    },
  }
  const persistence = createSafeStorageMdbAuthPersistence(
    {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    },
    store,
  )
  await expect(persistence.load()).resolves.toBeNull()
  await expect(
    persistence.save({
      serverUrl: 'https://example.test/',
      bearerToken: 'test',
      expiresAt: '2099-01-01T00:00:00Z',
      principal: {
        userId: 'u',
        organizationId: 'o',
        email: 'a',
        displayName: 'A',
        role: 'member',
        createdAt: '2026-01-01T00:00:00Z',
      },
      organization: { id: 'o', name: 'O', slug: 'o', createdAt: '2026-01-01T00:00:00Z' },
    }),
  ).rejects.toThrow('encryption unavailable')
  await expect(persistence.clear()).rejects.toThrow('IO failure')
})
it('does not restore after confirmed filesystem clear with a fresh authority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdb-auth-restart-'))
  roots.push(root)
  const file = path.join(root, 'session.enc')
  const crypto = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  }
  const principal = {
    userId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    email: 'a@example.test',
    displayName: 'A',
    role: 'member',
    createdAt: '2026-01-01T00:00:00Z',
  }
  const organization = {
    id: principal.organizationId,
    name: 'Org',
    slug: 'org',
    createdAt: principal.createdAt,
  }
  const fetchImpl = async (url: URL) => {
    if (url.pathname === '/health')
      return Response.json({ ok: true, runtime: 'php', supabase: false, apiVersion: 2 })
    if (url.pathname === '/auth/login')
      return Response.json({ token: 'synthetic', expiresAt: '2099-01-01T00:00:00Z' })
    if (url.pathname === '/auth/me') return Response.json({ user: principal })
    if (url.pathname === '/organizations/current') return Response.json({ organization })
    throw Error('unexpected request')
  }
  const create = () =>
    createMdbAuthAuthority({
      confirmServer: async () => true,
      fetchImpl,
      persistence: createSafeStorageMdbAuthPersistence(
        crypto,
        createMdbEncryptedAuthRecordStore(file),
      ),
    })
  const first = create()
  await first.signIn({ serverUrl: 'https://example.test/', email: 'a', password: 'b' })
  await first.signOut()
  first.dispose()
  const second = create()
  await second.restore()
  expect(second.state()).toEqual({ status: 'signed-out' })
  second.dispose()
})
