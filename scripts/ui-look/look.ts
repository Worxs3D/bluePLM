/**
 * ui-look: screenshot any screen of the real app, headless.
 *
 * Starts the built Electron app in its perf boot (fake Supabase, a small synthetic vault, a
 * signed-in admin, no network; see scripts/render-perf/README.md) with BLUEPLM_PERF_LOOK=1, which
 * keeps the window hidden and installs `window.__blueplmLook` (src/perf/app/look.ts). The steps on
 * the command line then run in order and every `--shot` writes a PNG.
 *
 *   npx tsx scripts/ui-look/look.ts --scene vault-audit-results --shot results
 *   npx tsx scripts/ui-look/look.ts --scene vault-audit-folder --click "text=Browse" --shot tree
 *
 * Steps (any number, in order):
 *   --scene <name>          put the app into a named scene (--list prints them)
 *   --click <selector>      click a Playwright selector (`text=Run`, `role=button[name="Run"]`, css)
 *   --fill <selector>=<v>   fill an input
 *   --press <key>           press a key (Enter, Escape, ArrowDown)
 *   --hover <selector>      hover an element
 *   --wait <ms>             wait
 *   --eval <js>             evaluate in the page (`__blueplmLook.store` is the app store)
 *   --shot <name>[@<sel>]   screenshot the window, or only the element <sel>
 *
 * Options: --out <dir> (default ui-look-out), --size <w>x<h> (default 1440x900), --build (rebuild
 * the perf app first; it is built automatically when dist/perf.html is missing), --list.
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron, type ElectronApplication, type Page } from 'playwright'

// The page globals the steps read: window.__blueplmPerf and window.__blueplmLook.
import type {} from '../../src/perf/app/control'
import type {} from '../../src/perf/app/look'

type Step = { kind: string; value: string }

const STEP_FLAGS = new Set(['--scene', '--click', '--fill', '--press', '--hover', '--wait', '--eval', '--shot'])

function parseArgs(argv: string[]) {
  const steps: Step[] = []
  let out = 'ui-look-out'
  let size = { width: 1440, height: 900 }
  let build = false
  let list = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--build') build = true
    else if (arg === '--list') list = true
    else if (arg === '--out') out = argv[++i]
    else if (arg === '--size') {
      const [width, height] = argv[++i].split('x').map(Number)
      size = { width, height }
    } else if (STEP_FLAGS.has(arg)) steps.push({ kind: arg.slice(2), value: argv[++i] ?? '' })
    else throw new Error(`unknown argument ${arg}`)
  }
  return { steps, out: resolve(out), size, build, list }
}

function buildPerfApp(): void {
  console.log('ui-look: building the perf app (once; --build rebuilds)')
  execSync('npx tsx scripts/render-perf/emitSchemaShape.ts', { stdio: 'inherit' })
  execSync('npx vite build', { stdio: 'inherit', env: { ...process.env, BLUEPLM_PERF_BUILD: '1' } })
}

async function appWindow(app: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const page = app.windows().find((w) => w.url().includes('/perf.html'))
    if (page) return page
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('no perf.html window')
}

/**
 * A hidden window does not always produce a new frame, and a screenshot waits for one. Asking for
 * a repaint first and retrying covers it.
 */
async function shoot(app: ElectronApplication, page: Page, path: string, selector?: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.invalidate())
    try {
      const options = { path, timeout: 8000, animations: 'disabled' as const }
      if (selector) await page.locator(selector).first().screenshot(options)
      else await page.screenshot(options)
      return
    } catch (error) {
      if (attempt >= 4) throw error
    }
  }
}

async function main(): Promise<void> {
  const { steps, out, size, build, list } = parseArgs(process.argv.slice(2))
  if (build || !existsSync('dist/perf.html')) buildPerfApp()
  mkdirSync(out, { recursive: true })

  const app = await _electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      BLUEPLM_PERF_BOOT: '1',
      BLUEPLM_PERF_LOOK: '1',
      BLUEPLM_PERF_USER_DATA: mkdtempSync(join(tmpdir(), 'blueplm-look-')),
      NODE_ENV: 'production',
    },
    timeout: 120_000,
  })
  const errors: string[] = []
  try {
    const page = await appWindow(app)
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text().slice(0, 300))
    })
    await app.evaluate(
      ({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]?.setContentSize(s.width, s.height),
      size,
    )
    await page.setViewportSize(size).catch(() => {})
    // Let the resize settle, or the first screenshot can catch the window mid-change.
    await page.waitForTimeout(500)
    await page.waitForFunction(() => window.__blueplmPerf?.loaded != null, null, { timeout: 120_000 })

    if (list) {
      console.log((await page.evaluate(() => window.__blueplmLook?.scenes() ?? [])).join('\n'))
      return
    }

    let shots = 0
    for (const step of steps) {
      switch (step.kind) {
        case 'scene':
          await page.evaluate((name) => window.__blueplmLook!.scene(name), step.value)
          await page.waitForTimeout(400)
          break
        case 'click':
          await page.locator(step.value).first().click()
          await page.waitForTimeout(250)
          break
        case 'fill': {
          const at = step.value.indexOf('=', step.value.indexOf(']') + 1)
          await page.locator(step.value.slice(0, at)).first().fill(step.value.slice(at + 1))
          await page.waitForTimeout(250)
          break
        }
        case 'press':
          await page.keyboard.press(step.value)
          await page.waitForTimeout(150)
          break
        case 'hover':
          await page.locator(step.value).first().hover()
          await page.waitForTimeout(250)
          break
        case 'wait':
          await page.waitForTimeout(Number(step.value))
          break
        case 'eval':
          console.log(JSON.stringify(await page.evaluate(step.value)))
          break
        case 'shot': {
          const [name, selector] = step.value.split('@')
          const path = join(out, `${name || `shot-${shots}`}.png`)
          await shoot(app, page, path, selector)
          shots += 1
          console.log(path)
          break
        }
      }
    }
    if (shots === 0) {
      const path = join(out, 'shot.png')
      await shoot(app, page, path)
      console.log(path)
    }
  } finally {
    if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 20).join('\n  ')}`)
    await app.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
