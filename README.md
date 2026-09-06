# DeepSeek Harness：互联网热梗字幕插件

这是可被 DeepSeek Harness profile 安装的 **Bundle**，不是 Harness 源码内部包，也不是 Vite 演示。

```text
src/index.ts       # Host 事件白名单 + 静态脚本/SSE 路由
src/bridge.ts      # 独立浏览器字幕层，不依赖 dsh.client 解析
cordis.patch.yml   # dsh.bundle 激活层
package.json       # 标准 dsh.bundle 外部包声明
```

## 安装

在本插件根目录先构建，再安装到 Web profile：

```powershell
pnpm install
pnpm run build
dsh plugin --profile web add file:.
dsh --profile web --dump-config
dsh web
```

`--dump-config` 输出中应出现 `# == dsh-plugin-internet-meme` 与 `internet-meme-subtitles`。安装或更新 Bundle 后需重启 Web profile。

从 Git 安装时，`prepare` 会构建 `lib/`；pnpm 10+ 可能要求在该 profile 的 `pnpm-workspace.yaml` 为本包显式设置 `allowBuilds: true`，然后重新执行 add。

插件通过标准 Bundle 的 Host 入口观察 `turn/start`、`step/start`、`tool/call`、`tool/result` 和 `turn/end`，仅把事件种类、时间、工具名、调用 ID、错误标志经 SSE 投影到浏览器。浏览器脚本独立渲染侧边字幕，因此能兼容无法从 profile 解析 `dsh.client` 的 DSH 版本。它不会改写会话、不会注册模型 Provider/Tool，也不读取回答正文、思维链、工具参数或工具结果正文。

## 使用

打开 DSH Web 页面后，页面不会再有控制卡片。发送一条消息或让 Agent 调用工具时，右侧字幕会从底部向上漂移，在顶部逐渐淡出和模糊。字幕使用三条独立轨道和发射间隔调度，避免多条信息堆叠遮挡；文案直接显示为短句，不含方括号或“弹幕”前缀。

在 DSH 的“设置”左侧导航中会新增“热梗字幕”。点击它后，右侧会单独显示本插件的设置项，不会混在通用设置或插件配置列表中：

- 显示开关、弹幕密度、最大同屏条数、字号、透明度、顶部淡出模糊与诊断开关。
- 预览弹幕：不调用模型，直接走与真实事件相同的 Host → SSE → 浏览器渲染链路，便于快速确认插件是否生效。
- 按事件配色与图标：思考、工具调用、工具结果和完成状态各有独立的柔和颜色和图标；也可切换为克制单色或关闭图标。
- 四套内置主题：经典热梗、职场摸鱼、二次元燃系、赛博终端。
- 自定义文案池：每行一条，可使用 `{tool}` 自动代入工具名。

这些设置只保存在当前浏览器的 `localStorage`，不写入 DSH 会话，也不进入模型消息流。

## 当前边界

- 有：纯 UI 字幕、三轨防重叠调度、右侧上浮淡出动画、事件配色和图标、原生设置内配置、三档密度/字号、最大同屏数、透明度/模糊度、四套主题、自定义文案池、诊断开关、工具结果名称回填、过期自动清理、历史事件不回放。
- 没有：BGM 播放、联网热梗生成、将字幕写回会话、读取任何回答/推理/参数正文。

后续 BGM 应作为单独的、用户明确开启的客户端音频模块加入，不能默认自动播放。
