# 慕课录制 Agent（MOOC Studio Agent）

这是一个可独立启动的 Next.js 全栈应用。前端页面、后端 API、课件解析、缩略图生成、分章节口播生成、口语化改写、逐页音频、用户录音和 HTML 课件录制都在当前 `web/` 目录中。

> 结论：`web/` 是完整的程序源码目录，可以单独运行。若把它复制到另一台电脑或另一个目录，还需要重新配置环境变量、口播案例目录和本机媒体工具；`node_modules/` 与 `.next/` 不需要复制。

## 1. 当前产品流程

1. 上传课件与课纲。
2. 程序解析课件页数、标题、媒体和动效信息，并自动生成 16:9 缩略图。
3. 模型先根据完整课纲生成全课口播规划。
4. 程序按照规划中的真实章节边界分批生成口播初稿，不再固定每 5 页一批。
5. 每个章节生成时，把本章每页的真实截图作为多模态图片发送给模型。
6. 初稿完成后，立即调用独立模型进行口语化改写；口播案例只在这个环节注入。
7. 程序把每页旁白转换为带独立时间戳的 `audio_prompt`。每一页都从 `0.0s` 重新计时。
8. 用户逐页审阅，可直接改台词，也可以输入修改意图，让模型只优化当前页。
9. 审阅后可生成逐页 MP3，或使用浏览器麦克风自己录音并覆盖该页音频。
10. HTML 课件在全部音频完成后，按页生成独立 MP4 并缓存，再无损拼接为整课 MP4。

## 2. 能力与边界

| 输入或能力 | 当前状态 |
| --- | --- |
| HTML 文件 | 支持 |
| HTML + `assets/` / `images/` | 支持，需把完整目录压缩为 ZIP 上传 |
| PDF 课件 | 支持解析、缩略图、口播与音频 |
| PPTX 课件 | 有文字解析代码，但当前上传流程会因不能生成缩略图而中断，暂不算可用 |
| Markdown / TXT / DOCX 课纲 | 支持 |
| 按课纲章节分批生成 | 支持 |
| 真实页面截图多模态输入 | 支持，使用本地截图转 Base64 后随请求发送 |
| 逐页 AI 配音 | 支持 |
| 用户自己录音 | 支持 |
| HTML 课件 MP4 录制 | 支持 |
| PDF / PPTX 导出 MP4 | 当前未实现 |
| 多用户、云存储、任务队列 | 当前未实现；现在是单机 MVP |

项目数据保存在 `data/projects/`。当前实现适合本机验证，不适合直接作为多人并发的生产系统。

## 3. 运行环境

- Node.js `>= 22.13.0`
- npm
- 可访问火山方舟与豆包语音接口的网络
- FFmpeg 与 FFprobe：音频时长检测、音频合并、视频导出使用
- Poppler 的 `pdftoppm`：PDF 缩略图使用
- Chromium：Playwright 自动安装或下载，用于 HTML 缩略图与视频录制

macOS 可使用 Homebrew 安装媒体工具：

```bash
brew install ffmpeg poppler
```

## 4. 首次启动

进入本目录：

```bash
cd web
npm install
npm run dev
```

浏览器打开：

```text
http://localhost:3000
```

生产模式验证：

```bash
npm run build
npm run start
```

常用检查：

```bash
npm run lint
npx tsc --noEmit
npm test
```

说明：项目当前没有在 `package.json` 中定义 `test` 命令。当前有效的口播分段测试可使用：

```bash
node --test tests/segment-voice-script.test.mjs
```

建站脚手架遗留的 `tests/rendered-html.test.mjs` 已于 2026-08-13 清理；当前测试目录只保留有效测试。

## 5. 环境变量

项目会优先使用进程中已有的环境变量，其次读取 `web/.env.local`。本机配置已放在该文件中；它被 Git 忽略，不会提交密钥。新环境可从示例创建：

```bash
cp .env.example .env.local
```

需要配置：

| 变量 | 用途 |
| --- | --- |
| `VOLCENGINE_API_KEY` | 火山方舟 LLM 密钥 |
| `VOLCENGINE_BASE_URL` | 方舟 OpenAI 兼容接口地址 |
| `VOLCENGINE_LLM_MODEL` | 课纲规划与章节口播初稿模型 |
| `VOLCENGINE_NARRATION_MODEL` | 口语化改写与单页优化模型 |
| `VOLCENGINE_THINKING` | `enabled` 或 `disabled` |
| `VOLCENGINE_AUDIO_API_KEY` | 豆包语音密钥 |
| `VOLCENGINE_AUDIO_BASE_URL` | 豆包语音接口地址 |
| `VOLCENGINE_AUDIO_MODEL` | 语音生成模型 |
| `VOLCENGINE_AUDIO_SPEAKER` | 配音音色 / speaker ID |
| `VOICE_SCRIPT_CASES_DIR` | 口播案例 TXT 文件夹，默认 `resources/voice-script-cases` |

当前约定的模型分工：

| 环节 | 模型变量 | 当前配置 |
| --- | --- | --- |
| 课纲规划 | `VOLCENGINE_LLM_MODEL` | `doubao-seed-2-1-turbo-260628` |
| 章节口播初稿 | `VOLCENGINE_LLM_MODEL` | `doubao-seed-2-1-turbo-260628` |
| 章节口语化改写 | `VOLCENGINE_NARRATION_MODEL` | `doubao-seed-character-260628` |
| 单页按意图优化 | `VOLCENGINE_NARRATION_MODEL` | `doubao-seed-character-260628` |
| MP3 | `VOLCENGINE_AUDIO_MODEL` | 当前本机为 `seed-audio-1.0` |

不要在 README、Prompt 快照或前端代码中写入 API Key。

### 口播案例目录

口语化改写默认从项目内的 `resources/voice-script-cases` 随机选择一篇 `.txt`，并为同一门课程固定复用。选择记录保存在：

```text
data/projects/<项目ID>/generation-input/style-reference.json
```

案例文件已经包含在 `web` 内。复制整个 `web` 文件夹时无需再携带外部案例目录；只有需要改用另一套案例时才配置 `VOICE_SCRIPT_CASES_DIR`。

## 6. LLM 调用结构

### 6.1 全课规划

- System Prompt：`prompts/course-voice-plan.system.md`
- User Prompt：`prompts/course-voice-plan.user.md`
- 输入：完整课纲、页数、目标时长、受众和讲述风格
- 输出：`courseThesis`、章节范围 `sections`、逐页规划 `pages`
- 此阶段不发送截图，也不写正式口播稿

### 6.2 章节口播初稿

- System Prompt：`prompts/course-voice-script.system.md`
- User Prompt：`prompts/course-voice-batch.user.md`
- 输入：
  - 全课口播规划
  - 前面章节已完成的口播
  - 本章页码与逐页规划
  - 本章每页真实 JPG 截图
- 图片传输方式：读取本地缩略图，转成 `data:image/jpeg;base64,...`，作为多模态 `image_url` 内容发送
- 当前不再把页面可见全文或精简 HTML 作为主要写稿依据；实际视觉内容以截图为准

### 6.3 章节口语化改写

- System Prompt：`prompts/course-voice-oralize.system.md`
- User Prompt：`prompts/course-voice-oralize.user.md`
- 输入：章节初稿 JSON + 本课程固定的随机口播案例
- 只允许修改 `narration`，其他字段必须保持不变
- 程序会检查改写幅度；过于接近初稿时自动重试一次，仍不合格则本章失败

### 6.4 单页优化

- System Prompt：`prompts/course-voice-revise.system.md`
- User Prompt：`prompts/course-voice-revise.user.md`
- 输入：当前页口播、页面信息和用户的修改意图
- 只返回新的 `narration`
- 修改后已有 AI 音频会标记为“待更新音频”，不会自动重新配音

### 6.5 Prompt 注入方式

`lib/prompt.ts` 从 `prompts/` 读取模板，并替换 `{{VARIABLE}}` 占位符。存在未替换变量时会直接报错。

每次实际调用所用的完整 Prompt 都会保存到该项目的 `generation-input/`，便于复查，而不是只保留模板：

```text
generation-input/
├── plan/
│   ├── system-prompt.md
│   ├── user-prompt.md
│   └── voice-plan.json
├── chapter-01/
│   ├── system-prompt.md
│   ├── user-prompt.md
│   ├── screenshots.json
│   ├── draft-result.json
│   ├── oralize-system-prompt.md
│   ├── oralize-user-prompt.md
│   ├── oralized-result.json
│   └── result.json
└── revisions/page-01/
    ├── system-prompt.md
    ├── user-prompt.md
    └── result.json
```

`prompts/course-voice-script.user.md` 与 `lib/agent.ts` 中的 `prepareVoicePrompts()` 属于较早的整课 Prompt 快照入口，不是当前前端“规划 → 按章节生成”的主流程。

## 7. 口播输出格式

页面内部先保存结构化的 `narration`，再由程序确定性转换为最终 `audio_prompt`：

```json
{
  "page": 1,
  "title": "课程封面",
  "teachingTask": "导入",
  "audio_prompt": "#口播1\n描述：<语气沉稳，开场稍作停顿。>\n台词：\n[0.0s:12.5s]【欢迎大家来到本节课程。】"
}
```

时间戳规则：

- 每页从 `0.0s` 开始，不延续上一页时间。
- 程序根据字符数估算时长并自动分段。
- 短碎句会尽量合并，避免一两个词单独形成时间段。
- `recordingDirection` 只进入“描述”，不会作为台词朗读。

## 8. 音频与视频规则

- 初始没有音频时显示“生成音频”。
- 生成后主按钮切换为播放 / 暂停。
- 用户改了台词后显示“更新音频”。
- 更新只覆盖当前页 AI 配音。
- “优化”仅修改当前页口播，不会自动生成音频。
- “自己录音”通过浏览器麦克风录制并上传，音频来源标记为 `recording`。
- 本人录音上传后会自动执行轻度环境降噪、低频轰鸣清理、高频收束和响度标准化，再保存为 48kHz 单声道 MP3。
- AI 配音和本人录音都使用相同的多阶段语音压缩、响度分析、增益校准和峰值限制，目标为 `-16 LUFS`、最大真峰值不超过 `-1.5 dBTP`，用于保持跨页和不同音频来源之间的响度一致。
- 原始浏览器录音会以 `page-XX-recording-original.*` 保留，页面默认播放处理后的 `page-XX-recording.mp3`。
- 单页录音最大 100 MB。

### MP4 导出

- 每页使用当前选中的实际音频来源；AI 配音与本人录音可以混用。
- 每页先录制 1920×1080 的真实 HTML 画面，再合入对应音频并导出为 H.264 + AAC 的 `video/pages/page-XX.mp4`。
- 分页时长由实际音频、`visual_hold` 视觉停留和页面转场留白共同决定；音频结束后的剩余时间自动补静音。
- `video/render-manifest.json` 保存每页课件与音频签名。口播、音频、课件或时长未变化时复用已有分页视频。
- 全部分页使用统一的 30fps、H.264、AAC、48kHz 规格，最终通过 FFmpeg 无损拼接为 `course.mp4`。
- 导出进度保存在 `video-progress.json`，前端显示当前处理页和完成页数。

## 9. 目录结构

```text
web/
├── app/
│   ├── page.tsx                  主前端界面
│   ├── globals.css               全局与编辑器样式
│   └── api/                      Next.js 后端 API
├── lib/
│   ├── agent.ts                  规划、分章生成、口语化、单页优化
│   ├── parser.ts                 HTML / ZIP / PDF / PPTX 与媒体解析
│   ├── thumbnails.ts             HTML / PDF 缩略图
│   ├── media.ts                  豆包语音与媒体工具
│   ├── video.ts                  HTML 课件逐页录制、音画合成与整课拼接
│   ├── prompt.ts                 Prompt 文件读取与变量注入
│   ├── store.ts                  本地项目存储
│   ├── env.ts                    项目内环境变量读取
│   └── types.ts                  核心数据类型
├── prompts/                      实际使用的独立 Prompt 模板
├── scripts/
│   ├── render/                   正式运行使用的渲染与录制脚本
│   └── maintenance/              人工数据维护脚本
├── tests/                        时间戳与 HTML 渲染测试
├── data/projects/                本地课程、截图、Prompt、稿件、音频与视频
├── public/                       静态资源
├── .env.example                  环境变量样例
└── package.json                  依赖与启动命令
```

以下内容是依赖或缓存，不是散落的业务文件：

- `package.json`：项目依赖与运行命令，必须保留。
- `package-lock.json`：锁定依赖版本，必须保留。
- `tsconfig.json`：TypeScript 配置，必须保留。
- `next.config.ts`：Next.js 配置，必须保留。
- `postcss.config.mjs`：CSS 构建配置，必须保留。
- `eslint.config.mjs`：代码检查配置，必须保留。
- `next-env.d.ts`：Next.js 类型声明，保留并由框架维护。
- `node_modules/`：安装生成，可删除后重新 `npm install`。
- `.next/`：开发 / 构建缓存，可删除后重新生成。
- `tsconfig.tsbuildinfo`：TypeScript 缓存，可删除后重新生成。

## 10. 本地数据

每门课程位于：

```text
data/projects/<项目ID>/
```

核心文件包括：

- `project.json`：应用实际读取的项目主状态
- `outline.txt`：标准化后的课纲
- `media_manifest.json`：页面媒体与动效信息
- `voice_plan.json`：章节与逐页规划
- `voice_script.json`：最终逐页口播 Prompt
- `playback_plan.json`：翻页与画面停留计划
- `thumbnails/`：16:9 页面截图
- `audio/`：AI 配音或用户录音
- `generation-input/`：每次真实 Prompt 与中间结果

当前 `data/` 约 1.0 GB，只保留 L1 和 L2。它已被 `.gitignore` 忽略。跨电脑继续时，如果需要保留现有课程进度，必须单独复制 `data/`；如果只需要源码，可以不复制。

## 11. API 概览

| 路径 | 作用 |
| --- | --- |
| `POST /api/projects` | 上传并解析课件与课纲 |
| `GET /api/projects/list` | 读取课程列表 |
| `GET /api/projects/:id` | 读取单个课程并确保缩略图存在 |
| `POST /api/projects/:id/script` | 生成规划或指定章节口播 |
| `GET /api/projects/:id/script/progress` | 读取口播生成进度 |
| `POST /api/projects/:id/script/optimize` | 按用户意图优化当前页 |
| `POST /api/projects/:id/audio` | 生成当前页、章节或全部 MP3 |
| `GET /api/projects/:id/audio/progress` | 读取音频生成进度 |
| `POST /api/projects/:id/audio/recording` | 上传用户录音 |
| `POST /api/projects/:id/video` | 录制 HTML 课件 MP4 |

## 12. 当前状态与已知事项（2026-08-13）

已完成：

- Next.js 单页工作台与课程列表。
- HTML ZIP / PDF / PPTX 基础解析。
- HTML 与 PDF 自动缩略图。
- 课纲规划后按真实章节分批生成。
- 分批截图多模态输入与前文口播续接。
- 初稿后独立口语化改写，并在此阶段注入口播案例。
- 每页独立时间戳与短碎句合并。
- 单页口播优化、逐页 MP3、播放 / 暂停、更新音频、用户录音。
- HTML 课件视频录制代码。

需要继续复查或改进：

1. PPTX 当前不能自动生成缩略图，因此上传后会在缩略图阶段失败；需补 PPTX 渲染方案。
2. 当前数据目录只保留 L1 与 L2；后续不要在未确认项目 ID 前批量删除。
3. 口播编辑器右下角的“优化”入口刚调整为无背景的横向“图标 + 优化”，代码检查已通过，但仍需在实际浏览器中做一次视觉复查。
4. `app/globals.css` 中有多轮迭代遗留的重复覆盖规则，功能可用，但后续应在不改变界面的前提下整理样式层级。
5. 尚未加入数据库、对象存储、登录、队列、任务取消和生产部署方案。

## 13. 跨会话继续开发

新会话开始时，可以直接发送：

```text
请先完整阅读：
README.md

这是当前可独立运行的慕课录制 Agent。请以 README 的“当前状态与已知事项”为准，先检查工作区现状和正在运行的服务，不要重做已完成内容，也不要删除 data 中的项目，除非我明确指定项目 ID。接下来我要继续开发：<填写本次需求>。
```

建议新会话优先检查：

1. `git status --short`，确认用户已有修改，避免覆盖。
2. `package.json` 与 `.env.example` 的非密钥配置；实际密钥只保存在被 Git 忽略的 `.env.local` 或服务器环境变量中。
3. `app/page.tsx`、`app/globals.css` 和本次需求涉及的 `lib/` 文件。
4. `data/projects/<目标项目ID>/project.json`，确认操作对象。
5. 修改后运行 lint、TypeScript、测试与构建；涉及视觉问题时再打开本地页面复查。

## 14. 安全与维护约定

- 不输出、复制或提交 API Key。
- 不主动删除 `data/projects/` 下的课程；删除前必须核对项目 ID、标题与页数。
- 不把 `.next/`、`node_modules/`、`tsconfig.tsbuildinfo` 当成源码。
- Prompt 修改应直接编辑 `prompts/` 中对应文件，不要把完整 System Prompt重新压进 TypeScript 字符串。
- 生成故障优先查看对应课程的 `generation-input/` Prompt 快照、结果 JSON 和进度文件。
- 涉及长任务时，应提供可见进度，并避免重复提交 LLM 或音频请求。
