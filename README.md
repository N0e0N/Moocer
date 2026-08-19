# MOOCER

MOOCER 是一个面向课程创作者的本地优先慕课制作工具。上传课件和课纲后，可完成课程参数配置、口播规划、逐页口播稿生成、AI 配音、本人录音、课件预览和视频导出。

> 当前版本是单机 MVP，适合本地制作与功能验证，暂不包含账号体系、云存储、多人协作和分布式任务队列。

## 功能

- 解析 HTML、ZIP 和 PDF 课件并生成 16:9 缩略图
- 读取 Markdown、TXT 和 DOCX 课纲
- 根据课程时长、语速、音色和讲述风格生成口播规划
- 按真实章节分批生成逐页口播稿
- 使用课件截图进行多模态内容理解
- 编辑或单页优化口播稿
- 生成逐页 AI 配音，或使用浏览器麦克风录音
- 混合使用 AI 配音和本人录音
- 录制 HTML 课件并导出 MP4 成片
- 显示生成进度，支持取消和中断后继续

## 技术栈

- Next.js 16、React 19、TypeScript
- LangChain 与 OpenAI 兼容接口
- Playwright
- FFmpeg / FFprobe
- Poppler
- 本地文件系统存储

## 环境要求

- Node.js `>= 22.13.0`
- npm
- FFmpeg 与 FFprobe
- Poppler（PDF 缩略图需要）
- Chromium（Playwright 会按需安装）
- 可用的 LLM 和语音生成服务

macOS 可通过 Homebrew 安装媒体依赖：

```bash
brew install ffmpeg poppler
```

## 本地运行

```bash
git clone <your-repository-url>
cd <repository-folder>
npm install
cp .env.example .env.local
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 环境变量

只在本地的 `.env.local` 中填写密钥。不要把真实密钥写入源码、README、Issue、日志或提交记录。

```dotenv
VOLCENGINE_API_KEY=
VOLCENGINE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
VOLCENGINE_LLM_MODEL=
VOLCENGINE_NARRATION_MODEL=
VOLCENGINE_THINKING=enabled

VOLCENGINE_AUDIO_API_KEY=
VOLCENGINE_AUDIO_BASE_URL=https://openspeech.bytedance.com/api/v3
VOLCENGINE_AUDIO_MODEL=
VOLCENGINE_AUDIO_SPEAKER=

VOICE_SCRIPT_CASES_DIR=resources/voice-script-cases
```

| 变量 | 用途 |
| --- | --- |
| `VOLCENGINE_API_KEY` | LLM 服务密钥 |
| `VOLCENGINE_BASE_URL` | OpenAI 兼容接口地址 |
| `VOLCENGINE_LLM_MODEL` | 课程规划与口播初稿模型 |
| `VOLCENGINE_NARRATION_MODEL` | 口语化改写与单页优化模型 |
| `VOLCENGINE_THINKING` | 是否启用模型思考模式 |
| `VOLCENGINE_AUDIO_API_KEY` | 语音服务密钥 |
| `VOLCENGINE_AUDIO_BASE_URL` | 语音接口地址 |
| `VOLCENGINE_AUDIO_MODEL` | 语音生成模型 |
| `VOLCENGINE_AUDIO_SPEAKER` | 默认音色 ID |
| `VOICE_SCRIPT_CASES_DIR` | 口播风格案例目录 |

`.env.local` 已被 Git 忽略；仓库只保留不含密钥的 `.env.example`。

## 使用流程

1. 上传课件与课纲。
2. 确认音色、讲述风格、课程时长和语速。
3. 手动生成并检查口播规划。
4. 生成口播稿预览，按页编辑或优化。
5. 为需要的页面生成 AI 配音，或录制本人声音。
6. 预览整课并导出视频。
7. 在“成片”阶段查看、播放和下载不同导出版本。

## 支持范围

| 能力 | 状态 |
| --- | --- |
| HTML 课件 | 支持 |
| HTML 与资源文件组成的 ZIP | 支持 |
| PDF 课件 | 支持解析、缩略图、口播和音频 |
| PPTX 课件 | 实验性，暂不保证完整缩略图和视频流程 |
| Markdown / TXT / DOCX 课纲 | 支持 |
| AI 配音与本人录音 | 支持 |
| HTML 课件 MP4 导出 | 支持 |
| PDF / PPTX 视频导出 | 暂未实现 |
| 多用户与云端任务队列 | 暂未实现 |

## 项目结构

```text
app/                         Next.js 页面与 API
lib/                         课件解析、模型调用、音视频和存储逻辑
prompts/                     课程规划与口播 Prompt 模板
resources/voice-script-cases 口播风格参考
scripts/render/              缩略图与视频渲染脚本
scripts/maintenance/         需手动执行的数据维护脚本
tests/                       单元测试
data/                        本地课程与生成产物，不进入 Git
```

## 数据与隐私

课程文件、课纲、缩略图、Prompt 快照、口播稿、音频和视频均保存在本地 `data/` 目录。整个目录已加入 `.gitignore`，不会随正常 Git 操作上传。

在公开仓库前仍建议执行：

```bash
git status --short
git ls-files data .env.local
```

第二条命令应该没有输出。若密钥曾经进入 Git 历史，仅从当前文件删除并不安全；请先吊销旧密钥，再清理 Git 历史。

## 检查与构建

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

生产运行：

```bash
npm run build
npm run start
```

## LLM 流程

1. 课程规划：结合课纲、页数和课程参数生成章节结构。
2. 章节初稿：结合章节规划、前文和真实课件截图生成逐页口播。
3. 口语化改写：在不改变教学结构的前提下优化表达。
4. 单页优化：根据用户输入的修改意图重写当前页。
5. 音频生成：把审阅后的口播稿转换为逐页音频。

实际调用使用的 Prompt 快照会保存在对应课程的 `data/projects/<项目ID>/generation-input/` 下，仅用于本地排查，不会进入 Git。

## 安全说明

- 不要把 `.env.local`、课程数据、生成媒体或 Prompt 快照提交到仓库。
- 不要在客户端代码中使用服务端 API Key。
- 公网部署前应增加身份认证、访问控制、上传限制、任务隔离和持久化存储。
- 当前本地文件存储方案不适合作为多人共享的生产数据库。

## License

发布前请根据你的开源计划补充许可证；未提供许可证时，默认不授予复制、修改或分发权利。
