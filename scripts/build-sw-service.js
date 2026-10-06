#!/usr/bin/env node

/**
 * Build and copy SolidWorks Service to resources folder
 * 
 * This script builds the BluePLM.SolidWorksService C# project and copies
 * the output to resources/bin/win32 for bundling with the Electron app.
 * 
 * Requirements:
 * - Windows (SolidWorks is Windows-only)
 * - .NET SDK installed (dotnet CLI)
 * - .NET Framework 4.8 Targeting Pack
 * 
 * Usage:
 *   npm run build-sw-service
 *   node scripts/build-sw-service.js
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const PROJECT_PATH = 'solidworks-service/BluePLM.SolidWorksService'
const OUTPUT_DIR = 'resources/bin/win32'

if (process.env.BLUEPLM_SKIP_SW_SERVICE === '1') {
  console.log('⏭️  Skipping SolidWorks Service build because BLUEPLM_SKIP_SW_SERVICE=1.')
  process.exit(0)
}

console.log('🔧 Building SolidWorks Service...\n')

// Check platform
if (process.platform !== 'win32') {
  console.log('⚠️  SolidWorks Service is Windows-only. Skipping on', process.platform)
  process.exit(0)
}

// Check if .NET SDK is installed
try {
  const dotnetVersion = execSync('dotnet --version', { encoding: 'utf8' }).trim()
  console.log(`✓ .NET SDK found: ${dotnetVersion}`)
} catch {
  console.error('❌ .NET SDK not found. Install from: https://dotnet.microsoft.com/download')
  process.exit(1)
}

// Check if project exists
if (!fs.existsSync(PROJECT_PATH)) {
  console.error(`❌ Project not found: ${PROJECT_PATH}`)
  process.exit(1)
}

// Build the project
console.log('\n📦 Building Release configuration...')
try {
  execSync(`dotnet build ${PROJECT_PATH} -c Release`, { 
    stdio: 'inherit',
    encoding: 'utf8'
  })
  console.log('✓ Build successful')
} catch (error) {
  console.error('\n❌ Build failed.')
  console.error('\nCommon issues:')
  console.error('  - Missing .NET SDK')
  console.error('  - Missing .NET Framework 4.8 Targeting Pack')
  process.exit(1)
}

// Create output directory
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

// Copy files
const sourceDir = path.join(PROJECT_PATH, 'bin', 'Release')
const files = fs.readdirSync(sourceDir)

console.log(`\n📋 Copying files to ${OUTPUT_DIR}...`)

let copied = 0
for (const file of files) {
  if (file.endsWith('.exe') || file.endsWith('.dll') || file.endsWith('.config')) {
    const src = path.join(sourceDir, file)
    const dest = path.join(OUTPUT_DIR, file)
    fs.copyFileSync(src, dest)
    console.log(`  ✓ ${file}`)
    copied++
  }
}

console.log(`\n✅ Done! Copied ${copied} files to ${OUTPUT_DIR}`)
console.log('\nThe SolidWorks service will be bundled with the next Electron build.')









