import { describe, expect, it, vi } from 'vitest'
import {
  createMdbAuthAuthority,
  type MdbAuthPersistence,
  type MdbAuthSnapshot,
} from './mdbAuthAuthority'

const user = {
  userId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  email: 'user@example.test',
  displayName: 'User',
  role: 'member',
  createdAt: '2026-01-01T00:00:00Z',
}
const organization = {
  id: user.organizationId,
  name: 'Org',
  slug: 'org',
  createdAt: user.createdAt,
}
const expiresAt = '2099-01-01T00:00:00Z'
function setup(failClear = false) {
  let saved: MdbAuthSnapshot | null = null
  const persistence: MdbAuthPersistence = {
    load: async () => saved,
    save: async (s) => {
      saved = s
    },
    clear: async () => {
      if (failClear && saved) throw Error('io')
      saved = null
    },
  }
  const fetchImpl = vi.fn(async (url: URL) => {
    if (url.pathname.endsWith('/health'))
      return Response.json({ ok: true, runtime: 'php', supabase: false, apiVersion: 2 })
    if (url.pathname.endsWith('/auth/login'))
      return Response.json({ totpRequired: true, challengeToken: 'challenge-secret', expiresAt })
    if (url.pathname.endsWith('/auth/totp/verify'))
      return Response.json({ token: 'bearer-secret', expiresAt })
    if (url.pathname.endsWith('/auth/me')) return Response.json({ user })
    if (url.pathname.endsWith('/organizations/current')) return Response.json({ organization })
    throw Error('unexpected request')
  })
  const create = () =>
    createMdbAuthAuthority({ confirmServer: async () => true, persistence, fetchImpl })
  return { create, persistence, fetchImpl }
}
describe('Main auth authority', () => {
  it('keeps pending and verified state free of secrets and clears before a fresh restore', async () => {
    const { create, fetchImpl } = setup()
    const authority = create()
    expect(fetchImpl).not.toHaveBeenCalled()
    await authority.signIn({
      serverUrl: 'https://example.test/',
      email: 'user',
      password: 'password',
    })
    expect(authority.state()).toEqual({ status: 'totp-required' })
    await authority.verifyTotp('123456')
    expect(authority.state()).toMatchObject({ status: 'verified', principal: user, organization })
    expect(JSON.stringify(authority.state())).not.toContain('secret')
    authority.dispose()
    const restored = create()
    await restored.restore()
    expect(restored.state()).toMatchObject({ status: 'verified', principal: user, organization })
    restored.dispose()
    await restored.signOut()
    const fresh = create()
    await fresh.restore()
    expect(fresh.state()).toEqual({ status: 'signed-out' })
  })
  it('revokes memory and reports clear failure while saved data may remain', async () => {
    const { create, persistence } = setup(true)
    const authority = create()
    await authority.signIn({
      serverUrl: 'https://example.test/',
      email: 'user',
      password: 'password',
    })
    await authority.verifyTotp('123456')
    await expect(authority.signOut()).rejects.toMatchObject({ code: 'persistence-clear-failed' })
    expect(authority.state()).toEqual({ status: 'signed-out' })
    expect(await persistence.load()).not.toBeNull()
    await expect(authority.restore()).rejects.toMatchObject({ code: 'persistence-clear-failed' })
  })
  it.each([{}, { ok: true, runtime: 'php', supabase: false, apiVersion: 3 }])(
    'rejects unsupported health before sending credentials',
    async (health) => {
      const fetchImpl = vi.fn(async () => Response.json(health))
      const persistence: MdbAuthPersistence = {
        load: async () => null,
        save: async () => {},
        clear: async () => {},
      }
      const authority = createMdbAuthAuthority({
        confirmServer: async () => true,
        persistence,
        fetchImpl,
      })
      await expect(
        authority.signIn({
          serverUrl: 'https://example.test/',
          email: 'user',
          password: 'password',
        }),
      ).rejects.toMatchObject({ code: 'invalid-json' })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect((fetchImpl.mock.calls[0] as unknown as [URL])[0].pathname).toBe('/health')
    },
  )
  it('does not reactivate a session when sign-out races a pending save', async () => {
    let stored: MdbAuthSnapshot | null = null
    let release!: () => void
    let saving!: () => void
    const started = new Promise<void>((resolve) => {
      saving = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const persistence: MdbAuthPersistence = {
      load: async () => stored,
      save: async (value) => {
        saving()
        await gate
        stored = value
      },
      clear: async () => {
        stored = null
      },
    }
    const fetchImpl = vi.fn(async (url: URL) => {
      if (url.pathname === '/health')
        return Response.json({ ok: true, runtime: 'php', supabase: false, apiVersion: 2 })
      if (url.pathname === '/auth/login') return Response.json({ token: 'secret', expiresAt })
      if (url.pathname === '/auth/me') return Response.json({ user })
      if (url.pathname === '/organizations/current') return Response.json({ organization })
      throw Error('unexpected request')
    })
    const authority = createMdbAuthAuthority({
      confirmServer: async () => true,
      persistence,
      fetchImpl,
    })
    const login = authority.signIn({
      serverUrl: 'https://example.test/',
      email: 'user',
      password: 'password',
    })
    const rejected = expect(login).rejects.toMatchObject({ code: 'context-invalidated' })
    await started
    const signOut = authority.signOut()
    release()
    await rejected
    await signOut
    expect(authority.state()).toEqual({ status: 'signed-out' })
    expect(await persistence.load()).toBeNull()
  })
  it('expires a TOTP challenge without accepting its code', async () => {
    let now = new Date('2026-01-01T00:00:00Z')
    const persistence: MdbAuthPersistence = {
      load: async () => null,
      save: async () => {},
      clear: async () => {},
    }
    const fetchImpl = vi.fn(async (url: URL) =>
      url.pathname === '/health'
        ? Response.json({ ok: true, runtime: 'php', supabase: false, apiVersion: 2 })
        : Response.json({
            totpRequired: true,
            challengeToken: 'secret',
            expiresAt: '2026-01-01T00:01:00Z',
          }),
    )
    const authority = createMdbAuthAuthority({
      confirmServer: async () => true,
      persistence,
      fetchImpl,
      now: () => now,
    })
    await authority.signIn({ serverUrl: 'https://example.test/', email: 'a', password: 'b' })
    now = new Date('2026-01-01T00:02:00Z')
    await expect(authority.verifyTotp('123456')).rejects.toMatchObject({ code: 'totp-invalid' })
    expect(authority.state()).toEqual({ status: 'signed-out' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await authority.signOut()
  })
  it('rejects an incorrect TOTP code without creating a verified identity', async () => {
    const persistence: MdbAuthPersistence = {
      load: async () => null,
      save: async () => {},
      clear: async () => {},
    }
    const fetchImpl = vi.fn(async (url: URL) => {
      if (url.pathname === '/health')
        return Response.json({ ok: true, runtime: 'php', supabase: false, apiVersion: 2 })
      if (url.pathname === '/auth/login')
        return Response.json({ totpRequired: true, challengeToken: 'secret', expiresAt })
      return new Response(null, { status: 401 })
    })
    const authority = createMdbAuthAuthority({
      confirmServer: async () => true,
      persistence,
      fetchImpl,
    })
    await authority.signIn({ serverUrl: 'https://example.test/', email: 'a', password: 'b' })
    await expect(authority.verifyTotp('000000')).rejects.toMatchObject({ code: 'totp-invalid' })
    expect(authority.state()).toEqual({ status: 'totp-required' })
    await authority.signOut()
  })
  it.each(['unauthorized', 'mismatch'])(
    'removes persisted authority on restore %s',
    async (failure) => {
      const { create, persistence, fetchImpl } = setup()
      const initial = create()
      await initial.signIn({ serverUrl: 'https://example.test/', email: 'a', password: 'b' })
      await initial.verifyTotp('123456')
      initial.dispose()
      fetchImpl.mockImplementation(async (url: URL) => {
        if (url.pathname.endsWith('/health'))
          return Response.json({ ok: true, runtime: 'php', supabase: false, apiVersion: 2 })
        if (url.pathname.endsWith('/auth/me')) {
          return failure === 'unauthorized'
            ? new Response(null, { status: 401 })
            : Response.json({ user: { ...user, userId: '33333333-3333-4333-8333-333333333333' } })
        }
        throw Error('unexpected request')
      })
      const restored = create()
      await expect(restored.restore()).rejects.toMatchObject({
        code: failure === 'unauthorized' ? 'unauthorized' : 'invalid-principal-response',
      })
      expect(restored.state()).toEqual({ status: 'signed-out' })
      expect(await persistence.load()).toBeNull()
      restored.dispose()
    },
  )
  it('does not clear a newer sign-in when a stale restore returns unauthorized', async () => {
    const { create, persistence, fetchImpl } = setup()
    const initial = create()
    await initial.signIn({ serverUrl: 'https://example.test/', email: 'a', password: 'b' })
    await initial.verifyTotp('123456')
    initial.dispose()
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    let firstMe = true
    fetchImpl.mockImplementation(async (url: URL) => {
      if (url.pathname.endsWith('/health'))
        return Response.json({ ok: true, runtime: 'php', supabase: false, apiVersion: 2 })
      if (url.pathname.endsWith('/auth/login'))
        return Response.json({ token: 'new-secret', expiresAt })
      if (url.pathname.endsWith('/auth/me') && firstMe) {
        firstMe = false
        started()
        await gate
        return new Response(null, { status: 401 })
      }
      if (url.pathname.endsWith('/auth/me')) return Response.json({ user })
      if (url.pathname.endsWith('/organizations/current')) return Response.json({ organization })
      throw Error('unexpected request')
    })
    const authority = create()
    const oldRestore = authority.restore()
    const failure = expect(oldRestore).rejects.toMatchObject({ code: 'unauthorized' })
    await entered
    await authority.signIn({ serverUrl: 'https://example.test/', email: 'a', password: 'b' })
    release()
    await failure
    expect(authority.state()).toMatchObject({ status: 'verified' })
    expect((await persistence.load())?.bearerToken).toBe('new-secret')
    await authority.signOut()
    authority.dispose()
  })
  it('still clears saved authority when a subscriber throws', async () => {
    const { create, persistence } = setup()
    const authority = create()
    await authority.signIn({ serverUrl: 'https://example.test/', email: 'a', password: 'b' })
    await authority.verifyTotp('123456')
    authority.subscribe(() => {
      throw Error('listener error')
    })
    await authority.signOut()
    expect(await persistence.load()).toBeNull()
    expect(authority.state()).toEqual({ status: 'signed-out' })
    authority.dispose()
  })
  it('does not send a saved bearer when restore health is unsupported', async () => {
    const { create, fetchImpl, persistence } = setup()
    const initial = create()
    await initial.signIn({ serverUrl: 'https://example.test/', email: 'a', password: 'b' })
    await initial.verifyTotp('123456')
    initial.dispose()
    fetchImpl.mockClear()
    fetchImpl.mockImplementation(async () =>
      Response.json({ ok: true, runtime: 'php', supabase: false, apiVersion: 3 }),
    )
    const restored = create()
    await expect(restored.restore()).rejects.toMatchObject({ code: 'invalid-json' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(restored.state()).toEqual({ status: 'signed-out' })
    expect(await persistence.load()).not.toBeNull()
    restored.dispose()
  })
})
