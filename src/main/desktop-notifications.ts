import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Notification } from 'electron'
import type { BrowserWindow } from 'electron'

export type TurnCompletionNotificationMode = 'never' | 'unfocused' | 'always'
export type DesktopNotificationKind = 'turn-complete' | 'approval' | 'question'

export interface DesktopNotificationSettings {
  turnCompletion: TurnCompletionNotificationMode
  permissionRequests: boolean
  questions: boolean
}

export interface DesktopNotificationRequest {
  kind: DesktopNotificationKind
  sessionId: string
  sessionTitle?: string
  key?: string
}

export interface DesktopNotificationActions {
  getWindow(): BrowserWindow | undefined
  openSession(sessionId: string): void
}

export const DEFAULT_DESKTOP_NOTIFICATION_SETTINGS: DesktopNotificationSettings = {
  turnCompletion: 'unfocused',
  permissionRequests: true,
  questions: true,
}

export class DesktopNotificationService {
  private settings: DesktopNotificationSettings = { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS }

  constructor(
    private readonly settingsPath: string,
    private readonly actions: DesktopNotificationActions,
  ) {}

  async initialize(): Promise<void> {
    this.settings = await readDesktopNotificationSettings(this.settingsPath)
  }

  get currentSettings(): DesktopNotificationSettings {
    return { ...this.settings }
  }

  async updateSettings(value: unknown): Promise<DesktopNotificationSettings> {
    this.settings = normalizeDesktopNotificationSettings(value)
    await writeDesktopNotificationSettings(this.settingsPath, this.settings)
    return this.currentSettings
  }

  async show(requestValue: unknown): Promise<boolean> {
    const request = normalizeDesktopNotificationRequest(requestValue)
    if (request === undefined || !this.shouldNotify(request.kind) || !Notification.isSupported()) return false

    const title = request.kind === 'turn-complete'
      ? 'DeepSeek Harness 已完成回复'
      : request.kind === 'approval'
        ? 'DeepSeek Harness 需要权限确认'
        : 'DeepSeek Harness 正在等待你的输入'
    const sessionTitle = normalizeSessionTitle(request.sessionTitle)
    const body = request.kind === 'turn-complete'
      ? `${sessionTitle}的回复已完成。`
      : request.kind === 'approval'
        ? `${sessionTitle}需要你确认权限后才能继续。`
        : `${sessionTitle}需要你的回答后才能继续。`
    const notification = new Notification({
      title,
      body,
      ...(request.key !== undefined ? { tag: request.key } : {}),
    })
    notification.on('click', () => this.actions.openSession(request.sessionId))
    return await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (shown: boolean): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(shown)
      }
      notification.once('show', () => finish(true))
      notification.once('failed', (_event, error) => {
        console.warn(`[desktop-notifications] native notification failed: ${error}`)
        finish(false)
      })
      const timeout = setTimeout(() => finish(false), 5_000)
      timeout.unref()
      notification.show()
    })
  }

  private shouldNotify(kind: DesktopNotificationKind): boolean {
    if (kind === 'approval') return this.settings.permissionRequests
    if (kind === 'question') return this.settings.questions
    if (this.settings.turnCompletion === 'never') return false
    if (this.settings.turnCompletion === 'always') return true
    const window = this.actions.getWindow()
    return window === undefined || window.isDestroyed() || window.isMinimized() || !window.isFocused()
  }
}

export function normalizeDesktopNotificationSettings(value: unknown): DesktopNotificationSettings {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS }
  }
  const candidate = value as Record<string, unknown>
  const turnCompletion = candidate.turnCompletion === 'never'
    || candidate.turnCompletion === 'unfocused'
    || candidate.turnCompletion === 'always'
    ? candidate.turnCompletion
    : DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.turnCompletion
  return {
    turnCompletion,
    permissionRequests: typeof candidate.permissionRequests === 'boolean'
      ? candidate.permissionRequests
      : DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.permissionRequests,
    questions: typeof candidate.questions === 'boolean'
      ? candidate.questions
      : DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.questions,
  }
}

export async function readDesktopNotificationSettings(path: string): Promise<DesktopNotificationSettings> {
  try {
    return normalizeDesktopNotificationSettings(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return { ...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS }
  }
}

export async function writeDesktopNotificationSettings(
  path: string,
  settings: DesktopNotificationSettings,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

function normalizeDesktopNotificationRequest(value: unknown): DesktopNotificationRequest | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  if (candidate.kind !== 'turn-complete' && candidate.kind !== 'approval' && candidate.kind !== 'question') return undefined
  if (typeof candidate.sessionId !== 'string' || candidate.sessionId.length === 0 || candidate.sessionId.length > 240) return undefined
  if (/[\r\n\0]/u.test(candidate.sessionId)) return undefined
  return {
    kind: candidate.kind,
    sessionId: candidate.sessionId,
    ...(typeof candidate.sessionTitle === 'string' ? { sessionTitle: candidate.sessionTitle } : {}),
    ...(typeof candidate.key === 'string' && candidate.key.length <= 500 ? { key: candidate.key } : {}),
  }
}

function normalizeSessionTitle(value: string | undefined): string {
  const normalized = value?.replace(/[\r\n\0]+/gu, ' ').trim().slice(0, 120)
  return normalized === undefined || normalized.length === 0 ? '当前对话' : `“${normalized}”`
}
