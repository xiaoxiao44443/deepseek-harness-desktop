import { EventEmitter } from 'node:events'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, session, WebContentsView, type Rectangle, type WebContents } from 'electron'
import type {
  BrowserAgentOpenMode,
  BrowserDisplayMode,
  BrowserMenuKind,
  ColorTheme,
  DesktopBrowserHistoryEntry,
  DesktopBrowserMenuAnchor,
  DesktopBrowserSettings,
  DesktopBrowserShellSnapshot,
  DesktopBrowserState,
  DesktopBrowserViewBounds,
  DesktopBrowserViewport,
  DesktopBrowserNavigationAction,
  HarnessUpdateStatus,
} from '../shared/contracts.js'
import type { DesktopContextMenuRequest } from '../shared/context-menu.js'

const BROWSER_PARTITION = 'persist:dsh-desktop-browser'
const BROWSER_PRELOAD = fileURLToPath(new URL('../browser-preload.cjs', import.meta.url))
const BROWSER_WINDOW_PRELOAD = fileURLToPath(new URL('../browser-window-preload.cjs', import.meta.url))
const BROWSER_MENU_PRELOAD = fileURLToPath(new URL('../browser-menu-preload.cjs', import.meta.url))
const POINTER_CHANNEL = 'desktop-browser:pointer'
const FLOATING_ACTION_CHANNEL = 'desktop-browser:floating-action'
const FLOATING_STATE_CHANNEL = 'desktop-browser:floating-state'
const MENU_STATE_CHANNEL = 'desktop-browser:menu-state'
const PAGE_MENU_ACTION_CHANNEL = 'desktop-browser:page-menu-action'
const FLOATING_TOOLBAR_HEIGHT = 90
const FLOATING_DEVICE_TOOLBAR_HEIGHT = 44
const MENU_SHADOW_PADDING = 28
const MENU_OFFSCREEN_BOUNDS: Rectangle = Object.freeze({ x: -32_000, y: -32_000, width: 1, height: 1 })
const MAX_HISTORY_ENTRIES = 500
const MAX_SNAPSHOT_TEXT = 14_000
const MAX_SNAPSHOT_ELEMENTS = 220
const BACKGROUND_VIEWPORT = Object.freeze({ width: 1280, height: 800 })
const EMPTY_BROWSER_URL = `data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{width:100%;height:100%;margin:0}</style></head><body></body></html>')}`

type BrowserOverlayMenuKind = BrowserMenuKind | 'context'

export interface DesktopApplicationMenuState {
  appVersion: string
  harnessVersion?: string
  updateStatus: HarnessUpdateStatus
  updateVersion?: string
  patchEnabled: boolean
}

function themedDocument(source: string, theme: ColorTheme): string {
  return source.replace('<html lang="zh-CN"', `<html lang="zh-CN" data-theme="${theme}"`)
}

const BROWSER_MENU_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>
:root{color-scheme:light dark;font-family:Inter,"Segoe UI Variable","Microsoft YaHei UI",sans-serif;--bg:rgba(232,236,244,.62);--text:#2a2d33;--muted:#686d76;--hover:rgba(38,43,52,.07);--active:rgba(38,43,52,.11);--border:rgba(25,28,34,.13)}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}body{padding:${String(MENU_SHADOW_PADDING)}px}#root{display:grid;max-height:100%;overflow:auto;padding:4px;color:var(--text);border:1px solid var(--border);border-radius:8px;background:var(--bg);box-shadow:0 14px 34px rgba(0,0,0,.22),0 3px 9px rgba(0,0,0,.13),inset 0 1px rgba(255,255,255,.36);backdrop-filter:blur(16px) saturate(1.45);-webkit-backdrop-filter:blur(16px) saturate(1.45);animation:enter 105ms cubic-bezier(.2,.76,.28,1) both}.item{display:grid;width:100%;min-height:34px;grid-template-columns:18px minmax(0,1fr) 18px;align-items:center;gap:9px;padding:0 9px;color:var(--text);text-align:left;border:0;border-radius:7px;background:transparent;font:inherit;font-size:13px}.context-item{min-height:31px;grid-template-columns:16px minmax(0,1fr);gap:7px;padding:0 8px;border-radius:6px;font-size:12.5px}.context-item.danger{color:#ef737b}.context-item>span:first-child{display:grid;width:16px;height:16px;place-items:center;color:var(--muted)}.context-item.danger>span:first-child{color:currentColor}.context-item svg{width:14px;height:14px;stroke-width:1.7}.context-item>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item:hover:not(:disabled),.icon-button:hover:not(:disabled),.zoom-row button:hover:not(:disabled),.history-entry:hover{background:var(--hover)}.item:active:not(:disabled){background:var(--active)}button:disabled{opacity:.38}.item svg,.icon-button svg,.zoom-row svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;color:var(--muted)}.item>svg:last-child{color:var(--text)}.separator{height:1px;margin:4px 7px;background:var(--border)}.zoom-row{display:grid;min-height:38px;grid-template-columns:minmax(0,1fr) 28px 50px 28px 28px;align-items:center;gap:2px;padding:0 9px;font-size:13px}.zoom-row button,.icon-button{display:grid;width:28px;height:28px;place-items:center;padding:0;color:var(--muted);border:0;border-radius:7px;background:transparent;font:inherit}.zoom-row strong{text-align:center;font-weight:500}.history-head{display:grid;height:38px;grid-template-columns:30px 1fr 30px;align-items:center;padding:0 4px}.history-head strong{font-size:13px;font-weight:600}.history-list{display:grid;min-height:0;overflow:auto;gap:2px}.history-entry{display:block;width:100%;padding:8px 9px;color:var(--text);text-align:left;border:0;border-radius:7px;background:transparent;font:inherit}.history-entry strong,.history-entry small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-entry strong{font-size:12.5px;font-weight:500}.history-entry small{margin-top:3px;color:var(--muted);font-size:11px}.empty{padding:26px 8px;color:var(--muted);text-align:center;font-size:12px}@keyframes enter{from{opacity:0;transform:translateY(-2px) scale(.98)}to{opacity:1;transform:none}}@media(prefers-color-scheme:dark){:root{--bg:rgba(31,33,38,.66);--text:#f0f1f4;--muted:#b1b4bd;--hover:rgba(255,255,255,.09);--active:rgba(255,255,255,.14);--border:rgba(255,255,255,.11)}}:root[data-theme="light"]{color-scheme:light;--bg:rgba(232,236,244,.62);--text:#2a2d33;--muted:#686d76;--hover:rgba(38,43,52,.07);--active:rgba(38,43,52,.11);--border:rgba(25,28,34,.13)}:root[data-theme="dark"]{color-scheme:dark;--bg:rgba(31,33,38,.66);--text:#f0f1f4;--muted:#b1b4bd;--hover:rgba(255,255,255,.09);--active:rgba(255,255,255,.14);--border:rgba(255,255,255,.11)}
:root,:root[data-theme="light"]{--bg:#f7f8fa}:root[data-theme="dark"]{--bg:#24262b}#root{background:var(--bg);box-shadow:0 12px 28px rgba(0,0,0,.2),0 3px 8px rgba(0,0,0,.12);backdrop-filter:none;-webkit-backdrop-filter:none;animation:none}.application{display:flex!important;min-height:150px;flex-direction:column;padding:0!important;overflow:hidden!important}.application-list{display:grid;flex:1;align-content:center;gap:2px;padding:6px}.application-item{min-height:43px;grid-template-columns:minmax(0,1fr) auto 9px;padding:0 12px}.application-item>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.application-item .meta{overflow:hidden;max-width:130px;color:var(--muted);font-size:12px;text-overflow:ellipsis;white-space:nowrap}.application-item .dot{width:7px;height:7px;border-radius:50%;background:#8d929b;opacity:0}.application-item .dot.active{opacity:1}.application-item .dot.busy{background:#d49435}.application-item .dot.ready{background:#2fa66f}.application-item .dot.error{background:#d95762}.application-footer{display:flex;height:39px;flex:none;align-items:center;justify-content:space-between;padding:0 18px;color:var(--muted);border-top:1px solid var(--border);font-size:12px}
</style></head><body><div id="root"></div></body></html>`

const FLOATING_WINDOW_HTML = `<!doctype html>
<html lang="zh-CN"><head>
  <meta charset="UTF-8" /><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" /><meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>DeepSeek Harness 浏览器</title>
  <style>
    :root { color-scheme:light dark; font-family:Inter,"Segoe UI Variable","Microsoft YaHei UI",sans-serif; --text:#252a32; --muted:#6d7480; --bg:rgba(247,248,250,.97); --hover:rgba(29,34,43,.075); --border:rgba(30,34,42,.13); --menu-bg:rgba(248,249,252,.38); --menu-text:#2a2d33; --menu-muted:#686d76; --menu-border:rgba(25,28,34,.13); --menu-hover:rgba(38,43,52,.07); --menu-active:rgba(38,43,52,.11); }
    * { box-sizing:border-box; } html,body { width:100%;height:100%;margin:0;overflow:hidden;background:#f5f6f8; }
    .chrome { height:${String(FLOATING_TOOLBAR_HEIGHT)}px;border-bottom:1px solid var(--border);background:var(--bg);user-select:none; }
    .tabbar,.toolbar,.device-toolbar { display:flex;align-items:center;gap:7px; }
    .tabbar { height:42px;padding:5px 8px 3px;-webkit-app-region:drag; }
    .toolbar { height:48px;padding:6px 8px; }
    button,form,input,.tab { -webkit-app-region:no-drag; }
    button { display:grid;width:34px;height:34px;flex:none;place-items:center;padding:0;color:var(--muted);border:0;border-radius:9px;background:transparent; }
    button:hover:not(:disabled),button[aria-expanded="true"] { color:var(--text);background:var(--hover); } button:disabled { opacity:.32; }
    button svg,.tab svg,.address svg { fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round; }
    button svg { width:18px;height:18px; }
    .tab { display:flex;min-width:0;max-width:320px;height:32px;align-items:center;gap:9px;padding:0 13px;color:var(--text);border-radius:10px;background:var(--hover);font-size:13px; }
    .tab svg { width:16px;height:16px;flex:none;color:#4877ed; }.tab-title { overflow:hidden;min-width:0;text-overflow:ellipsis;white-space:nowrap; }
    .panel-controls { display:flex;margin-left:auto;gap:3px; }.address { display:flex;min-width:120px;height:35px;flex:1;align-items:center;gap:8px;padding:0 12px;border:1px solid transparent;border-radius:18px;background:var(--hover);box-shadow:0 0 0 0 transparent;transition:border-color 180ms ease,background-color 180ms ease,box-shadow 180ms ease; }
    .address:hover:not(:focus-within) { border-color:rgba(37,42,50,.09);background:rgba(29,34,43,.09);box-shadow:0 0 0 3px rgba(37,42,50,.035); }.address:focus-within { border-color:rgba(72,119,237,.5);background:#fff;box-shadow:0 0 0 3px rgba(72,119,237,.08); }.address svg { width:16px;height:16px;flex:none;color:var(--muted);transition:color 180ms ease; }.address:hover svg,.address:focus-within svg { color:var(--text); }
    .address input { min-width:0;height:100%;flex:1;padding:0;color:var(--text);border:0;outline:0;background:transparent;font:inherit;font-size:13px;user-select:text; }
    #window-maximize .restore { display:none; } #window-maximize.maximized .maximize { display:none; } #window-maximize.maximized .restore { display:block; }
    #browser-mode svg { display:none; } #browser-mode[data-mode="split"] .mode-split,#browser-mode[data-mode="drawer"] .mode-drawer,#browser-mode[data-mode="floating"] .mode-floating { display:block; }
    #browser-reload.loading svg { animation:spin .8s linear infinite; }
    .menu { position:fixed;z-index:10;top:38px;right:44px;display:grid;width:max-content;min-width:174px;max-width:min(300px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;padding:4px;color:var(--menu-text);border:1px solid var(--menu-border);border-radius:8px;background:var(--menu-bg);box-shadow:0 20px 48px rgba(0,0,0,.32),0 5px 14px rgba(0,0,0,.18),inset 0 1px rgba(255,255,255,.09);backdrop-filter:blur(16px) saturate(1.45);-webkit-backdrop-filter:blur(16px) saturate(1.45); }
    .menu[hidden] { display:none; }.menu.settings { top:80px;right:8px;min-width:230px; }.menu.history { top:80px;right:8px;width:min(360px,calc(100vw - 16px)); }
    .menu-item { display:grid;width:100%;min-height:31px;grid-template-columns:16px minmax(0,1fr) 16px;align-items:center;gap:7px;padding:0 8px;color:var(--menu-text);text-align:left;border:0;border-radius:6px;background:transparent;font:inherit;font-size:12.5px; }
    .menu-item:hover:not(:disabled) { background:var(--menu-hover); }.menu-item:active:not(:disabled) { background:var(--menu-active); }.menu-item svg { width:14px;height:14px;color:var(--menu-muted); }.menu-separator { height:1px;margin:3px 6px;background:var(--menu-border); }
    .check { opacity:0; }.menu-item[aria-checked="true"] .check { opacity:1; }.zoom-row { display:grid;min-height:36px;grid-template-columns:minmax(0,1fr) 26px 48px 26px 26px;align-items:center;gap:2px;padding:0 8px;font-size:12.5px; }.zoom-row button { width:26px;height:26px;border-radius:6px; }.zoom-row strong { text-align:center;font-weight:500; }
    .history-head { display:flex;align-items:center;justify-content:space-between;padding:5px 8px 8px;font-size:13px;font-weight:600; }.history-head button { width:27px;height:27px; }.history-list { display:grid;gap:2px; }.history-entry { display:block;width:100%;height:auto;padding:7px 8px;text-align:left; }.history-entry strong,.history-entry small { display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }.history-entry strong { color:var(--menu-text);font-size:12.5px;font-weight:500; }.history-entry small { margin-top:3px;color:var(--menu-muted);font-size:11px; }.history-empty { padding:20px 8px;color:var(--menu-muted);text-align:center;font-size:12px; }
    .device-toolbar { height:${String(FLOATING_DEVICE_TOOLBAR_HEIGHT)}px;padding:5px 9px;color:var(--muted);border-top:1px solid var(--border);font-size:12px; }.device-toolbar[hidden] { display:none; }.device-toolbar strong { color:var(--text); }.device-toolbar input { width:65px;height:29px;padding:0 7px;color:var(--text);text-align:center;border:1px solid var(--border);border-radius:8px;outline:0;background:var(--hover);font:inherit;appearance:textfield; }.device-toolbar input::-webkit-inner-spin-button { appearance:none; }.device-toolbar .close-device { margin-left:auto; }
    .device-outline { position:fixed;z-index:4;pointer-events:none;box-shadow:0 12px 36px rgba(0,0,0,.12),0 0 0 1px var(--border); }.device-outline[hidden]{display:none}.resize-handle{--handle-line:rgba(110,116,128,.72);position:absolute;pointer-events:auto;border-radius:0;background:rgba(110,116,128,.12);touch-action:none;transition:background 120ms ease}.resize-handle:hover{background:rgba(110,116,128,.28)}.resize-handle.n,.resize-handle.s{right:0;left:0;height:14px;cursor:ns-resize}.resize-handle.n{top:-14px}.resize-handle.s{bottom:-14px}.resize-handle.e,.resize-handle.w{top:0;bottom:0;width:14px;cursor:ew-resize}.resize-handle.e{right:-14px}.resize-handle.w{left:-14px}.resize-handle.ne,.resize-handle.nw,.resize-handle.se,.resize-handle.sw{width:14px;height:14px}.resize-handle.ne{top:-14px;right:-14px;cursor:nesw-resize}.resize-handle.nw{top:-14px;left:-14px;cursor:nwse-resize}.resize-handle.se{right:-14px;bottom:-14px;cursor:nwse-resize}.resize-handle.sw{bottom:-14px;left:-14px;cursor:nesw-resize}.resize-handle.n:after,.resize-handle.e:after,.resize-handle.s:after,.resize-handle.w:after,.resize-handle.se:after{position:absolute;border-radius:0;background:var(--handle-line);content:""}.resize-handle.n:after,.resize-handle.s:after{top:3px;left:50%;width:42px;height:3px;transform:translateX(-50%);box-shadow:0 5px var(--handle-line)}.resize-handle.e:after,.resize-handle.w:after{top:50%;left:3px;width:3px;height:42px;transform:translateY(-50%);box-shadow:5px 0 var(--handle-line)}.resize-handle.se:after{right:2px;bottom:2px;width:9px;height:9px;border-right:3px solid var(--muted);border-bottom:3px solid var(--muted);border-radius:0;background:transparent}
    @keyframes spin { to { transform:rotate(360deg); } }
    @media(prefers-color-scheme:dark){:root{--text:#f1f2f5;--muted:#b8bbc4;--bg:rgba(25,27,31,.97);--hover:rgba(255,255,255,.075);--border:rgba(255,255,255,.1);--menu-bg:rgba(31,33,38,.6);--menu-text:#f0f1f4;--menu-muted:#b1b4bd;--menu-border:rgba(255,255,255,.11);--menu-hover:rgba(255,255,255,.09);--menu-active:rgba(255,255,255,.14)}html,body{background:#101114}.address:hover:not(:focus-within){border-color:rgba(255,255,255,.09);background:rgba(255,255,255,.095);box-shadow:0 0 0 3px rgba(255,255,255,.035)}.address:focus-within{background:rgba(16,17,20,.9)}.address input{color:#f1f2f5}}
    :root[data-theme="light"]{color-scheme:light;--text:#252a32;--muted:#6d7480;--bg:rgba(247,248,250,.97);--hover:rgba(29,34,43,.075);--border:rgba(30,34,42,.13);--menu-bg:rgba(248,249,252,.38);--menu-text:#2a2d33;--menu-muted:#686d76;--menu-border:rgba(25,28,34,.13);--menu-hover:rgba(38,43,52,.07);--menu-active:rgba(38,43,52,.11)}html[data-theme="light"],html[data-theme="light"] body{background:#f5f6f8}html[data-theme="light"] .address:focus-within{background:#fff}html[data-theme="light"] .address input{color:#252a32}
    :root[data-theme="dark"]{color-scheme:dark;--text:#f1f2f5;--muted:#b8bbc4;--bg:rgba(25,27,31,.97);--hover:rgba(255,255,255,.075);--border:rgba(255,255,255,.1);--menu-bg:rgba(31,33,38,.6);--menu-text:#f0f1f4;--menu-muted:#b1b4bd;--menu-border:rgba(255,255,255,.11);--menu-hover:rgba(255,255,255,.09);--menu-active:rgba(255,255,255,.14)}html[data-theme="dark"],html[data-theme="dark"] body{background:#101114}html[data-theme="dark"] .address:hover:not(:focus-within){border-color:rgba(255,255,255,.09);background:rgba(255,255,255,.095);box-shadow:0 0 0 3px rgba(255,255,255,.035)}html[data-theme="dark"] .address:focus-within{background:rgba(16,17,20,.9)}html[data-theme="dark"] .address input{color:#f1f2f5}
  </style>
</head><body>
  <header class="chrome">
    <div class="tabbar"><div class="tab"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg><span id="browser-tab-title" class="tab-title">新标签页</span></div>
      <div class="panel-controls">
        <button id="window-maximize" type="button" aria-label="展开窗口" title="展开窗口"><svg class="maximize" viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></svg><svg class="restore" viewBox="0 0 24 24"><path d="m9 9-6-6M3 8V3h5M15 9l6-6M16 3h5v5M9 15l-6 6M3 16v5h5M15 15l6 6M16 21h5v-5"/></svg></button>
        <button id="browser-mode" data-mode="floating" type="button" aria-label="选择浏览器显示方式" title="显示方式：独立窗口"><svg class="mode-split" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg><svg class="mode-drawer" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/></svg><svg class="mode-floating" viewBox="0 0 24 24"><path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/></svg></button>
        <button id="browser-hide" type="button" aria-label="隐藏浏览器" title="隐藏浏览器"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18M8 9l3 3-3 3"/></svg></button>
      </div>
    </div>
    <div class="toolbar"><button id="browser-back" type="button" aria-label="后退"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button><button id="browser-forward" type="button" aria-label="前进"><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button><button id="browser-reload" type="button" aria-label="重新加载"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/></svg></button>
      <form id="browser-address-form" class="address"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg><input id="browser-address" aria-label="网页地址" placeholder="输入网址或搜索内容" spellcheck="false" /></form>
      <button id="browser-settings" type="button" aria-label="浏览器设置"><svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg></button>
    </div>
    <div id="device-toolbar" class="device-toolbar" hidden><strong>尺寸:</strong><span>响应式</span><input id="device-width" type="number" min="240" max="3840" aria-label="设备宽度"/><span>×</span><input id="device-height" type="number" min="240" max="2160" aria-label="设备高度"/><button id="device-rotate" aria-label="旋转设备"><svg viewBox="0 0 24 24"><rect width="10" height="14" x="3" y="8" rx="2"/><path d="M5 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-2.4"/><path d="M8 18h.01"/></svg></button><span id="device-zoom">100%</span><button id="device-close" class="close-device" aria-label="关闭设备工具栏"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div>
  </header>
  <div id="mode-menu" class="menu" hidden><button class="menu-item" data-mode="split" aria-checked="false"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg><span>分栏</span><svg class="check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></button><button class="menu-item" data-mode="drawer" aria-checked="false"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/></svg><span>抽屉</span><svg class="check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></button><button class="menu-item" data-mode="floating" aria-checked="true"><svg viewBox="0 0 24 24"><path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/></svg><span>独立窗口</span><svg class="check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></button></div>
  <div id="settings-menu" class="menu settings" hidden><button id="open-history" class="menu-item"><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg><span>历史记录</span><span></span></button><button id="clear-data" class="menu-item"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M7 6l1 14h8l1-14"/></svg><span>清除浏览数据</span><span></span></button><div class="menu-separator"></div><div class="zoom-row"><span>缩放</span><button id="zoom-out" aria-label="缩小">−</button><strong id="zoom-value">100%</strong><button id="zoom-in" aria-label="放大">+</button><button id="zoom-reset" aria-label="重置缩放" title="重置"><svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/></svg></button></div><div class="menu-separator"></div><button id="toggle-device" class="menu-item" aria-checked="false"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8M12 18v4"/></svg><span>显示设备工具栏</span><svg class="check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></button></div>
  <div id="history-menu" class="menu history" hidden><div class="history-head"><span>历史记录</span><button id="history-close" aria-label="关闭"><svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><div id="history-list" class="history-list"></div></div>
  <div id="device-outline" class="device-outline" hidden><div class="resize-handle n" data-direction="n"></div><div class="resize-handle e" data-direction="e"></div><div class="resize-handle s" data-direction="s"></div><div class="resize-handle w" data-direction="w"></div><div class="resize-handle ne" data-direction="ne"></div><div class="resize-handle se" data-direction="se"></div><div class="resize-handle sw" data-direction="sw"></div><div class="resize-handle nw" data-direction="nw"></div></div>
</body></html>`

export const DEFAULT_BROWSER_SETTINGS: DesktopBrowserSettings = Object.freeze({
  enabled: true,
  agentOpenMode: 'background',
  displayMode: 'split',
})

interface StoredHistory {
  entries?: unknown
}

interface BrowserSnapshotElement {
  ref: number
  tag: string
  role: string
  name: string
  value: string
  x: number
  y: number
  width: number
  height: number
  disabled: boolean
}

interface BrowserSnapshot {
  url: string
  title: string
  text: string
  width: number
  height: number
  elements: BrowserSnapshotElement[]
}

interface SnapshotTarget {
  x: number
  y: number
}

export interface DesktopBrowserAgentRequest {
  action?: unknown
  url?: unknown
  visible?: unknown
  ref?: unknown
  x?: unknown
  y?: unknown
  text?: unknown
  clear?: unknown
  deltaY?: unknown
  width?: unknown
  height?: unknown
}

export function normalizeBrowserSettings(value: unknown): DesktopBrowserSettings {
  const source = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const mode: BrowserAgentOpenMode = source.agentOpenMode === 'visible' ? 'visible' : 'background'
  const displayMode: BrowserDisplayMode = source.displayMode === 'drawer' || source.displayMode === 'floating'
    ? source.displayMode
    : 'split'
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_BROWSER_SETTINGS.enabled,
    agentOpenMode: mode,
    displayMode,
  }
}

export function normalizeBrowserAddress(value: string, allowSearch = true): string {
  const input = value.trim()
  if (input.length === 0) throw new Error('请输入网页地址。')
  if (/^https?:\/\//iu.test(input)) {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持 HTTP 和 HTTPS 网页。')
    return url.href
  }
  if (/^[\w.-]+(?::\d+)?(?:\/[^\s]*)?$/u.test(input)) {
    const hostname = input.split(/[/:]/u, 1)[0]?.toLowerCase()
    const scheme = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' ? 'http' : 'https'
    return new URL(`${scheme}://${input}`).href
  }
  if (!allowSearch) throw new Error('工具调用需要提供完整的 HTTP 或 HTTPS 地址。')
  return `https://www.bing.com/search?q=${encodeURIComponent(input)}`
}

function normalizeHistory(value: unknown): DesktopBrowserHistoryEntry[] {
  const raw = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as StoredHistory).entries
    : undefined
  if (!Array.isArray(raw)) return []
  const entries: DesktopBrowserHistoryEntry[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const source = item as Record<string, unknown>
    if (typeof source.id !== 'string' || typeof source.url !== 'string' || typeof source.title !== 'string' || typeof source.visitedAt !== 'string') continue
    if (!/^https?:\/\//iu.test(source.url) || Number.isNaN(Date.parse(source.visitedAt))) continue
    entries.push({ id: source.id, url: source.url, title: source.title, visitedAt: source.visitedAt })
    if (entries.length >= MAX_HISTORY_ENTRIES) break
  }
  return entries
}

function positiveInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} 必须是 ${String(minimum)}–${String(maximum)} 的整数。`)
  }
  return value
}

function sameBounds(left: Rectangle, right: Rectangle): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height
}

function finiteCoordinate(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} 必须是有效坐标。`)
  return value
}

export class DesktopBrowserService extends EventEmitter {
  private readonly settingsPath: string
  private readonly historyPath: string
  private readonly screenshotsPath: string
  private settings: DesktopBrowserSettings = { ...DEFAULT_BROWSER_SETTINGS }
  private history: DesktopBrowserHistoryEntry[] = []
  private window: BrowserWindow | undefined
  private floatingWindow: BrowserWindow | undefined
  private view: WebContentsView | undefined
  private readonly menuWindows = new Map<number, BrowserWindow>()
  private readonly menuWindowReady = new Map<number, Promise<void>>()
  private menuView: BrowserWindow | undefined
  private menuHostWindow: BrowserWindow | undefined
  private menuKind: BrowserOverlayMenuKind | undefined
  private menuAnchor: DesktopBrowserMenuAnchor | undefined
  private menuContextRequest: DesktopContextMenuRequest | undefined
  private menuApplicationState: DesktopApplicationMenuState | undefined
  private menuTargetBounds: Rectangle | undefined
  private menuPresented = false
  private menuRenderSequence = 0
  private readonly menuRenderWaiters = new Map<number, () => void>()
  private viewHostWindow: BrowserWindow | undefined
  private bounds: Rectangle | undefined
  private panelOpen = false
  private loading = false
  private url = ''
  private title = '浏览器'
  private zoomFactor = 1
  private viewport: DesktopBrowserViewport | undefined
  private snapshotTargets = new Map<number, SnapshotTarget>()
  private historyTimer: NodeJS.Timeout | undefined
  private viewportLayoutTimer: NodeJS.Timeout | undefined
  private viewportApplyRunning = false
  private viewportApplyDirty = false
  private browserSessionConfigured = false
  private closingFloatingWindow = false
  private floatingOverlayOpen = false
  private shellOverlayOpen = false
  private shellOverlaySnapshot: DesktopBrowserShellSnapshot | undefined
  private shellSnapshotCapture: Promise<DesktopBrowserShellSnapshot | undefined> | undefined
  private shellSnapshotGeneration = 0
  private shellOverlaySequence = 0
  private theme: ColorTheme = 'light'

  constructor(private readonly dataRoot: string) {
    super()
    this.settingsPath = join(dataRoot, 'settings.json')
    this.historyPath = join(dataRoot, 'history.json')
    this.screenshotsPath = join(dataRoot, 'screenshots')
  }

  async initialize(): Promise<void> {
    this.registerFloatingWindowIpc()
    await mkdir(this.dataRoot, { recursive: true })
    try {
      this.settings = normalizeBrowserSettings(JSON.parse(await readFile(this.settingsPath, 'utf8')))
    } catch {
      this.settings = { ...DEFAULT_BROWSER_SETTINGS }
      await this.writeJson(this.settingsPath, this.settings)
    }
    try {
      this.history = normalizeHistory(JSON.parse(await readFile(this.historyPath, 'utf8')))
    } catch {
      this.history = []
    }
  }

  setTheme(theme: ColorTheme): void {
    if (theme !== 'light' && theme !== 'dark') return
    this.theme = theme
    this.applyTheme(this.floatingWindow)
    for (const menu of this.menuWindows.values()) this.applyTheme(menu)
  }

  get state(): DesktopBrowserState {
    const contents = this.view?.webContents
    return {
      settings: { ...this.settings },
      panelOpen: this.panelOpen && this.settings.enabled,
      loading: this.loading,
      url: this.url,
      title: this.title,
      canGoBack: contents?.navigationHistory.canGoBack() ?? false,
      canGoForward: contents?.navigationHistory.canGoForward() ?? false,
      zoomFactor: this.zoomFactor,
      ...(this.viewport === undefined ? {} : { viewport: { ...this.viewport } }),
    }
  }

  async attachWindow(window: BrowserWindow): Promise<void> {
    if (this.window === window && this.view !== undefined && !this.view.webContents.isDestroyed()) return
    this.detachWindow()
    this.window = window
    await this.ensureMenuWindow(window)
    if (this.settings.enabled) {
      await this.ensureView()
      if (this.settings.displayMode === 'floating' && this.panelOpen) await this.showFloatingWindow()
    }
  }

  detachWindow(): void {
    if (this.historyTimer !== undefined) clearTimeout(this.historyTimer)
    if (this.viewportLayoutTimer !== undefined) clearTimeout(this.viewportLayoutTimer)
    this.historyTimer = undefined
    this.viewportLayoutTimer = undefined
    this.viewportApplyRunning = false
    this.viewportApplyDirty = false
    this.closeMenu()
    this.destroyMenuWindows()
    const view = this.view
    const hostWindow = this.viewHostWindow
    this.view = undefined
    this.viewHostWindow = undefined
    this.window = undefined
    this.bounds = undefined
    this.shellOverlayOpen = false
    this.shellOverlaySnapshot = undefined
    this.destroyFloatingWindow()
    if (view === undefined) return
    try { hostWindow?.contentView.removeChildView(view) } catch {}
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  async updateSettings(value: unknown): Promise<DesktopBrowserSettings> {
    this.closeMenu()
    this.shellOverlayOpen = false
    this.shellOverlaySnapshot = undefined
    const next = normalizeBrowserSettings(value)
    const previousDisplayMode = this.settings.displayMode
    const enabledChanged = next.enabled !== this.settings.enabled
    const displayModeChanged = next.displayMode !== this.settings.displayMode
    this.settings = next
    await this.writeJson(this.settingsPath, next)
    if (enabledChanged) {
      if (next.enabled) await this.ensureView()
      else {
        this.panelOpen = false
        this.destroyView()
      }
    }
    if (next.enabled && displayModeChanged) {
      if (next.displayMode === 'floating') {
        this.bounds = undefined
        if (this.panelOpen) await this.showFloatingWindow()
      } else {
        this.leaveFloatingWindow(previousDisplayMode === 'floating')
      }
    }
    this.changed()
    return { ...this.settings }
  }

  async setDisplayMode(mode: BrowserDisplayMode): Promise<void> {
    if (mode !== 'split' && mode !== 'drawer' && mode !== 'floating') return
    await this.updateSettings({ ...this.settings, displayMode: mode })
  }

  private createMenuWindow(host: BrowserWindow): BrowserWindow {
    const menu = new BrowserWindow({
      parent: host,
      modal: false,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: BROWSER_MENU_PRELOAD,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        devTools: false,
      },
    })
    menu.setMenuBarVisibility(false)
    menu.setFocusable(false)
    menu.on('closed', () => {
      if (this.menuWindows.get(host.id) === menu) {
        this.menuWindows.delete(host.id)
        this.menuWindowReady.delete(host.id)
      }
      if (this.menuView !== menu) return
      this.menuView = undefined
      this.menuHostWindow = undefined
      this.menuKind = undefined
      this.menuAnchor = undefined
      this.menuContextRequest = undefined
      this.menuApplicationState = undefined
      this.menuTargetBounds = undefined
      this.menuPresented = false
    })
    return menu
  }

  private async ensureMenuWindow(host: BrowserWindow): Promise<BrowserWindow> {
    const existing = this.menuWindows.get(host.id)
    if (existing !== undefined && !existing.isDestroyed() && !existing.webContents.isDestroyed()) {
      await this.menuWindowReady.get(host.id)
      return existing
    }
    const menu = this.createMenuWindow(host)
    this.menuWindows.set(host.id, menu)
    const ready = menu.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(themedDocument(BROWSER_MENU_HTML, this.theme))}`)
      .then(() => {
        if (menu.isDestroyed()) return
        menu.setBounds(MENU_OFFSCREEN_BOUNDS)
        menu.showInactive()
      })
      .catch((error: unknown) => {
        if (!menu.isDestroyed()) menu.destroy()
        throw error
      })
    this.menuWindowReady.set(host.id, ready)
    await ready
    return menu
  }

  private destroyMenuWindows(): void {
    this.menuView = undefined
    this.menuHostWindow = undefined
    this.menuKind = undefined
    this.menuAnchor = undefined
    this.menuContextRequest = undefined
    this.menuApplicationState = undefined
    this.menuTargetBounds = undefined
    this.menuPresented = false
    for (const resolve of this.menuRenderWaiters.values()) resolve()
    this.menuRenderWaiters.clear()
    const menus = [...this.menuWindows.values()]
    this.menuWindows.clear()
    this.menuWindowReady.clear()
    for (const menu of menus) {
      if (!menu.isDestroyed()) menu.destroy()
    }
  }

  async openPageMenu(kind: BrowserMenuKind, anchor: DesktopBrowserMenuAnchor, applicationState?: DesktopApplicationMenuState): Promise<void> {
    if (kind !== 'application' && kind !== 'display' && kind !== 'settings') return
    if (kind === 'application' && applicationState === undefined) return
    if (![anchor.x, anchor.y, anchor.width, anchor.height].every(Number.isFinite)) return
    const host = kind === 'application'
      ? this.window
      : this.settings.displayMode === 'floating'
        ? this.floatingWindow
        : this.window
    if (host === undefined || host.isDestroyed()) return
    this.closeMenu()
    const menu = await this.ensureMenuWindow(host)
    this.menuView = menu
    this.menuHostWindow = host
    this.menuKind = kind
    this.menuAnchor = { ...anchor }
    this.menuApplicationState = applicationState
    this.resizeMenu(kind === 'application' ? 326 : kind === 'display' ? 220 : 272, kind === 'application' ? 150 : kind === 'display' ? 116 : 210)
    await this.renderAndPresentMenu(menu)
  }

  async openContextMenu(request: DesktopContextMenuRequest, source: 'main' | 'floating' | 'page' = 'main'): Promise<boolean> {
    const host = source === 'floating'
      ? this.floatingWindow
      : source === 'page'
        ? this.viewHostWindow
        : this.window
    const viewBounds = this.view?.getBounds()
    const sourceMatchesHost = source === 'page'
      ? this.viewHostWindow === host
      : source === 'floating'
        ? this.floatingWindow === host
        : this.window === host
    if (
      host === undefined
      || host.isDestroyed()
      || !this.settings.enabled
      || !this.panelOpen
      || this.view === undefined
      || this.view.webContents.isDestroyed()
      || !sourceMatchesHost
      || viewBounds === undefined
      || !Number.isFinite(request.x)
      || !Number.isFinite(request.y)
    ) return false

    this.closeMenu()
    const menu = await this.ensureMenuWindow(host)
    const hostRequest = source === 'page'
      ? { ...request, x: request.x + viewBounds.x, y: request.y + viewBounds.y }
      : request
    this.menuView = menu
    this.menuHostWindow = host
    this.menuKind = 'context'
    this.menuAnchor = { x: hostRequest.x, y: hostRequest.y, width: 0, height: 0 }
    this.menuContextRequest = hostRequest
    this.menuApplicationState = undefined
    const requestedHeight = request.items.reduce((height, entry) => height + (entry.kind === 'separator' ? 9 : 31), 8)
    this.resizeMenu(212, Math.max(40, requestedHeight))
    try {
      await this.renderAndPresentMenu(menu)
      return true
    } catch {
      this.closeMenu()
      return false
    }
  }

  ownsMenuWebContents(contents: WebContents): boolean {
    return [...this.menuWindows.values()].some((menu) => !menu.isDestroyed() && menu.webContents === contents)
  }

  updateContextMenu(request: DesktopContextMenuRequest): boolean {
    const menu = this.menuView
    const current = this.menuContextRequest
    if (
      this.menuKind !== 'context'
      || menu === undefined
      || menu.isDestroyed()
      || current === undefined
      || current.requestId !== request.requestId
    ) return false
    this.menuContextRequest = { ...current, items: request.items }
    const requestedHeight = request.items.reduce((height, entry) => height + (entry.kind === 'separator' ? 9 : 31), 8)
    this.resizeMenu(212, Math.max(40, requestedHeight))
    this.sendMenuState()
    return true
  }

  closeMenu(): string | undefined {
    const menu = this.menuView
    const kind = this.menuKind
    const contextRequestId = kind === 'context' ? this.menuContextRequest?.requestId : undefined
    this.menuView = undefined
    this.menuHostWindow = undefined
    this.menuKind = undefined
    this.menuAnchor = undefined
    this.menuContextRequest = undefined
    this.menuApplicationState = undefined
    this.menuTargetBounds = undefined
    this.menuPresented = false
    if (menu === undefined) return contextRequestId
    if (!menu.isDestroyed()) menu.setBounds(MENU_OFFSCREEN_BOUNDS)
    return contextRequestId
  }

  async setZoomFactor(value: number): Promise<void> {
    if (!Number.isFinite(value)) return
    this.zoomFactor = Math.max(0.5, Math.min(2, Math.round(value * 10) / 10))
    this.invalidateShellSnapshot()
    const contents = (await this.ensureView()).webContents
    contents.setZoomFactor(this.zoomFactor)
    this.changed()
  }

  async setDeviceViewport(value: DesktopBrowserViewport | null): Promise<void> {
    this.invalidateShellSnapshot()
    if (value === null) {
      this.viewport = undefined
      const contents = this.view?.webContents
      if (contents !== undefined && !contents.isDestroyed() && contents.debugger.isAttached()) {
        await contents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
      }
      this.layoutFloatingView()
      this.changed()
      return
    }
    this.viewport = {
      width: positiveInteger(value.width, 'width', 240, 3840),
      height: positiveInteger(value.height, 'height', 240, 2160),
    }
    this.layoutFloatingView()
    await this.applyViewport()
    this.changed()
  }

  async previewDeviceViewport(value: DesktopBrowserViewport): Promise<void> {
    this.invalidateShellSnapshot()
    this.viewport = {
      width: positiveInteger(value.width, 'width', 240, 3840),
      height: positiveInteger(value.height, 'height', 240, 2160),
    }
    if (this.settings.displayMode === 'floating') this.layoutFloatingView()
    else this.scheduleViewportApply()
  }

  async setPanelOpen(open: boolean): Promise<void> {
    this.closeMenu()
    if (!this.settings.enabled) {
      this.panelOpen = false
      this.shellOverlayOpen = false
      this.shellOverlaySnapshot = undefined
      this.changed()
      return
    }
    if (open) await this.ensureView()
    this.panelOpen = open
    if (open && this.settings.displayMode === 'floating') {
      await this.showFloatingWindow()
    } else if (!open) {
      this.floatingOverlayOpen = false
      this.shellOverlayOpen = false
      this.shellOverlaySnapshot = undefined
      this.setNativeVisible(false)
      this.floatingWindow?.hide()
      this.bounds = undefined
      this.view?.setBounds({ x: 0, y: 0, ...BACKGROUND_VIEWPORT })
      await this.applyViewport()
    }
    this.changed()
  }

  async setViewBounds(value: DesktopBrowserViewBounds | null): Promise<void> {
    if (this.settings.displayMode === 'floating') {
      if (this.panelOpen && this.settings.enabled) await this.showFloatingWindow()
      return
    }
    if (value === null || !this.settings.enabled || !this.panelOpen) {
      this.bounds = undefined
      this.setNativeVisible(false)
      return
    }
    const bounds: Rectangle = {
      x: Math.max(0, Math.round(value.x)),
      y: Math.max(0, Math.round(value.y)),
      width: Math.max(1, Math.round(value.width)),
      height: Math.max(1, Math.round(value.height)),
    }
    const view = await this.ensureView()
    if (this.bounds === undefined || !sameBounds(this.bounds, bounds)) this.invalidateShellSnapshot()
    this.bounds = bounds
    view.setBounds(bounds)
    this.scheduleViewportApply()
    this.setNativeVisible(true)
  }

  async refreshShellSnapshot(): Promise<DesktopBrowserShellSnapshot | undefined> {
    if (this.shellOverlayOpen) return this.shellOverlaySnapshot
    if (this.shellSnapshotCapture !== undefined) return await this.shellSnapshotCapture
    const view = this.view
    const viewUrl = view?.webContents.getURL()
    const generation = this.shellSnapshotGeneration
    if (
      view === undefined
      || view.webContents.isDestroyed()
      || this.bounds === undefined
      || !this.settings.enabled
      || !this.panelOpen
      || this.settings.displayMode === 'floating'
    ) return undefined

    const capture = (async (): Promise<DesktopBrowserShellSnapshot | undefined> => {
      if (this.viewport !== undefined) {
        if (this.viewportLayoutTimer !== undefined) clearTimeout(this.viewportLayoutTimer)
        this.viewportLayoutTimer = undefined
        await this.applyViewport()
      }
      const viewBounds = this.bounds
      if (viewBounds === undefined || generation !== this.shellSnapshotGeneration) return undefined
      const capturedImage = await view.webContents.capturePage().catch(() => undefined)
      if (
        capturedImage === undefined
        || capturedImage.isEmpty()
        || generation !== this.shellSnapshotGeneration
        || this.view !== view
        || this.viewHostWindow !== this.window
        || this.bounds === undefined
        || !sameBounds(this.bounds, viewBounds)
        || view.webContents.getURL() !== viewUrl
        || !this.panelOpen
      ) return undefined
      // Device emulation keeps a logical viewport (for example 583x860) and
      // applies a compositor scale so it fits the smaller WebContentsView.
      // capturePage() returns that logical surface at the display's pixel
      // density, including the unused area outside the physical view. Crop in
      // captured-image pixels so the shell neither reapplies the device scale
      // nor loses the display scale factor.
      const imageSize = capturedImage.getSize()
      const captureScaleX = this.viewport === undefined ? 1 : imageSize.width / this.viewport.width
      const captureScaleY = this.viewport === undefined ? 1 : imageSize.height / this.viewport.height
      const cropWidth = Math.min(imageSize.width, Math.max(1, Math.round(viewBounds.width * captureScaleX)))
      const cropHeight = Math.min(imageSize.height, Math.max(1, Math.round(viewBounds.height * captureScaleY)))
      const image = this.viewport !== undefined
        && cropWidth > 0
        && cropHeight > 0
        && (cropWidth < imageSize.width || cropHeight < imageSize.height)
        ? capturedImage.crop({ x: 0, y: 0, width: cropWidth, height: cropHeight })
        : capturedImage
      const jpeg = image.toJPEG(80)
      if (jpeg.length === 0) return undefined
      const snapshot = {
        dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
        bounds: { ...viewBounds },
      }
      this.shellOverlaySnapshot = snapshot
      return snapshot
    })()
    this.shellSnapshotCapture = capture
    try {
      return await capture
    } finally {
      if (this.shellSnapshotCapture === capture) this.shellSnapshotCapture = undefined
    }
  }

  private invalidateShellSnapshot(): void {
    this.shellSnapshotGeneration += 1
    this.shellOverlaySnapshot = undefined
    this.shellSnapshotCapture = undefined
  }

  async setShellOverlay(value: DesktopBrowserViewBounds | null): Promise<DesktopBrowserShellSnapshot | undefined> {
    const sequence = ++this.shellOverlaySequence
    if (value === null) {
      this.shellOverlayOpen = false
      this.setNativeVisible(true)
      return undefined
    }
    const overlay: Rectangle = {
      x: Math.round(value.x),
      y: Math.round(value.y),
      width: Math.max(0, Math.round(value.width)),
      height: Math.max(0, Math.round(value.height)),
    }
    const view = this.view
    const viewBounds = this.bounds
    const overlaps = viewBounds !== undefined
      && overlay.width > 0
      && overlay.height > 0
      && overlay.x < viewBounds.x + viewBounds.width
      && overlay.x + overlay.width > viewBounds.x
      && overlay.y < viewBounds.y + viewBounds.height
      && overlay.y + overlay.height > viewBounds.y
    if (
      !overlaps
      || view === undefined
      || view.webContents.isDestroyed()
      || !this.settings.enabled
      || !this.panelOpen
      || this.settings.displayMode === 'floating'
    ) {
      this.shellOverlayOpen = false
      this.setNativeVisible(true)
      return undefined
    }
    const currentBounds = view.getBounds()
    if (this.shellOverlaySnapshot !== undefined && sameBounds(this.shellOverlaySnapshot.bounds, currentBounds)) {
      return this.shellOverlaySnapshot
    }
    const snapshot = await this.refreshShellSnapshot()
    return sequence === this.shellOverlaySequence ? snapshot : undefined
  }

  commitShellOverlay(): void {
    const viewBounds = this.view?.getBounds()
    if (
      this.shellOverlaySnapshot === undefined
      || viewBounds === undefined
      || !sameBounds(this.shellOverlaySnapshot.bounds, viewBounds)
    ) return
    this.shellOverlayOpen = true
    this.setNativeVisible(false)
  }

  async navigate(value: string, allowSearch = true): Promise<void> {
    if (!this.settings.enabled) throw new Error('内置浏览器已在设置中关闭。')
    const view = await this.ensureView()
    const url = normalizeBrowserAddress(value, allowSearch)
    await view.webContents.loadURL(url)
  }

  async navigationAction(action: DesktopBrowserNavigationAction): Promise<void> {
    const contents = (await this.ensureView()).webContents
    if (action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
    else if (action === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
    else if (action === 'reload') contents.reload()
    else if (action === 'stop') contents.stop()
  }

  getHistory(): DesktopBrowserHistoryEntry[] {
    return this.history.map((entry) => ({ ...entry }))
  }

  async clearHistory(): Promise<void> {
    this.history = []
    await this.writeJson(this.historyPath, { entries: [] })
    this.changed()
  }

  async clearBrowsingData(): Promise<void> {
    const browserSession = session.fromPartition(BROWSER_PARTITION)
    await Promise.all([
      browserSession.clearCache(),
      browserSession.clearStorageData(),
      browserSession.clearAuthCache(),
    ])
  }

  async handleAgentRequest(request: DesktopBrowserAgentRequest): Promise<Record<string, unknown>> {
    const action = typeof request.action === 'string' ? request.action : ''
    if (!this.settings.enabled && action !== 'status') throw new Error('内置浏览器已在设置中关闭。')
    if (action === 'open') {
      if (typeof request.url !== 'string') throw new Error('url 是必填项。')
      const visible = typeof request.visible === 'boolean'
        ? request.visible
        : this.settings.agentOpenMode === 'visible'
      await this.setPanelOpen(visible)
      await this.navigate(request.url, false)
      return { ok: true, url: this.url || normalizeBrowserAddress(request.url, false), visible }
    }
    if (action === 'navigate') {
      if (typeof request.url !== 'string') throw new Error('url 是必填项。')
      await this.navigate(request.url, false)
      return { ok: true, url: this.url || normalizeBrowserAddress(request.url, false) }
    }
    if (action === 'snapshot') return await this.snapshot()
    if (action === 'click') return await this.click(request)
    if (action === 'type') return await this.typeText(request)
    if (action === 'scroll') return await this.scroll(request)
    if (action === 'screenshot') return await this.screenshot()
    if (action === 'viewport') return await this.setViewport(request)
    if (action === 'visibility') {
      if (typeof request.visible !== 'boolean') throw new Error('visible 是必填布尔值。')
      await this.setPanelOpen(request.visible)
      return { ok: true, visible: this.panelOpen }
    }
    if (action === 'back' || action === 'forward' || action === 'reload' || action === 'stop') {
      await this.navigationAction(action)
      return { ok: true, action }
    }
    if (action === 'close') {
      const view = await this.ensureView()
      await view.webContents.loadURL(EMPTY_BROWSER_URL).catch(() => undefined)
      await this.setPanelOpen(false)
      this.url = ''
      this.title = '浏览器'
      this.snapshotTargets.clear()
      this.changed()
      return { ok: true }
    }
    if (action === 'status') return { ...this.state }
    throw new Error(`不支持的浏览器操作：${action || 'unknown'}`)
  }

  private registerFloatingWindowIpc(): void {
    ipcMain.handle(FLOATING_ACTION_CHANNEL, async (event, action: unknown, value?: unknown) => {
      const floating = this.floatingWindow
      if (floating === undefined || floating.isDestroyed() || event.sender !== floating.webContents || typeof action !== 'string') return
      if (action === 'ready') {
        this.sendFloatingWindowState()
        return
      }
      if (action === 'navigate' && typeof value === 'string') await this.navigate(value)
      else if (action === 'back' || action === 'forward') await this.navigationAction(action)
      else if (action === 'reload') await this.navigationAction(this.loading ? 'stop' : 'reload')
      else if (action === 'maximize') floating.isMaximized() ? floating.unmaximize() : floating.maximize()
      else if (action === 'hide' || action === 'close') await this.setPanelOpen(false)
      else if (action === 'set-mode' && (value === 'split' || value === 'drawer' || value === 'floating')) await this.setDisplayMode(value)
      else if (action === 'set-zoom' && typeof value === 'number') await this.setZoomFactor(value)
      else if (action === 'set-device-viewport') await this.setDeviceViewport(value === null ? null : value as DesktopBrowserViewport)
      else if (action === 'clear-data') await this.clearBrowsingData()
      else if (action === 'history') return this.getHistory()
      else if (action === 'open-menu' && value !== null && typeof value === 'object') {
        const request = value as { kind?: unknown; anchor?: unknown }
        if ((request.kind === 'display' || request.kind === 'settings') && request.anchor !== null && typeof request.anchor === 'object') {
          await this.openPageMenu(request.kind, request.anchor as DesktopBrowserMenuAnchor)
        }
      }
      else if (action === 'dismiss-menu') this.closeMenu()
      else if (action === 'application-action' && (value === 'development' || value === 'release-notes' || value === 'update')) {
        this.closeMenu()
        this.emit('application-menu-action', value)
      }
      else if (action === 'overlay' && typeof value === 'boolean') {
        this.floatingOverlayOpen = value
        this.setNativeVisible(!value)
      }
    })
    ipcMain.handle(PAGE_MENU_ACTION_CHANNEL, async (event, action: unknown, value?: unknown) => {
      if ((event.sender !== this.view?.webContents && event.sender !== this.menuView?.webContents) || typeof action !== 'string') return
      if (action === 'menu-ready') this.sendMenuState()
      else if (action === 'menu-rendered' && typeof value === 'number') {
        const resolve = this.menuRenderWaiters.get(value)
        if (resolve !== undefined) {
          this.menuRenderWaiters.delete(value)
          resolve()
        }
      }
      else if (action === 'resize-menu' && value !== null && typeof value === 'object') {
        const size = value as { width?: unknown; height?: unknown }
        if (typeof size.width === 'number' && typeof size.height === 'number') this.resizeMenu(size.width, size.height)
      }
      else if (action === 'reopen-context-menu' && value !== null && typeof value === 'object') {
        const point = value as { x?: unknown; y?: unknown }
        if (typeof point.x === 'number' && typeof point.y === 'number') this.reopenContextMenuUnderShadow(point.x, point.y)
      }
      else if (action === 'dismiss-menu') this.closeMenu()
      else if (action === 'application-action' && (value === 'development' || value === 'release-notes' || value === 'update')) {
        this.closeMenu()
        this.emit('application-menu-action', value)
      }
      else if (action === 'set-mode' && (value === 'split' || value === 'drawer' || value === 'floating')) { this.closeMenu(); await this.setDisplayMode(value) }
      else if (action === 'set-zoom' && typeof value === 'number') await this.setZoomFactor(value)
      else if (action === 'set-device-viewport') { this.closeMenu(); await this.setDeviceViewport(value === null ? null : value as DesktopBrowserViewport) }
      else if (action === 'clear-data') { this.closeMenu(); await this.clearBrowsingData() }
      else if (action === 'navigate' && typeof value === 'string') { this.closeMenu(); await this.navigate(value) }
    })
  }

  private async ensureFloatingWindow(): Promise<BrowserWindow> {
    const existing = this.floatingWindow
    if (existing !== undefined && !existing.isDestroyed()) return existing
    const mainBounds = this.window?.getBounds()
    const width = Math.min(1100, Math.max(720, mainBounds?.width ?? 960))
    const height = Math.min(820, Math.max(520, (mainBounds?.height ?? 720) - 80))
    const floating = new BrowserWindow({
      width,
      height,
      minWidth: 620,
      minHeight: 420,
      show: false,
      frame: false,
      backgroundColor: this.theme === 'dark' ? '#101114' : '#f5f6f8',
      title: 'DeepSeek Harness 浏览器',
      icon: app.isPackaged
        ? join(process.resourcesPath, 'app-icon.png')
        : join(app.getAppPath(), 'app-icon.png'),
      webPreferences: {
        preload: BROWSER_WINDOW_PRELOAD,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        devTools: false,
      },
    })
    this.floatingWindow = floating
    floating.webContents.on('before-mouse-event', (_event, input) => {
      if (input.type !== 'mouseDown') return
      const requestId = this.closeMenu()
      if (requestId !== undefined) this.emit('context-menu-dismiss', requestId)
    })
    floating.webContents.on('before-input-event', (_event, input) => this.closeMenuForSystemKey(input))
    floating.webContents.on('context-menu', (event, params) => {
      if (!params.isEditable || params.frame === null) return
      event.preventDefault()
      this.emit('context-menu', params, floating.webContents, 'floating')
    })
    floating.on('resize', () => {
      this.layoutFloatingView()
      this.sendFloatingWindowState()
    })
    floating.on('maximize', () => this.sendFloatingWindowState())
    floating.on('unmaximize', () => this.sendFloatingWindowState())
    floating.on('close', (event) => {
      if (this.closingFloatingWindow) return
      event.preventDefault()
      void this.setPanelOpen(false)
    })
    floating.on('closed', () => {
      if (this.floatingWindow === floating) this.floatingWindow = undefined
    })
    await floating.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(themedDocument(FLOATING_WINDOW_HTML, this.theme))}`)
    await this.ensureMenuWindow(floating)
    return floating
  }

  private async showFloatingWindow(): Promise<void> {
    const view = await this.ensureView()
    const floating = await this.ensureFloatingWindow()
    this.attachViewToWindow(view, floating)
    this.bounds = undefined
    this.layoutFloatingView()
    view.setVisible(true)
    floating.show()
    floating.focus()
    this.sendFloatingWindowState()
  }

  private leaveFloatingWindow(activateMain = false): void {
    const floating = this.floatingWindow
    if (floating !== undefined && !floating.isDestroyed()) floating.hide()
    const view = this.view
    const main = this.window
    if (view !== undefined && main !== undefined && !main.isDestroyed()) {
      this.attachViewToWindow(view, main)
      view.setVisible(false)
      if (activateMain) {
        if (main.isMinimized()) main.restore()
        main.show()
        main.focus()
      }
    }
    this.bounds = undefined
  }

  private destroyFloatingWindow(): void {
    const floating = this.floatingWindow
    this.floatingWindow = undefined
    if (floating === undefined || floating.isDestroyed()) return
    this.closingFloatingWindow = true
    try { floating.destroy() } finally { this.closingFloatingWindow = false }
  }

  private attachViewToWindow(view: WebContentsView, target: BrowserWindow): void {
    if (this.viewHostWindow === target) return
    try { this.viewHostWindow?.contentView.removeChildView(view) } catch {}
    target.contentView.addChildView(view)
    this.viewHostWindow = target
  }

  private layoutFloatingView(): void {
    const floating = this.floatingWindow
    const view = this.view
    if (floating === undefined || floating.isDestroyed() || view === undefined || view.webContents.isDestroyed()) return
    const size = floating.getContentSize()
    const width = size[0] ?? 1
    const height = size[1] ?? 1
    const toolbarHeight = FLOATING_TOOLBAR_HEIGHT + (this.viewport === undefined ? 0 : FLOATING_DEVICE_TOOLBAR_HEIGHT)
    if (this.viewport === undefined) {
      this.bounds = undefined
      view.setBounds({ x: 0, y: toolbarHeight, width: Math.max(1, width), height: Math.max(1, height - toolbarHeight) })
    } else {
      const availableWidth = Math.max(1, width - 72)
      const availableHeight = Math.max(1, height - toolbarHeight - 72)
      const scale = Math.max(0.1, Math.min(1, availableWidth / this.viewport.width, availableHeight / this.viewport.height))
      const viewWidth = Math.max(1, Math.round(this.viewport.width * scale))
      const viewHeight = Math.max(1, Math.min(availableHeight, Math.round(this.viewport.height * scale)))
      const bounds = {
        x: Math.round((width - viewWidth) / 2),
        y: toolbarHeight + Math.round((height - toolbarHeight - viewHeight) / 2),
        width: viewWidth,
        height: viewHeight,
      }
      this.bounds = bounds
      view.setBounds(bounds)
    }
    this.scheduleViewportApply()
  }

  private resizeMenu(requestedWidth: number, requestedHeight: number): void {
    const menu = this.menuView
    const host = this.menuHostWindow
    const anchor = this.menuAnchor
    if (menu === undefined || menu.isDestroyed() || menu.webContents.isDestroyed() || host === undefined || host.isDestroyed() || anchor === undefined) return
    const contentBounds = host.getContentBounds()
    const margin = 8
    // The padding only reserves room for the drawn shadow. It is not content
    // space and must not shrink the card's usable area.
    const cardWidth = Math.max(160, Math.min(Math.round(requestedWidth), Math.max(160, contentBounds.width - margin * 2)))
    const cardHeight = Math.max(40, Math.min(Math.round(requestedHeight), Math.max(40, contentBounds.height - margin * 2)))
    const width = cardWidth + MENU_SHADOW_PADDING * 2
    const height = cardHeight + MENU_SHADOW_PADDING * 2
    const isContext = this.menuKind === 'context'
    const preferredCardX = isContext
      ? Math.round(anchor.x)
      : Math.round(anchor.x + anchor.width - cardWidth)
    const belowCardY = isContext
      ? Math.round(anchor.y)
      : Math.round(anchor.y + anchor.height + 5)
    const aboveCardY = isContext
      ? Math.round(anchor.y - cardHeight)
      : Math.round(anchor.y - cardHeight - 5)
    const fitsBelow = belowCardY + cardHeight <= contentBounds.height - margin
    const fitsAbove = aboveCardY >= margin
    const preferredCardY = fitsBelow || !fitsAbove ? belowCardY : aboveCardY
    const cardX = Math.max(margin, Math.min(preferredCardX, contentBounds.width - cardWidth - margin))
    const cardY = Math.max(margin, Math.min(preferredCardY, contentBounds.height - cardHeight - margin))
    const x = cardX - MENU_SHADOW_PADDING
    const y = cardY - MENU_SHADOW_PADDING
    this.menuTargetBounds = { x: contentBounds.x + x, y: contentBounds.y + y, width, height }
    menu.setBounds(this.menuPresented
      ? this.menuTargetBounds
      : { x: MENU_OFFSCREEN_BOUNDS.x, y: MENU_OFFSCREEN_BOUNDS.y, width, height })
  }

  private reopenContextMenuUnderShadow(localX: number, localY: number): void {
    const menu = this.menuView
    const host = this.menuHostWindow
    if (
      menu === undefined
      || menu.isDestroyed()
      || host === undefined
      || host.isDestroyed()
      || !Number.isFinite(localX)
      || !Number.isFinite(localY)
    ) return

    const menuBounds = menu.getBounds()
    const hostBounds = host.getContentBounds()
    const hostX = Math.round(menuBounds.x - hostBounds.x + localX)
    const hostY = Math.round(menuBounds.y - hostBounds.y + localY)
    const requestId = this.closeMenu()
    if (requestId !== undefined) this.emit('context-menu-dismiss', requestId)
    if (hostX < 0 || hostY < 0 || hostX >= hostBounds.width || hostY >= hostBounds.height) return

    setImmediate(() => {
      if (host.isDestroyed()) return
      const view = this.view
      const viewBounds = view?.getBounds()
      const targetsPage = view !== undefined
        && !view.webContents.isDestroyed()
        && this.viewHostWindow === host
        && viewBounds !== undefined
        && hostX >= viewBounds.x
        && hostY >= viewBounds.y
        && hostX < viewBounds.x + viewBounds.width
        && hostY < viewBounds.y + viewBounds.height
      const contents = targetsPage ? view.webContents : host.webContents
      if (contents.isDestroyed()) return
      const x = targetsPage && viewBounds !== undefined ? hostX - viewBounds.x : hostX
      const y = targetsPage && viewBounds !== undefined ? hostY - viewBounds.y : hostY
      contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'right', clickCount: 1 })
      contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'right', clickCount: 1 })
    })
  }

  private async renderAndPresentMenu(menu: BrowserWindow): Promise<void> {
    const token = ++this.menuRenderSequence
    const rendered = new Promise<void>((resolve) => this.menuRenderWaiters.set(token, resolve))
    this.sendMenuState(token)
    await Promise.race([
      rendered,
      new Promise<void>((resolve) => setTimeout(resolve, 120)),
    ])
    this.menuRenderWaiters.delete(token)
    if (this.menuView !== menu || menu.isDestroyed() || this.menuTargetBounds === undefined) return
    this.menuPresented = true
    menu.setBounds(this.menuTargetBounds)
  }

  private closeMenuForSystemKey(input: { key: string; alt: boolean; meta: boolean }): void {
    const key = input.key.toLowerCase()
    if (!input.alt && !input.meta && key !== 'alt' && key !== 'meta' && key !== 'os' && key !== 'super') return
    const requestId = this.closeMenu()
    if (requestId !== undefined) this.emit('context-menu-dismiss', requestId)
  }

  private sendMenuState(renderToken?: number): void {
    const menu = this.menuView
    const kind = this.menuKind
    if (menu === undefined || menu.isDestroyed() || menu.webContents.isDestroyed() || menu.webContents.isLoadingMainFrame() || kind === undefined) return
    menu.webContents.send(MENU_STATE_CHANNEL, {
      kind,
      state: this.state,
      history: kind === 'settings' ? this.getHistory() : [],
      ...(renderToken === undefined ? {} : { renderToken }),
      ...(kind === 'application' && this.menuApplicationState !== undefined
        ? { application: this.menuApplicationState }
        : {}),
      ...(kind === 'context' && this.menuContextRequest !== undefined ? { context: this.menuContextRequest } : {}),
    })
  }

  private applyTheme(target: BrowserWindow | undefined): void {
    if (target === undefined || target.isDestroyed() || target.webContents.isDestroyed()) return
    if (target === this.floatingWindow) target.setBackgroundColor(this.theme === 'dark' ? '#101114' : '#f5f6f8')
    if (target.webContents.isLoadingMainFrame()) return
    void target.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(this.theme)}`).catch(() => undefined)
  }

  private sendFloatingWindowState(): void {
    const floating = this.floatingWindow
    if (floating === undefined || floating.isDestroyed() || floating.webContents.isLoadingMainFrame()) return
    floating.webContents.send(FLOATING_STATE_CHANNEL, {
      loading: this.loading,
      url: this.url,
      title: this.title,
      canGoBack: this.view?.webContents.navigationHistory.canGoBack() ?? false,
      canGoForward: this.view?.webContents.navigationHistory.canGoForward() ?? false,
      maximized: floating.isMaximized(),
      displayMode: this.settings.displayMode,
      zoomFactor: this.zoomFactor,
      viewport: this.viewport ?? null,
      viewBounds: this.view?.getBounds() ?? null,
    })
  }

  private async ensureView(): Promise<WebContentsView> {
    if (!this.settings.enabled) throw new Error('内置浏览器已在设置中关闭。')
    if (this.view !== undefined && !this.view.webContents.isDestroyed()) return this.view
    const window = this.window
    if (window === undefined || window.isDestroyed()) throw new Error('桌面窗口尚未准备完成。')
    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        preload: BROWSER_PRELOAD,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: true,
      },
    })
    this.view = view
    view.setBounds({ x: 0, y: 0, ...BACKGROUND_VIEWPORT })
    view.setVisible(false)
    window.contentView.addChildView(view)
    this.viewHostWindow = window
    const contents = view.webContents
    contents.setZoomFactor(this.zoomFactor)
    contents.backgroundThrottling = false
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//iu.test(url)) void this.navigate(url, false)
      return { action: 'deny' }
    })
    contents.on('before-mouse-event', (_event, input) => {
      if (input.type !== 'mouseDown') return
      const requestId = this.closeMenu()
      if (requestId !== undefined) this.emit('context-menu-dismiss', requestId)
    })
    contents.on('before-input-event', (_event, input) => this.closeMenuForSystemKey(input))
    contents.on('context-menu', (event, params) => {
      if (params.frame === null) return
      event.preventDefault()
      this.emit('context-menu', params, contents, 'page')
    })
    contents.on('will-navigate', (event, target) => {
      if (target === 'about:blank' || /^https?:\/\//iu.test(target)) return
      event.preventDefault()
    })
    contents.on('did-start-loading', () => {
      this.loading = true
      this.shellOverlaySnapshot = undefined
      this.changed()
    })
    contents.on('did-stop-loading', () => {
      this.loading = false
      this.capturePageState()
      this.scheduleHistoryRecord()
      this.changed()
    })
    contents.on('did-navigate', () => {
      this.snapshotTargets.clear()
      this.capturePageState()
      this.scheduleHistoryRecord()
      this.changed()
    })
    contents.on('did-navigate-in-page', () => {
      this.snapshotTargets.clear()
      this.capturePageState()
      this.scheduleHistoryRecord()
      this.changed()
    })
    contents.on('page-title-updated', (_event, title) => {
      this.title = title.trim() || '浏览器'
      this.scheduleHistoryRecord()
      this.changed()
    })
    if (!this.browserSessionConfigured) {
      this.browserSessionConfigured = true
      contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
      contents.session.on('will-download', (event) => event.preventDefault())
    }
    await contents.loadURL(EMPTY_BROWSER_URL).catch(() => undefined)
    return view
  }

  private destroyView(): void {
    this.closeMenu()
    const view = this.view
    const hostWindow = this.viewHostWindow
    this.view = undefined
    this.viewHostWindow = undefined
    this.bounds = undefined
    this.snapshotTargets.clear()
    this.shellOverlayOpen = false
    this.shellOverlaySnapshot = undefined
    this.destroyFloatingWindow()
    if (view === undefined) return
    try { hostWindow?.contentView.removeChildView(view) } catch {}
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  private setNativeVisible(visible: boolean): void {
    const view = this.view
    if (view === undefined || view.webContents.isDestroyed()) return
    const floatingVisible = this.settings.displayMode === 'floating'
      && this.floatingWindow?.isVisible() === true
      && this.viewHostWindow === this.floatingWindow
    view.setVisible(visible && !this.floatingOverlayOpen && !this.shellOverlayOpen && this.panelOpen && this.settings.enabled && (floatingVisible || this.bounds !== undefined))
  }

  private capturePageState(): void {
    const contents = this.view?.webContents
    if (contents === undefined || contents.isDestroyed()) return
    const current = contents.getURL()
    this.url = /^https?:\/\//iu.test(current) ? current : ''
    this.title = contents.getTitle().trim() || '浏览器'
  }

  private scheduleHistoryRecord(): void {
    if (this.historyTimer !== undefined) clearTimeout(this.historyTimer)
    this.historyTimer = setTimeout(() => {
      this.historyTimer = undefined
      void this.recordHistory()
    }, 450)
  }

  private async recordHistory(): Promise<void> {
    this.capturePageState()
    if (!/^https?:\/\//iu.test(this.url)) return
    const now = new Date().toISOString()
    const entry: DesktopBrowserHistoryEntry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      url: this.url,
      title: this.title === '浏览器' ? this.url : this.title,
      visitedAt: now,
    }
    this.history = [entry, ...this.history.filter((item) => item.url !== entry.url)].slice(0, MAX_HISTORY_ENTRIES)
    await this.writeJson(this.historyPath, { entries: this.history })
  }

  private async debuggerCommand(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const contents = (await this.ensureView()).webContents
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
    return await contents.debugger.sendCommand(method, params)
  }

  private async snapshot(): Promise<Record<string, unknown>> {
    const expression = `(() => {
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01
          && rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0
          && rect.top < innerHeight && rect.left < innerWidth;
      };
      const label = (element) => {
        const aria = element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('alt');
        const text = aria || element.innerText || element.textContent || element.getAttribute('placeholder') || '';
        return String(text).replace(/\\s+/g, ' ').trim().slice(0, 180);
      };
      const candidates = [...document.querySelectorAll('a[href],button,input,textarea,select,summary,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])')]
        .filter(visible).slice(0, ${String(MAX_SNAPSHOT_ELEMENTS)});
      return {
        url: location.href,
        title: document.title,
        width: innerWidth,
        height: innerHeight,
        text: String(document.body?.innerText || '').slice(0, ${String(MAX_SNAPSHOT_TEXT)}),
        elements: candidates.map((element, index) => {
          const rect = element.getBoundingClientRect();
          const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
          return {
            ref: index + 1,
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute('role') || '',
            name: label(element),
            value: input && element.type !== 'password' ? String(element.value || '').slice(0, 180) : '',
            x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height),
            disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true')
          };
        })
      };
    })()`
    const response = await this.debuggerCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: unknown } }
    const value = response.result?.value as BrowserSnapshot | undefined
    if (value === undefined || !Array.isArray(value.elements)) throw new Error('无法读取当前网页。')
    this.snapshotTargets.clear()
    const lines = value.elements.map((element) => {
      this.snapshotTargets.set(element.ref, {
        x: element.x + Math.max(1, element.width) / 2,
        y: element.y + Math.max(1, element.height) / 2,
      })
      const role = element.role || element.tag
      const name = element.name ? ` “${element.name}”` : ''
      const currentValue = element.value ? ` value="${element.value}"` : ''
      const disabled = element.disabled ? ' disabled' : ''
      return `[${String(element.ref)}] ${role}${name}${currentValue}${disabled} @ (${String(element.x)},${String(element.y)}) ${String(element.width)}×${String(element.height)}`
    })
    const snapshot = [
      `URL: ${value.url}`,
      `Title: ${value.title}`,
      `Viewport: ${String(value.width)}×${String(value.height)}`,
      '',
      'Visible text:',
      value.text.trim() || '(empty)',
      '',
      'Interactive elements:',
      lines.join('\n') || '(none)',
    ].join('\n')
    return { url: value.url, title: value.title, viewport: { width: value.width, height: value.height }, snapshot }
  }

  private targetFromRequest(request: DesktopBrowserAgentRequest): SnapshotTarget {
    if (typeof request.ref === 'number') {
      const ref = positiveInteger(request.ref, 'ref', 1, MAX_SNAPSHOT_ELEMENTS)
      const target = this.snapshotTargets.get(ref)
      if (target === undefined) throw new Error('这个元素引用已失效，请重新调用 browser_snapshot。')
      return target
    }
    return { x: finiteCoordinate(request.x, 'x'), y: finiteCoordinate(request.y, 'y') }
  }

  private async click(request: DesktopBrowserAgentRequest): Promise<Record<string, unknown>> {
    const target = this.targetFromRequest(request)
    await this.pointer(target.x, target.y, false)
    await this.debuggerCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y })
    await this.pointer(target.x, target.y, true)
    await this.debuggerCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 })
    await this.debuggerCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
    await this.pointer(target.x, target.y, false)
    return { ok: true, x: Math.round(target.x), y: Math.round(target.y) }
  }

  private async typeText(request: DesktopBrowserAgentRequest): Promise<Record<string, unknown>> {
    if (typeof request.text !== 'string') throw new Error('text 是必填项。')
    if (request.ref !== undefined || request.x !== undefined || request.y !== undefined) await this.click(request)
    if (request.clear === true) {
      await this.debuggerCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 })
      await this.debuggerCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
      await this.debuggerCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
      await this.debuggerCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 })
    }
    await this.debuggerCommand('Input.insertText', { text: request.text })
    return { ok: true, characters: request.text.length }
  }

  private async scroll(request: DesktopBrowserAgentRequest): Promise<Record<string, unknown>> {
    const x = request.x === undefined ? (this.viewport?.width ?? this.bounds?.width ?? BACKGROUND_VIEWPORT.width) / 2 : finiteCoordinate(request.x, 'x')
    const y = request.y === undefined ? (this.viewport?.height ?? this.bounds?.height ?? BACKGROUND_VIEWPORT.height) / 2 : finiteCoordinate(request.y, 'y')
    const deltaY = typeof request.deltaY === 'number' && Number.isFinite(request.deltaY) ? request.deltaY : 560
    await this.pointer(x, y, false)
    await this.debuggerCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY })
    return { ok: true, deltaY }
  }

  private async screenshot(): Promise<Record<string, unknown>> {
    const response = await this.debuggerCommand('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    }) as { data?: unknown }
    if (typeof response.data !== 'string' || response.data.length === 0) throw new Error('网页截图失败。')
    await mkdir(this.screenshotsPath, { recursive: true })
    const path = join(this.screenshotsPath, `browser-${new Date().toISOString().replaceAll(/[:.]/gu, '-')}.png`)
    await writeFile(path, Buffer.from(response.data, 'base64'))
    return { ok: true, path, url: this.url }
  }

  private async setViewport(request: DesktopBrowserAgentRequest): Promise<Record<string, unknown>> {
    if (request.width === undefined && request.height === undefined) {
      await this.setDeviceViewport(null)
      return { ok: true, viewport: null }
    }
    const width = positiveInteger(request.width, 'width', 240, 3840)
    const height = positiveInteger(request.height, 'height', 240, 2160)
    await this.setDeviceViewport({ width, height })
    return { ok: true, viewport: { width, height } }
  }

  private async applyViewport(): Promise<void> {
    const viewport = this.viewport
    if (viewport === undefined || this.view === undefined) return
    const width = this.bounds?.width ?? viewport.width
    const height = this.bounds?.height ?? viewport.height
    const scale = Math.max(0.1, Math.min(1, width / viewport.width, height / viewport.height))
    await this.debuggerCommand('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
      scale,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    })
  }

  private scheduleViewportApply(): void {
    this.viewportApplyDirty = true
    if (this.viewportLayoutTimer !== undefined || this.viewportApplyRunning) return
    this.viewportLayoutTimer = setTimeout(() => {
      this.viewportLayoutTimer = undefined
      void this.flushViewportApply()
    }, 8)
  }

  private async flushViewportApply(): Promise<void> {
    if (this.viewportApplyRunning) return
    this.viewportApplyRunning = true
    try {
      while (this.viewportApplyDirty) {
        this.viewportApplyDirty = false
        await this.applyViewport()
      }
    } finally {
      this.viewportApplyRunning = false
      if (this.viewportApplyDirty) this.scheduleViewportApply()
    }
  }

  private async pointer(x: number, y: number, pressed: boolean): Promise<void> {
    const contents = this.view?.webContents
    if (contents === undefined || contents.isDestroyed()) return
    contents.send(POINTER_CHANNEL, { x, y, pressed })
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(this.dataRoot, { recursive: true })
    const temporary = `${path}.${String(process.pid)}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  }

  private changed(): void {
    this.sendFloatingWindowState()
    this.sendMenuState()
    this.emit('state', this.state)
  }
}
