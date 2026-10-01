import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

type PackageManifest = {
  scripts?: {
    build?: string
  }
}

const repositoryRoot = resolve(__dirname, '..')
const packageManifest = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
) as PackageManifest
const serviceBuildScript = readFileSync(
  resolve(repositoryRoot, 'scripts/build-sw-service.js'),
  'utf8',
)

describe('production packaging build contract', () => {
  it('builds the SolidWorks service before electron-builder', () => {
    const buildSteps = packageManifest.scripts?.build?.split(' && ') ?? []
    const serviceBuildIndex = buildSteps.indexOf('npm run build-sw-service')
    const electronBuilderIndex = buildSteps.indexOf('electron-builder')

    expect(serviceBuildIndex).toBeGreaterThanOrEqual(0)
    expect(electronBuilderIndex).toBe(serviceBuildIndex + 1)
  })

  it('keeps the service build Windows-only and targets Release output', () => {
    expect(serviceBuildScript).toContain("process.platform !== 'win32'")
    expect(serviceBuildScript).toContain('dotnet build ${PROJECT_PATH} -c Release')
    expect(serviceBuildScript).toContain("path.join(PROJECT_PATH, 'bin', 'Release')")
  })
})
