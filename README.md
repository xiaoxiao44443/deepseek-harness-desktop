# DeepSeek Harness Desktop

DeepSeek Harness 的轻量 Electron 桌面壳。Harness 仍是完整、未修改的官方 Web UI；桌面端只增加原生窗口、自定义标题栏、进程托管和独立的 Harness 运行时更新。

## 架构

- Electron 主进程只负责窗口、更新和 Harness 子进程，不承载 Agent 业务。
- Harness 使用 Electron 内置 Node 24 以独立进程运行：`dsh web --port 0`。
- 发布包把 Harness 与 npm 更新器作为单独的运行时归档分发；每个桌面壳版本首次启动时原子解包一次，后续直接复用，不依赖 `app.asar` 的依赖裁剪结果。
- 页面仅绑定 `127.0.0.1` 的随机端口，并嵌入沙箱化 iframe；主壳与 Harness DOM 隔离，Harness 不获得 Electron IPC。
- 桌面壳 renderer 使用 React 19 + TypeScript + Vite，开发模式支持 HMR；Harness 页面和进程生命周期仍由 Electron 主进程独立托管。
- 桌面端不覆盖 `DSH_HOME`：Harness 遵循官方解析顺序（显式配置、`$DSH_HOME`、`~/.dsh`）。因此外部 dsh 与桌面端自然共享配置、会话、Profile、凭据和扩展；项目工作区仍由 Harness 自己管理。
- 桌面壳自己的 Chromium 状态、运行时、更新缓存和开发设置统一位于 `~/.saltfish/deepseek-harness-desktop`，Windows、macOS 与 Linux 使用同一目录约定。
- Harness 核心安装在版本化目录。新版本先进入 staging，npm 完整性校验和 `dsh --version` 验证通过后才标记待更新；下次启动先试运行新版本，健康检查失败会自动回退。
- 桌面端为每个受管 Harness 运行时生成同源的 `dsh`、`pnpm` 和 `node` 启动器，并把它们注入 Harness 进程的 `PATH`。因此标题菜单里的开发操作、Harness 自己的终端和 Agent 启动的子进程使用的是同一套版本，不会出现“壳能用、dsh 自己不能用”的分叉。

官方仓库提到未来 Electron 可通过 `file:// + IPC bridge` 运行，但当前发布包尚未提供可直接使用的桥接适配器。本项目把载体封装在 `HarnessProcess` 与 `WindowController` 内，后续可以替换而不影响更新器和用户数据。

## 开发

要求 Node.js 24+ 与 pnpm 11。

```powershell
pnpm install
pnpm dev
```

`pnpm dev` 会先编译 Electron 主进程，再并行启动 Vite 与 Electron。修改 `src/renderer` 下的 React/CSS 会热更新桌面壳，不会重启 Harness；修改主进程代码后需重启开发命令。

发布版默认禁用 Chromium DevTools；`pnpm dev` 保留调试能力，方便开发桌面壳。

检查：

```powershell
pnpm typecheck
pnpm test
```

构建 Windows 安装包：

```powershell
pnpm package:win
```

Windows 卸载程序会询问是否一并删除 `~/.saltfish/deepseek-harness-desktop`。该选项默认关闭；无论如何都不会删除官方 Harness 共用的 `~/.dsh`。

构建 macOS Intel 安装包（最低 macOS 12）：

```bash
pnpm package:mac:intel
```

Harness 运行时包含平台相关的原生依赖，因此 `prepare:runtime` 必须在目标平台和架构上执行，Windows 生成的 `harness-runtime.tgz` 不能用于 macOS。仓库提供 `.github/workflows/build-macos-intel.yml`，可以在 GitHub Actions 的 Intel macOS Runner 上手动构建 DMG 和 ZIP。当前产物未签名，适合测试；公开分发前还需要接入 Developer ID 签名和 Apple 公证。

macOS 使用原生红黄绿窗口按钮，桌面壳自己的状态仍位于 `~/.saltfish/deepseek-harness-desktop`，Harness 官方数据仍位于 `~/.dsh`。

## Harness 开发能力

标题栏菜单中的“开发工具”提供官方开发流程的桌面入口：

- **Patch 配置**：选择 `yml`、`yaml` 或 `json`，重启后等价于 `dsh web --patch <配置文件>`。路径会保存，下次启动继续使用；清除后恢复普通启动。
- **Plugin 命令**：填写 Profile 和 pnpm 参数，等价于 `dsh plugin --profile <名称> <参数...>`。参数会先解析为参数数组，不经系统 Shell 拼接。
- **创造模式**：继续使用 Harness 内置预设，桌面端不复制或修改 Harness 界面。

同样的命令也可以直接在 Harness 内部终端执行，例如：

```powershell
dsh --version
pnpm --version
dsh plugin --profile default add ./scratch-plugin
```

Patch 是 Harness Web 服务的启动参数，因此要通过桌面菜单应用；Plugin 和普通 dsh/pnpm 命令则可在桌面入口与 Harness 内部双向使用。

## 更新策略

桌面端启动 15 秒后检查 npm 的 `@deepseek-ai/dsh` `latest` 标签，此后每 6 小时检查一次。下载完成后标题栏显示“已就绪”；点击可重启应用，也可以在下次正常启动时自动应用。Harness 核心更新与未来桌面壳自身更新相互独立。
