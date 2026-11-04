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
 *   --rclick <selector>     right-click (opens context menus)
 *   --ctrlclick <selector>  Ctrl+click (add to a selection)
 *   --dblclick <selector>   double-click
 *   --drag <x1>,<y1>,<x2>,<y2>  press, move and release the mouse (window px; markups on a PDF)
 *   --as <person>           act as another user (`__blueplmLook.actAs`; review scenes: author, sam, alex, olive)
 *   --fill <selector>=<v>   fill an input
 *   --press <key>           press a key (Enter, Escape, ArrowDown)
 *   --hover <selector>      hover an element
 *   --wait <ms>             wait
 *   --eval <js>             evaluate in the page (`__blueplmLook.store` is the app store)
 *   --shot <name>[@<sel>]   screenshot the window, or only the element <sel>
 *
 * A steps file (`--steps <file>`, e.g. scripts/ui-look/flows/review-full.steps) holds the same steps,
 * one per line as `--kind value` (no quoting; `#` starts a comment line), and runs where it stands.
 *
 * Options: --out <dir> (default ui-look-out), --size <w>x<h> (default 1440x900), --build (rebuild
 * the perf app first; it is built automatically when dist/perf.html is missing), --list,
 * --theme dark|light (the app theme for every shot),
 * --dist <dir> (build into and run from <dir>/dist and <dir>/dist-electron instead of the shared
 * dist/, so agents can build and run side by side; keep <dir> inside the repo, e.g. .ui-look/<name>,
 * so the main process resolves node_modules).
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { _electron, type ElectronApplication, type Page } from 'playwright'

// The page globals the steps read: window.__blueplmPerf and window.__blueplmLook.
import type {} from '../../src/perf/app/control'
import type {} from '../../src/perf/app/look'

type Step = { kind: string; value: string }

const STEP_FLAGS = new Set([
  '--scene',
  '--click',
  '--rclick',
  '--ctrlclick',
  '--dblclick',
  '--drag',
  '--as',
  '--fill',
  '--press',
  '--hover',
  '--wait',
  '--eval',
  '--shot',
])

/** Steps from a file: one `--kind value` per line, blank lines and `#` comments skipped. */
function readSteps(file: string): Step[] {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const space = line.indexOf(' ')
      const flag = space < 0 ? line : line.slice(0, space)
      if (!STEP_FLAGS.has(flag)) throw new Error(`${file}: unknown step ${flag}`)
      return { kind: flag.slice(2), value: space < 0 ? '' : line.slice(space + 1).trim() }
    })
}

function parseArgs(argv: string[]) {
  const steps: Step[] = []
  let out = 'ui-look-out'
  let size = { width: 1440, height: 900 }
  let build = false
  let list = false
  let dist: string | null = process.env.BLUEPLM_PERF_OUT ?? null
  let theme: 'dark' | 'light' | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--build') build = true
    else if (arg === '--list') list = true
    else if (arg === '--out') out = argv[++i]
    else if (arg === '--dist') dist = argv[++i]
    else if (arg === '--steps') steps.push(...readSteps(argv[++i]))
    else if (arg === '--theme') {
      const value = argv[++i]
      if (value !== 'dark' && value !== 'light') throw new Error('--theme takes dark or light')
      theme = value
    }
    else if (arg === '--size') {
      const [width, height] = argv[++i].split('x').map(Number)
      size = { width, height }
    } else if (STEP_FLAGS.has(arg)) steps.push({ kind: arg.slice(2), value: argv[++i] ?? '' })
    else throw new Error(`unknown argument ${arg}`)
  }
  return { steps, out: resolve(out), size, build, list, dist: dist ? resolve(dist) : null, theme }
}

/** Build the perf app into dist/ (shared) or into `<dist>/dist` + `<dist>/dist-electron` (own copy). */
function buildPerfApp(dist: string | null): void {
  console.log(`ui-look: building the perf app into ${dist ?? 'dist/'} (once; --build rebuilds)`)
  const env = { ...process.env, BLUEPLM_PERF_BUILD: '1', ...(dist ? { BLUEPLM_PERF_OUT: dist } : {}) }
  if (!dist) delete env.BLUEPLM_PERF_OUT
  execSync('npx tsx scripts/render-perf/emitSchemaShape.ts', { stdio: 'inherit', env })
  execSync('npx vite build', { stdio: 'inherit', env })
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
 * Let a hidden window catch up before a screenshot. It produces frames only when asked, and
 * IntersectionObserver callbacks, rAF work and canvas paints wait for frames: a lazily rendered
 * PDF page could still be a blank sheet in the shot. A few forced frames deliver them.
 */
async function settle(app: ElectronApplication, page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.invalidate())
    await page
      .evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve())
            setTimeout(resolve, 250)
          }),
      )
      .catch(() => null)
  }
}

/**
 * A hidden window does not always produce a new frame, and a screenshot waits for one. Asking for
 * a repaint first and retrying covers it.
 */
async function shoot(app: ElectronApplication, page: Page, path: string, selector?: string): Promise<void> {
  await settle(app, page)
  if (!selector) {
    // The whole window through Electron's own capture: Playwright's page screenshot of a hidden
    // window now and then came back as a magnified crop of the page.
    const png = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return null
      win.webContents.invalidate()
      const image = await win.webContents.capturePage()
      return image.isEmpty() ? null : image.toPNG().toString('base64')
    })
    if (png) {
      writeFileSync(path, Buffer.from(png, 'base64'))
      return
    }
  }
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
  const { steps, out, size, build, list, dist, theme } = parseArgs(process.argv.slice(2))
  const perfHtml = dist ? join(dist, 'dist', 'perf.html') : 'dist/perf.html'
  if (build || !existsSync(perfHtml)) buildPerfApp(dist)
  mkdirSync(out, { recursive: true })

  const app = await _electron.launch({
    // An own build runs its own main process; the shared one is the package's (`.`).
    args: [dist ? join(dist, 'dist-electron', 'main.js') : '.'],
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
    await page.waitForFunction(() => window.__blueplmPerf?.loaded != null, null, { timeout: 120_000 }).catch(async (error: unknown) => {
      // Say how far the boot got: a failed boot leaves its error on the title (src/perf/app/main.ts).
      const where = await page
        .evaluate(() => `stage ${document.documentElement.dataset.perfBootStage ?? '?'}; title ${document.title}`)
        .catch(() => 'page unreachable')
      throw new Error(`the perf boot never reported the vault loaded (${where}): ${String(error)}`)
    })

    if (theme) await page.evaluate((t) => window.__blueplmLook!.theme(t), theme)

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
        case 'rclick':
          await page.locator(step.value).first().click({ button: 'right' })
          await page.waitForTimeout(250)
          break
        case 'ctrlclick':
          await page.locator(step.value).first().click({ modifiers: ['Control'] })
          await page.waitForTimeout(250)
          break
        case 'drag': {
          const [x1, y1, x2, y2] = step.value.split(',').map(Number)
          await page.mouse.move(x1, y1)
          await page.mouse.down()
          await page.mouse.move(x2, y2, { steps: 8 })
          await page.mouse.up()
          await page.waitForTimeout(300)
          break
        }
        case 'dblclick':
          await page.locator(step.value).first().dblclick()
          await page.waitForTimeout(250)
          break
        case 'as':
          await page.evaluate((who) => window.__blueplmLook!.actAs(who), step.value)
          await page.waitForTimeout(400)
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
