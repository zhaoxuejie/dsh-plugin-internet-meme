# AGENT.md：开发与维护指南

本文供后续维护本项目的开发者与 AI Agent 使用，依据当前源码、构建配置和 README 整理。面向普通用户的安装与截图说明以 `README.md` 为准；本文只记录维护时需要遵守的实现边界和验证方式。

## 1. 项目定位

本项目是可安装到 DeepSeek Harness Web profile 的外部 Bundle，包名为 `dsh-plugin-internet-meme`。它监听 Agent 生命周期事件，在 Web 页面右侧显示向上漂移、淡出和模糊的热梗字幕。

- 属于 UI 增强插件，不是独立聊天应用，也不是 Harness 源码内部包。
- 不注册模型 Provider 或 Tool，不改写会话，不向模型消息流插入文案。
- 不转发回答正文、推理正文、工具参数或工具结果正文。
- 当前没有 BGM 或联网文案生成；若扩展音频，必须由用户明确开启，不能默认自动播放。

## 2. 目录与构建

| 路径 | 职责 |
| --- | --- |
| `src/index.ts` | Host 入口：监听事件、筛选元数据、注册脚本/SSE/预览路由、释放资源 |
| `src/bridge.ts` | 浏览器入口：字幕文案、三轨调度、CSS、设置面板、localStorage 与 SSE 连接 |
| `src/settings.ts` | 设置默认值、类型与范围校验、文案长度限制 |
| `src/queue.ts` | 浏览器事件类型、队列合并、容量及过载丢弃策略 |
| `tests/correctness.test.mjs` | 使用 Node.js 内置测试运行器验证配置、队列与 Host 协议 |
| `tsdown.config.ts` | 两个构建入口：Host 输出 ESM，浏览器输出 IIFE，目标均为 ES2022 |
| `cordis.patch.yml` | Bundle 激活配置，插件 ID 为 `internet-meme-subtitles`，注入 `webServer` |
| `package.json` | 包导出、发布文件、构建脚本和 `dsh.bundle.patch` 声明 |
| `lib/index.js`、`lib/bridge.js` | 构建产物；应修改 `src/` 后重新构建，不直接手改产物 |
| `README.md` | 面向使用者的安装、使用与功能边界说明 |
| `AGENT.md` | 面向维护者的架构、约束与验证说明 |
| `dist/` | 存在静态页面产物，但当前构建配置和包入口不引用它 |
| `packages/`、`patches/` | 当前主构建未引用；不要仅凭目录名将其当作有效入口 |
| `pnpm-lock.yaml` | pnpm 依赖锁文件 |

当前技术栈为 TypeScript、Node.js Host API、原生浏览器 DOM/EventSource 和 tsdown。浏览器入口没有框架依赖。`@deepseek-ai/cordis` 是 peer dependency，版本范围见 `package.json`。

## 3. 运行链路

1. DSH 安装 Bundle 后，加载 `cordis.patch.yml` 中的插件配置。
2. Host 调用 `apply(ctx)`，读取同目录下的 `bridge.js`，通过 `webserver/index-inject` 向页面 head 注入脚本地址。
3. Host 全局监听 `session/event`，把五类事件映射为精简的 `Pulse`。
4. Host 向已连接的 SSE 客户端广播 Pulse；没有历史事件缓存或回放逻辑。
5. 浏览器选择主题文案、替换 `{tool}`，经过队列与三条轨道调度后渲染字幕。
6. 浏览器通过 `MutationObserver` 查找原生设置弹窗，插入“热梗字幕”导航和独立设置面板。

### HTTP 路由

统一前缀为 `/plugins/dsh-plugin-internet-meme`。

| 路由 | 行为 |
| --- | --- |
| `/bridge.js` | 返回浏览器脚本，禁用缓存 |
| `/events` | SSE 长连接，声明 3000 ms 重连间隔 |
| `/preview` | 仅接受 POST；校验可选的 `X-Meme-Preview-Id` 并通过 SSE 回传，返回 204；错误标识返回 400，其他方法返回 405 |

当前订阅集合没有按会话过滤，真实事件和预览事件仍会广播给所有已连接的订阅者。新版浏览器只处理与自身待完成请求匹配的带标识预览事件；这不等于服务端隔离。不要将真实事件描述为“仅当前会话可见”。

### 事件映射与数据边界

| Host 事件 | Pulse.kind | 附加信息 |
| --- | --- | --- |
| `turn/start` | `turn-start` | 时间、序号 |
| `step/start` | `step-start` | 时间、序号 |
| `tool/call` | `tool-call` | 时间、序号、工具名、调用 ID |
| `tool/result` | `tool-result` | 时间、序号、调用 ID、首个结果片段的 `isError` 标志 |
| `turn/end` | `turn-end` | 时间、序号 |

浏览器使用调用 ID 关联工具名。Host 虽然检查结果结构中的错误标志，但不会转发结果正文。诊断日志可能包含工具名和调用 ID，不应宣称其完全匿名。

## 4. 浏览器功能与维护要点

- 四套内置主题：经典热梗、职场摸鱼、二次元燃系、赛博终端；另支持逐行输入的自定义文案池。
- 本地设置键为 `dsh-plugin-internet-meme.settings.v2`，只保存到当前浏览器的 localStorage。
- 提示音默认关闭，使用浏览器 Web Audio 合成短音，无外部音频资源；点击“预览弹幕”会在用户手势内触发一次试听。可选朗读仅用于固定的失败和本轮结束状态，不读取或朗读热梗、工具名、回答及工具内容。
- 默认开启字幕，标准密度/字号、86% 透明度、轻柔模糊、经典主题、按事件配色、显示图标、最多 4 条、关闭诊断。
- 三条轨道按可用时间调度；队列最多保留 8 项，连续待发的同类思考步骤会合并计数，工具通知仅在工具名与非空调用 ID 均相同时合并。队列过载优先丢弃普通事件，保留失败和结束事件，但仍受容量上限约束。
- 同屏数量达到上限时直接移除最早节点；字幕也会按生命周期定时清理。
- 字幕层不接收指针事件，文案用 `textContent` 写入，另有 `aria-live` 辅助播报。
- 原生设置集成依赖 DSH 弹窗的 DOM 结构。宿主升级后，应重点验证导航插入、面板切换和原有设置恢复。
- 新增事件类型时，同步检查 Host 白名单、两端 Pulse 类型、主题文案与事件视觉映射。
- 修改密度或持续时间时，同时检查调度函数、清理定时器和 CSS 动画时长。
- 修改本地设置结构时同步更新 `normalizeSettings()` 与测试。当前按白名单校验类型、枚举及数字范围；自定义文案最多 100 条，每条 200 字符。存储写入失败时保留内存设置并提示。
- 音效只有在页面可见、字幕和提示音均开启、音量大于 0 且系统未请求减少动态效果时才播放。连续事件最少间隔 2.2 秒；不要改为默认开启、外部下载音频或朗读会话内容。
- 失败工具结果使用警示图标与固定失败文案；缺少明确错误标志时使用中性文案。自定义文案不覆盖失败及未知结果提示。
- 透明度滑块在 `input` 时只更新样式和标签，在 `change` 时保存，不能重建该滑块。
- Host 资源在 `ctx.effect` 返回的清理函数中统一释放；新增监听器、路由或连接时应维护这一生命周期。

当前脚本通过 Host 注入独立 IIFE，不使用 `dsh.client` 或 `window.__ModuleLoader__`。排查时应以当前源码为准。

## 5. 安装与运行

前提：已准备好可用的 Node.js、pnpm 和 DSH CLI。项目不提供 DSH 的安装脚本；不要擅自全局安装工具或修改系统配置。

普通用户通过 DSH 直接安装公开版本：

```powershell
dsh plugin --profile web add github:zhaoxuejie/dsh-plugin-internet-meme#v0.4.4
dsh --profile web --dump-config
```

本地开发或从源码安装时，在项目根目录执行：

```powershell
pnpm install
pnpm run build
dsh plugin --profile web add link:.
dsh --profile web --dump-config
```

- `prepare` 会执行构建；显式运行 `pnpm run build` 可用于单独验证构建。
- 配置输出应包含 `# == dsh-plugin-internet-meme` 和 `internet-meme-subtitles`。
- 安装或更新 Bundle 后，需要用户自行重启对应 Web profile 才能加载更新。不要由 Agent 停止、启动或重启 DSH 服务，除非用户在当前请求中明确要求。
- `link:.` 直接使用当前目录，构建新产物后无需重新 add；`file:.` 会安装副本，更新时需要重新 add。
- 从 Git 安装及 pnpm 构建脚本授权说明参见 README；处理前确认实际 CLI 提示与目标 profile。
- 当前提供 `build`、`prepare`、`test`、`typecheck:client` 脚本；没有 `dev` 或 `lint` 脚本。

## 6. 开发约定

1. 修改前阅读相关源码和配置，保持最小改动，不顺带重构无关代码。
2. 复杂需求先给出简短技术方案，经用户确认后实现。
3. 删除、重命名、全局安装依赖、修改系统配置等操作，必须先确认。
4. 不随意增加第三方依赖；确有必要时先说明原因，不修改项目外无关目录。
5. 不主动重启 DSH 服务；完成构建、安装或配置检查后，提示用户自行重启并完成浏览器验收。
6. 对齐现有 TypeScript 风格：两空格缩进、单引号、通常省略行末分号；浏览器源码已有紧凑多语句写法，避免无关格式化。
7. 保留既有中文界面与文案风格，命令、路径和技术标识符保持准确。
8. 文案扩展不能引入对回答、推理、参数或结果正文的读取与传输。
9. 功能或安装方式变化时同步更新 README 和本文；不要用文档承诺尚未实现的行为。

## 7. 验证与交付

### 代码改动

运行 `pnpm run test`（包含构建及 Node.js 回归测试）、`pnpm run typecheck:client` 和 `git diff --check`。客户端类型检查不覆盖 Host API 兼容性；这些检查也不能代替实际浏览器验收。

涉及运行行为时，按以下顺序验收：

1. 安装 Bundle、检查配置，并提示用户自行重启 Web profile。
2. 确认页面正常加载，脚本路由成功返回、SSE 连接建立，无持续的启动错误。
3. 打开设置，确认“热梗字幕”独立导航可用，切回原生设置后内容恢复，重复开关弹窗不会重复插入。
4. 点击“预览弹幕”，检查 POST 成功、SSE 回传相同预览 ID、字幕可见及成功反馈。没有本地显示回退；HTTP 错误、网络错误及 12 秒超时应明确提示，错误或过期 ID 不能触发成功。
5. 发起真实对话并触发工具调用，检查思考、工具调用、工具结果和完成字幕，以及工具名称回填。
6. 检查开关、密度、同屏上限、字号、透明度、模糊、主题、自定义 `{tool}`、配色和图标；刷新后确认设置保留。
7. 检查窄屏布局、字幕可读性和页面点击操作；确认刷新后不回放历史事件。
8. 开启诊断检查数据边界，验收后按需要关闭。

自动化回归测试位于 `tests/`。涉及 Host API 或 DSH 兼容性时仍需要在实际宿主验证；单独打开 `dist/index.html` 不能代替插件验收。

### 仅文档改动

核对路径、脚本、事件名和描述与当前源码一致即可，无需为文档重建产物或安装 Bundle。

交付时说明修改内容、实际执行的验证和未验证项。项目已建立 Git 仓库，开发前基线 tag 为 `baseline-v0.4.3`，不要重复创建或移动这个基线。使用 `git diff --check` 检查空白问题。
