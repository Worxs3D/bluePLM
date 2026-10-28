/**
 * Perf build stand-in for `node:crypto` inside `src/test/fakeElectron.ts`.
 *
 * The fake disk only needs a hash that is stable for the same bytes, so the disk and the server
 * rows it seeds agree. FNV-1a, widened to 64 hex characters like a SHA-256. Not a cryptographic
 * hash, and never shipped: only the perf build resolves `node:crypto` here.
 */
function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export function createHash(_algorithm: string) {
  let text = ''
  const hasher = {
    update(chunk: string) {
      text += chunk
      return hasher
    },
    digest(_encoding: 'hex') {
      let out = ''
      for (let seed = 0x811c9dc5, i = 0; i < 8; i++, seed += 0x9e3779b9) out += fnv1a(text, seed)
      return out
    },
  }
  return hasher
}
