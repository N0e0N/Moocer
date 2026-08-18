# Scripts

- `render/`：应用正式运行时调用的渲染与录制脚本。
- `maintenance/`：导入旧产物、恢复中断结果等人工维护工具；应用不会自动调用。

维护脚本必须显式传入项目 ID，避免误改其他课程数据。

- `maintenance/normalize-project-audio.ts <项目ID...>`：对已有 AI 配音和本人录音执行统一响度；旧录音会先保留原文件。
