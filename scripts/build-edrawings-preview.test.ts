import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const {
  commandExists,
  formatBytes,
  hasVisualCppToolchain,
  removeStaleResourceOutput,
  resolveNativeBuildOptions,
  buildNativePreview,
} = require('./build-edrawings-preview.js') as {
  commandExists: (command: string, args: string[]) => boolean
  formatBytes: (bytes: number) => string
  hasVisualCppToolchain: (dependencies?: {
    environment?: Record<string, string>
    fileExists?: (filePath: string) => boolean
    spawn?: (
      command: string,
      args: string[],
      options: Record<string, unknown>,
    ) => { status: number | null; stdout?: string; error?: Error }
  }) => boolean
  removeStaleResourceOutput: (resourceFile: string) => void
  resolveNativeBuildOptions: (args: string[], environment?: Record<string, string>) => {
    verify: boolean
    required: boolean
    gypDefine: string
  }
  buildNativePreview: (
    args: string[],
    environment: Record<string, string>,
    dependencies: NativePreviewBuildDependencies,
  ) => boolean
}

interface NativePreviewBuildDependencies {
  root: string
  platform: string
  execPath: string
  existsSync: (filePath: string) => boolean
  commandExists: (command: string, args: string[]) => boolean
  hasVisualCppToolchain: () => boolean
  removeStaleResourceOutput: (filePath: string) => void
  resolveNpmInvocation: (platform: string, environment: Record<string, string>) => {
    command: string
    args: string[]
  }
  execFileSync: (command: string, args: string[], options: Record<string, unknown>) => void
  mkdirSync: (directory: string, options: { recursive: boolean }) => void
  copyFileSync: (source: string, destination: string) => void
  statSync: (filePath: string) => { size: number }
  getElectronVersion: () => string
  warn: (message: string) => void
  log: (message: string) => void
}

function createBuildFixture(
  overrides: Partial<NativePreviewBuildDependencies> = {},
  options: { nodeGypInitiallyPresent?: boolean } = {},
) {
  const root = path.resolve(tmpdir(), 'blueplm-edrawings-build-fixture')
  const nativeDirectory = path.join(root, 'native')
  const gypEntrypoint = path.join(nativeDirectory, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
  const nativeOutput = path.join(nativeDirectory, 'build', 'Release', 'edrawings_preview.node')
  const resourceOutput = path.join(root, 'resources', 'bin', 'win32', 'edrawings_preview.node')
  const existing = new Set(options.nodeGypInitiallyPresent === false ? [] : [gypEntrypoint])
  const calls: Array<{ command: string; args: string[] }> = []
  const warnings: string[] = []
  const dependencies: NativePreviewBuildDependencies = {
    root,
    platform: 'win32',
    execPath: process.execPath,
    existsSync: (filePath) => existing.has(filePath),
    commandExists: (command) => command !== 'missing.exe',
    hasVisualCppToolchain: () => true,
    removeStaleResourceOutput: (filePath) => {
      calls.push({ command: 'remove-stale', args: [filePath] })
    },
    resolveNpmInvocation: (platform, environment) =>
      platform === 'win32'
        ? {
            command: environment.ComSpec || 'cmd.exe',
            args: ['/d', '/s', '/c', 'npm.cmd', 'ci', '--ignore-scripts'],
          }
        : { command: 'npm', args: ['ci', '--ignore-scripts'] },
    execFileSync: (command, args) => {
      calls.push({ command, args })
      if (command === process.execPath) existing.add(nativeOutput)
      if (command === 'cmd.exe' || command.toLowerCase().endsWith('\\cmd.exe')) existing.add(gypEntrypoint)
    },
    mkdirSync: (directory) => calls.push({ command: 'mkdir', args: [directory] }),
    copyFileSync: (source, destination) => calls.push({ command: 'copy', args: [source, destination] }),
    statSync: () => ({ size: 2048 }),
    getElectronVersion: () => '39.2.7',
    warn: (message) => warnings.push(message),
    log: () => undefined,
    ...overrides,
  }
  return { dependencies, calls, warnings, gypEntrypoint, nativeOutput, resourceOutput }
}

test('keeps desktop pixel diagnostics out of production builds', () => {
  expect(resolveNativeBuildOptions([])).toEqual({
    verify: false,
    required: false,
    gypDefine: 'edrawings_verify=0',
  })
})

test('enables desktop pixel diagnostics only for an explicit verify build', () => {
  expect(resolveNativeBuildOptions(['--verify'])).toEqual({
    verify: true,
    required: true,
    gypDefine: 'edrawings_verify=1',
  })
})

test('requires the native preview for release builds only when explicitly enabled', () => {
  expect(resolveNativeBuildOptions([], { BLUEPLM_EDRAWINGS_RELEASE_BUILD: '1' })).toEqual({
    verify: false,
    required: true,
    gypDefine: 'edrawings_verify=0',
  })
})

test('treats a command with a nonzero exit status as unavailable', () => {
  expect(commandExists(process.execPath, ['-e', 'process.exit(3)'])).toBe(false)
})

test('detects only Visual Studio versions supported by node-gyp 10.3.1', () => {
  const calls: Array<{ command: string; args: string[] }> = []
  const detectToolchain = (stdout: string): boolean =>
    hasVisualCppToolchain({
      environment: { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
      fileExists: () => true,
      spawn: (command, args) => {
        calls.push({ command, args })
        return { status: 0, stdout }
      },
    })

  expect(detectToolchain('C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\n')).toBe(true)
  expect(calls[0].args).toContain('[16.0,18.0)')
  expect(detectToolchain('')).toBe(false)
  expect(calls[1].args).toContain('[16.0,18.0)')
  expect(calls.every(({ args }) => !args.includes('cl.exe'))).toBe(true)
})

test('removes only the stale native resource artifact before a skip', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'blueplm-edrawings-'))
  const artifact = path.join(directory, 'edrawings_preview.node')
  const unrelated = path.join(directory, 'keep.txt')
  writeFileSync(artifact, 'stale')
  writeFileSync(unrelated, 'keep')

  removeStaleResourceOutput(artifact)

  expect(existsSync(artifact)).toBe(false)
  expect(existsSync(unrelated)).toBe(true)
})

test('builds the native preview during a normal Windows build when its toolchain is available', () => {
  const fixture = createBuildFixture()

  expect(buildNativePreview([], {}, fixture.dependencies)).toBe(true)
  expect(fixture.calls[0]).toEqual({ command: 'remove-stale', args: [fixture.resourceOutput] })
  expect(
    fixture.calls.some(({ command, args }) => command === process.execPath && args[1] === 'rebuild'),
  ).toBe(true)
  expect(fixture.calls.at(-1)).toEqual({
    command: 'copy',
    args: [fixture.nativeOutput, fixture.resourceOutput],
  })
  expect(fixture.warnings).toEqual([])
})

test('warns and skips an optional Windows build when Python is missing', () => {
  const fixture = createBuildFixture({ commandExists: () => false })

  expect(buildNativePreview([], {}, fixture.dependencies)).toBe(false)
  expect(fixture.calls[0]).toEqual({ command: 'remove-stale', args: [fixture.resourceOutput] })
  expect(
    fixture.calls.some(({ command }) => command === process.execPath || command === 'cmd.exe'),
  ).toBe(false)
  expect(fixture.warnings.join('\n')).toContain('Python 3 was not found')
})

test('warns and skips an optional Windows build when Visual Studio C++ tools are missing', () => {
  const fixture = createBuildFixture({ hasVisualCppToolchain: () => false })

  expect(buildNativePreview([], {}, fixture.dependencies)).toBe(false)
  expect(fixture.warnings.join('\n')).toContain(
    'Visual Studio Build Tools with the C++ workload were not found',
  )
  expect(
    fixture.calls.some(({ command }) => command === process.execPath || command === 'cmd.exe'),
  ).toBe(false)
})

test.each([
  [
    'release build with missing Python',
    [],
    { BLUEPLM_EDRAWINGS_RELEASE_BUILD: '1' },
    { commandExists: () => false },
    'Python 3 was not found',
  ],
  [
    'verify build with missing Visual Studio C++ tools',
    ['--verify'],
    {},
    { hasVisualCppToolchain: (): boolean => false },
    'Visual Studio Build Tools with the C++ workload were not found',
  ],
  [
    'release build with only unsupported Visual Studio',
    [],
    { BLUEPLM_EDRAWINGS_RELEASE_BUILD: '1' },
    { hasVisualCppToolchain: (): boolean => false },
    'Visual Studio Build Tools with the C++ workload were not found',
  ],
] as const)(
  'fails a required %s',
  (_name, args, environment, overrides, reason) => {
    const fixture = createBuildFixture(overrides)

    expect(() => buildNativePreview([...args], environment, fixture.dependencies)).toThrow(
      `Required eDrawings native preview build cannot continue: ${reason}`,
    )
    expect(fixture.warnings).toEqual([])
    expect(fixture.calls[0]).toEqual({ command: 'remove-stale', args: [fixture.resourceOutput] })
  },
)

test('does not convert an actual compiler failure into an optional-toolchain skip', () => {
  const compilerFailure = new Error('MSBuild failed while compiling the native preview')
  const fixture = createBuildFixture({
    execFileSync: (command, args) => {
      fixture.calls.push({ command, args })
      if (command === process.execPath) throw compilerFailure
    },
  })

  expect(() => buildNativePreview([], {}, fixture.dependencies)).toThrow(compilerFailure)
  expect(fixture.warnings).toEqual([])
  expect(fixture.calls.some(({ command }) => command === 'copy')).toBe(false)
})

test('does not convert an actual node-gyp bootstrap failure into an optional-toolchain skip', () => {
  const bootstrapFailure = new Error('npm ci failed while bootstrapping node-gyp')
  const fixture = createBuildFixture(
    {
      execFileSync: (command, args) => {
        fixture.calls.push({ command, args })
        if (command === 'cmd.exe' || command.toLowerCase().endsWith('\\cmd.exe')) {
          throw bootstrapFailure
        }
      },
    },
    { nodeGypInitiallyPresent: false },
  )

  expect(() => buildNativePreview([], {}, fixture.dependencies)).toThrow(bootstrapFailure)
  expect(fixture.warnings).toEqual([])
  expect(fixture.calls.some(({ command }) => command === process.execPath)).toBe(false)
})

test('keeps a missing node-gyp bootstrap on the Node 25 Windows cmd.exe path', () => {
  const fixture = createBuildFixture({}, { nodeGypInitiallyPresent: false })
  const environment = { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }

  expect(buildNativePreview([], environment, fixture.dependencies)).toBe(true)
  expect(fixture.calls[1]).toEqual({
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', 'npm.cmd', 'ci', '--ignore-scripts'],
  })
})

test('keeps the ordinary native preview build optional outside Windows', () => {
  const fixture = createBuildFixture({ platform: 'linux' })

  expect(buildNativePreview([], {}, fixture.dependencies)).toBe(false)
  expect(fixture.warnings.join('\n')).toContain('supported only on Windows')
  expect(fixture.calls).toHaveLength(1)
})

test('formats native payload sizes for build logs', () => {
  expect(formatBytes(1024)).toBe('1.0 KiB')
})
