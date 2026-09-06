# Agent 开发指南

本文供后续维护本项目的开发者与 AI Agent 使用，依据当前源码、构建配置和 README 整理。

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
| `tsdown.config.ts` | 两个构建入口：Host 输出 ESM，浏览器输出 IIFE，目标均为 ES2022 |
| `cordis.patch.yml` | Bundle 激活配置，插件 ID 为 `internet-meme-subtitles`，注入 `webServer` |
| `package.json` | 包导出、发布文件、构建脚本和 `dsh.bundle.patch` 声明 |
| `lib/index.js`、`lib/bridge.js` | 构建产物；应修改 `src/` 后重新构建，不直接手改产物 |
| `README.md` | 面向使用者的安装、使用与功能边界说明 |
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
| `/preview` | 仅接受 POST；广播一条工具调用预览事件并返回 204，其他方法返回 405 |

当前订阅集合没有按会话过滤，真实事件和预览事件会广播给所有已连接的订阅者。不要将其描述为“仅当前会话可见”。

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
- 默认开启字幕，标准密度/字号、86% 透明度、轻柔模糊、经典主题、按事件配色、显示图标、最多 4 条、关闭诊断。
- 三条轨道按可用时间调度；队列最多保留 8 项，连续待发的同类思考步骤或工具调用会合并计数。
- 同屏数量达到上限时直接移除最早节点；字幕也会按生命周期定时清理。
- 字幕层不接收指针事件，文案用 `textContent` 写入，另有 `aria-live` 辅助播报。
- 原生设置集成依赖 DSH 弹窗的 DOM 结构。宿主升级后，应重点验证导航插入、面板切换和原有设置恢复。
- 新增事件类型时，同步检查 Host 白名单、两端 Pulse 类型、主题文案与事件视觉映射。
- 修改密度或持续时间时，同时检查调度函数、清理定时器和 CSS 动画时长。
- 修改本地设置结构时考虑已有存储数据；当前读取只做默认值合并，不是完整的值域校验。
- Host 资源在 `ctx.effect` 返回的清理函数中统一释放；新增监听器、路由或连接时应维护这一生命周期。

当前脚本通过 Host 注入独立 IIFE，不使用 `dsh.client` 或 `window.__ModuleLoader__`。排查时应以当前源码为准。

## 5. 安装与运行

前提：已准备好可用的 Node.js、pnpm 和 DSH CLI。项目不提供 DSH 的安装脚本；不要擅自全局安装工具或修改系统配置。

在项目根目录执行：

```powershell
pnpm install
pnpm run build
dsh plugin --profile web add file:.
dsh --profile web --dump-config
dsh web
```

- `prepare` 会执行构建；显式运行 `pnpm run build` 可用于单独验证构建。
- 配置输出应包含 `# == dsh-plugin-internet-meme` 和 `internet-meme-subtitles`。
- 安装或更新 Bundle 后，需要重启对应 Web profile 才能加载更新。
- 从 Git 安装及 pnpm 构建脚本授权说明参见 README；处理前确认实际 CLI 提示与目标 profile。
- 当前只有 `build`、`prepare` 脚本，没有 `dev`、`test`、`lint` 或独立类型检查脚本。

## 6. 开发约定

1. 修改前阅读相关源码和配置，保持最小改动，不顺带重构无关代码。
2. 复杂需求先给出简短技术方案，经用户确认后实现。
3. 删除、重命名、全局安装依赖、修改系统配置等操作，必须先确认。
4. 不随意增加第三方依赖；确有必要时先说明原因，不修改项目外无关目录。
5. 对齐现有 TypeScript 风格：两空格缩进、单引号、通常省略行末分号；浏览器源码已有紧凑多语句写法，避免无关格式化。
6. 保留既有中文界面与文案风格，命令、路径和技术标识符保持准确。
7. 文案扩展不能引入对回答、推理、参数或结果正文的读取与传输。
8. 功能或安装方式变化时同步更新 README 和本文；不要用文档承诺尚未实现的行为。

## 7. 验证与交付

### 代码改动

先运行 `pnpm run build`，确认生成两个入口产物。构建成功不等于完整类型检查，也不证明 DSH 页面中的功能正常。

涉及运行行为时，按以下顺序验收：

1. 安装 Bundle、检查配置并重启 Web profile。
2. 确认页面正常加载，脚本路由成功返回、SSE 连接建立，无持续的启动错误。
3. 打开设置，确认“热梗字幕”独立导航可用，切回原生设置后内容恢复，重复开关弹窗不会重复插入。
4. 点击“预览弹幕”，同时检查 POST 返回 204、SSE 收到事件、页面出现字幕。请求网络异常时按钮有本地显示回退，因此仅看到字幕不能证明 Host 链路成功。
5. 发起真实对话并触发工具调用，检查思考、工具调用、工具结果和完成字幕，以及工具名称回填。
6. 检查开关、密度、同屏上限、字号、透明度、模糊、主题、自定义 `{tool}`、配色和图标；刷新后确认设置保留。
7. 检查窄屏布局、字幕可读性和页面点击操作；确认刷新后不回放历史事件。
8. 开启诊断检查数据边界，验收后按需要关闭。

当前没有自动化测试套件。涉及 Host API 或 DSH 兼容性时，需要在实际宿主验证；单独打开 `dist/index.html` 不能代替插件验收。

### 仅文档改动

核对路径、脚本、事件名和描述与当前源码一致即可，无需为文档重建产物或安装 Bundle。

交付时说明修改内容、实际执行的验证和未验证项。当前目录未检测到 Git 仓库，不能默认使用 `git diff` 作为检查方式；后续若纳入 Git，再使用 `git diff --check` 等工具。
