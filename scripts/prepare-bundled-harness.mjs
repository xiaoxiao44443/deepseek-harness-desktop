import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { create as createTar } from 'tar'

const require = createRequire(import.meta.url)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = resolve(projectRoot, 'build', 'harness-runtime')
const archivePath = resolve(projectRoot, 'build', 'harness-runtime.tgz')
const cacheRoot = resolve(projectRoot, 'build', 'npm-cache')
const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const version = manifest.devDependencies?.['@deepseek-ai/dsh']
const npmVersion = manifest.devDependencies?.npm
const pnpmVersion = manifest.devDependencies?.pnpm
const policyVersion = 3
const runtimePlatform = process.platform
const runtimeArch = process.arch
const installPolicy = {
  '@deepseek-ai/dsh-subprocess-local': true,
  '@google/genai': true,
  koffi: true,
  'node-pty': true,
  protobufjs: true,
}

if (typeof version !== 'string') throw new Error('Missing exact @deepseek-ai/dsh development dependency')
if (typeof npmVersion !== 'string') throw new Error('Missing exact npm development dependency')
if (typeof pnpmVersion !== 'string') throw new Error('Missing exact pnpm development dependency')
if (!runtimeRoot.startsWith(`${projectRoot}${sep}`)) throw new Error('Invalid bundled runtime path')

const packagePath = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const entryPath = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const npmEntryPath = join(runtimeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js')
const pnpmEntryPath = join(runtimeRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
const receiptPath = join(runtimeRoot, '.desktop-runtime.json')

let installedVersion
let installedPolicyVersion
let installedNpmVersion
let installedPnpmVersion
let installedPlatform
let installedArch
try {
  installedVersion = JSON.parse(await readFile(packagePath, 'utf8')).version
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  installedPolicyVersion = receipt.policyVersion
  installedNpmVersion = receipt.npmVersion
  installedPnpmVersion = receipt.pnpmVersion
  installedPlatform = receipt.platform
  installedArch = receipt.arch
} catch {
  installedVersion = undefined
  installedPolicyVersion = undefined
  installedNpmVersion = undefined
  installedPnpmVersion = undefined
  installedPlatform = undefined
  installedArch = undefined
}

const runtimeReady = (
  installedVersion === version
  && installedNpmVersion === npmVersion
  && installedPnpmVersion === pnpmVersion
  && installedPolicyVersion === policyVersion
  && installedPlatform === runtimePlatform
  && installedArch === runtimeArch
  && existsSync(entryPath)
  && existsSync(npmEntryPath)
  && existsSync(pnpmEntryPath)
)

if (!runtimeReady) {
  const canReuseHarness = installedVersion === version && installedPolicyVersion === policyVersion
  if (!canReuseHarness) await rm(runtimeRoot, { recursive: true, force: true })
  await Promise.all([
    mkdir(runtimeRoot, { recursive: true }),
    mkdir(cacheRoot, { recursive: true }),
  ])
  await writeFile(join(runtimeRoot, 'package.json'), `${JSON.stringify({
    name: 'deepseek-harness-desktop-runtime',
    private: true,
    allowScripts: installPolicy,
  }, null, 2)}\n`, 'utf8')

  const npmCli = join(dirname(require.resolve('npm/package.json')), 'bin', 'npm-cli.js')
  const child = spawn(process.execPath, [
    npmCli,
    'install',
    '--prefix', runtimeRoot,
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--no-save',
    '--package-lock=false',
    '--prefer-offline',
    '--strict-allow-scripts=true',
    `@deepseek-ai/dsh@${version}`,
    `npm@${npmVersion}`,
    `pnpm@${pnpmVersion}`,
  ], {
    cwd: projectRoot,
    env: {
      ...process.env,
      npm_config_cache: cacheRoot,
      npm_config_update_notifier: 'false',
    },
    stdio: 'inherit',
    windowsHide: true,
  })

  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveExit(code ?? signal))
  })

  if (exitCode !== 0) throw new Error(`Bundled Harness installation failed (${String(exitCode)})`)
  if (!existsSync(entryPath)) throw new Error('Bundled Harness entry point was not installed')
  if (!existsSync(npmEntryPath)) throw new Error('Bundled npm entry point was not installed')
  if (!existsSync(pnpmEntryPath)) throw new Error('Bundled pnpm entry point was not installed')
  await writeFile(receiptPath, `${JSON.stringify({
    version,
    npmVersion,
    pnpmVersion,
    policyVersion,
    platform: runtimePlatform,
    arch: runtimeArch,
  }, null, 2)}\n`, 'utf8')
}

if (!runtimeReady || !existsSync(archivePath)) {
  await createTar({
    cwd: runtimeRoot,
    file: archivePath,
    gzip: true,
    portable: true,
  }, ['node_modules', 'package.json', '.desktop-runtime.json'])
}

console.log(`[runtime] bundled DeepSeek Harness ${version} for ${runtimePlatform}-${runtimeArch} and archive are ready`)
