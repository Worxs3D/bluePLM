import { app, ipcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

export interface MdbProvisionRequest {
  publicUrl: string
  ftpUrl: string
  ftpRemotePath: string
  ftpUsername: string
  ftpPassword: string
  databaseHost: string
  databasePort: number
  databaseName: string
  databaseUser: string
  databasePassword: string
  sessionSecret?: string
  bootstrapToken?: string
  maintenanceToken?: string
  documentRootConfirmed: boolean
}

export interface MdbProvisionResult {
  success: boolean
  setupUrl?: string
  generatedSecrets?: { sessionSecret: string; bootstrapToken: string; maintenanceToken: string }
  error?: string
}

type Secrets = Required<Pick<MdbProvisionRequest, 'sessionSecret' | 'bootstrapToken' | 'maintenanceToken'>>

function fail(message: string): never { throw new Error(message) }

function required(value: string, label: string, max = 2048): string {
  const clean = value.trim()
  if (!clean || clean.length > max) fail(`A valid ${label} is required.`)
  return clean
}

function singleLine(value: string, label: string, max = 2048): string {
  const clean = required(value, label, max)
  if (/[\r\n\0]/.test(clean)) fail(`${label} must not contain line breaks.`)
  return clean
}

function secret(value: string | undefined, label: string): string {
  if (!value || value.length < 32 || value.length > 512) fail(`${label} must contain at least 32 characters.`)
  if (/[\r\n\0]/.test(value)) fail(`${label} must not contain line breaks.`)
  return value
}

export function resolveSecrets(request: MdbProvisionRequest): { secrets: Secrets; generated?: MdbProvisionResult['generatedSecrets'] } {
  const supplied = [request.sessionSecret, request.bootstrapToken, request.maintenanceToken]
  if (supplied.every((value) => !value)) {
    const generatedSecrets = {
      sessionSecret: randomBytes(32).toString('base64url'),
      bootstrapToken: randomBytes(32).toString('base64url'),
      maintenanceToken: randomBytes(32).toString('base64url'),
    }
    return { secrets: generatedSecrets, generated: generatedSecrets }
  }
  if (supplied.some((value) => !value)) fail('Enter all three secrets or leave all three empty to generate them securely.')
  return {
    secrets: {
      sessionSecret: secret(request.sessionSecret, 'Session secret'),
      bootstrapToken: secret(request.bootstrapToken, 'Bootstrap token'),
      maintenanceToken: secret(request.maintenanceToken, 'Maintenance token'),
    },
  }
}

function publicBase(raw: string): URL {
  let url: URL
  try { url = new URL(raw.trim()) } catch { fail('The public backend URL must be a valid HTTPS URL.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('The public backend URL must be a plain root HTTPS URL.')
  url.pathname = url.pathname.replace(/\/$/, '')
  return url
}

function ftpBase(raw: string): URL {
  let url: URL
  try { url = new URL(raw.trim()) } catch { fail('The FTP server URL is invalid.') }
  if (!['ftp:', 'ftps:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('Use an ftp:// or ftps:// server URL without credentials.')
  return url
}

function remotePath(value: string): string {
  const segments = required(value, 'FTP target path', 1024).replaceAll('\\', '/').split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))) fail('The FTP target path contains an invalid path segment.')
  return segments.join('/')
}

function serverBundleRoot(): string {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'blueplm-mdb-server')
    : path.resolve(app.getAppPath(), 'blueplm-community-php')
  return root
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const children = await Promise.all(entries.map(async (entry) => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? await listFiles(full) : [full]
  }))
  return children.flat()
}

function curlConfig(username: string, password: string): string {
  const escaped = `${username}:${password}`.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return `user = "${escaped}"\n`
}

async function upload(ftp: URL, destination: string, localFile: string, username: string, password: string): Promise<void> {
  const target = new URL(ftp)
  const explicitFtps = ftp.protocol === 'ftps:' && (ftp.port === '' || ftp.port === '21')
  if (explicitFtps) target.protocol = 'ftp:'
  target.pathname = `${ftp.pathname.replace(/\/$/, '')}/${destination}`
  const args = ['--fail', '--silent', '--show-error', '--ftp-create-dirs']
  if (explicitFtps) args.push('--ftp-ssl-reqd')
  args.push('--config', '-', '--upload-file', localFile, target.toString())
  await new Promise<void>((resolve, reject) => {
    const child = spawn('curl.exe', args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', () => reject(new Error('FTP upload could not start.')))
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`FTP upload failed (${code ?? 'unknown'}): ${stderr.slice(0, 500)}`)))
    child.stdin.end(curlConfig(username, password))
  })
}

function environment(request: MdbProvisionRequest, secrets: Secrets, publicUrl: URL): string {
  const databasePort = Number.isInteger(request.databasePort) && request.databasePort > 0 && request.databasePort <= 65535 ? request.databasePort : fail('The database port is invalid.')
  return [
    'BLUEPLM_ENV=production',
    'BLUEPLM_CORS_ORIGINS=null,file://,http://localhost:5173',
    `BLUEPLM_PUBLIC_URL=${publicUrl.toString().replace(/\/$/, '')}`,
    `MARIADB_HOST=${singleLine(request.databaseHost, 'database host', 255)}`,
    `MARIADB_PORT=${databasePort}`,
    `MARIADB_DATABASE=${singleLine(request.databaseName, 'database name', 255)}`,
    `MARIADB_USER=${singleLine(request.databaseUser, 'database user', 255)}`,
    `MARIADB_PASSWORD=${singleLine(request.databasePassword, 'database password')}`,
    `BLUEPLM_SESSION_SECRET=${secrets.sessionSecret}`,
    `BLUEPLM_BOOTSTRAP_TOKEN=${secrets.bootstrapToken}`,
    `BLUEPLM_MAINTENANCE_TOKEN=${secrets.maintenanceToken}`,
    '',
  ].join('\n')
}

async function migrate(publicUrl: URL, maintenanceToken: string): Promise<void> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 30_000)
  try {
    const response = await fetch(new URL('/admin/migrate', publicUrl), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
      body: JSON.stringify({ maintenanceToken }),
    })
    if (!response.ok) fail(`The server did not accept schema migrations (HTTP ${response.status}). Verify the webroot points to public/.`)
  } finally { clearTimeout(timer) }
}

async function provision(request: MdbProvisionRequest): Promise<MdbProvisionResult> {
  try {
    if (!request.documentRootConfirmed) fail('Confirm that the domain document root points to the uploaded public/ directory before continuing.')
    const publicUrl = publicBase(request.publicUrl)
    const ftp = ftpBase(request.ftpUrl)
    const root = serverBundleRoot()
    await fs.access(path.join(root, 'public', 'index.php'))
    const ftpUsername = singleLine(request.ftpUsername, 'FTP username', 512)
    const ftpPassword = singleLine(request.ftpPassword, 'FTP password')
    const targetRoot = remotePath(request.ftpRemotePath)
    const { secrets, generated } = resolveSecrets(request)
    const allowedRoots = ['src', 'public', 'migrations']
    const files = (await Promise.all(allowedRoots.map((folder) => listFiles(path.join(root, folder))))).flat()
    for (const file of files) {
      const relative = path.relative(root, file).replaceAll('\\', '/')
      await upload(ftp, `${targetRoot}/${relative}`, file, ftpUsername, ftpPassword)
    }
    const temp = await fs.mkdtemp(path.join(app.getPath('temp'), 'blueplm-mdb-env-'))
    const envPath = path.join(temp, '.env')
    try {
      await fs.writeFile(envPath, environment(request, secrets, publicUrl), { mode: 0o600 })
      await upload(ftp, `${targetRoot}/.env`, envPath, ftpUsername, ftpPassword)
    } finally {
      await fs.rm(temp, { recursive: true, force: true })
    }
    await migrate(publicUrl, secrets.maintenanceToken)
    return { success: true, setupUrl: new URL('/setup/', publicUrl).toString(), generatedSecrets: generated }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'MDB installation could not be completed.' }
  }
}

export function registerMdbInstallerHandlers(): void {
  ipcMain.handle('mdb-installer:provision', async (_event, request: MdbProvisionRequest) => await provision(request))
}

export function unregisterMdbInstallerHandlers(): void { ipcMain.removeHandler('mdb-installer:provision') }
