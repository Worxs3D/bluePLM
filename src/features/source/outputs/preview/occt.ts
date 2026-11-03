/**
 * The STEP / IGES tessellator (occt-import-js, OpenCascade in WebAssembly), loaded on first use.
 * Its JS and .wasm are separate chunks, never in the main bundle.
 *
 * A WebAssembly heap only grows, so the instance is let go after `IDLE_RELEASE_MS` without a
 * request and the next model loads a fresh one: a session that runs for weeks does not keep the
 * peak heap of the largest model it ever showed.
 */
import type { OcctModule, OcctResult } from 'occt-import-js'

const IDLE_RELEASE_MS = 90_000

let instance: Promise<OcctModule> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null

async function createInstance(): Promise<OcctModule> {
  const [mod, wasm] = await Promise.all([
    import('occt-import-js'),
    import('occt-import-js/dist/occt-import-js.wasm?url'),
  ])
  const init = (mod as { default?: typeof mod.default }).default ?? (mod as unknown as typeof mod.default)
  return init({ locateFile: () => wasm.default })
}

function occt(): Promise<OcctModule> {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  if (!instance) {
    instance = createInstance().catch((err: unknown) => {
      instance = null
      throw err
    })
  }
  return instance
}

function releaseWhenIdle(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    instance = null
    idleTimer = null
  }, IDLE_RELEASE_MS)
}

/** Tessellate a STEP or IGES file (millimetres). Runs on this thread; callers cap the size. */
export async function tessellate(format: 'step' | 'iges', bytes: Uint8Array): Promise<OcctResult> {
  const module = await occt()
  try {
    const params = {
      linearUnit: 'millimeter' as const,
      linearDeflectionType: 'bounding_box_ratio' as const,
      linearDeflection: 0.001,
      angularDeflection: 0.5,
    }
    return format === 'step' ? module.ReadStepFile(bytes, params) : module.ReadIgesFile(bytes, params)
  } finally {
    releaseWhenIdle()
  }
}
