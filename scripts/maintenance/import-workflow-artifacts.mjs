import fs from "node:fs/promises";
import path from "node:path";

const [projectId,artifactDirectory]=process.argv.slice(2);
if(!projectId||!artifactDirectory)throw new Error("用法：node scripts/maintenance/import-workflow-artifacts.mjs <project-id> <录课生成文件目录>");
const projectDirectory=path.resolve("data/projects",projectId),projectPath=path.join(projectDirectory,"project.json"),source=path.resolve(artifactDirectory);
const [project,voiceScript,playbackPlan,mediaManifest]=await Promise.all([
  fs.readFile(projectPath,"utf8").then(JSON.parse),
  fs.readFile(path.join(source,"voice_script.json"),"utf8").then(JSON.parse),
  fs.readFile(path.join(source,"playback_plan.json"),"utf8").then(JSON.parse),
  fs.readFile(path.join(source,"media_manifest.json"),"utf8").then(JSON.parse)
]);
const promptByPage=new Map(voiceScript.timeline.filter(item=>item.type==="voice").map(item=>[item.page,item.audio_prompt]));
const pageByNumber=new Map(mediaManifest.pages.map(page=>[page.page,page]));
const narrationFrom=prompt=>[...prompt.matchAll(/\[\d+(?:\.\d+)?s\s*:\s*\d+(?:\.\d+)?s\]【([\s\S]*?)】/g)].map(match=>match[1]).join("");
project.slides=project.slides.map(slide=>{
  const audioPrompt=promptByPage.get(slide.page),manifestPage=pageByNumber.get(slide.page),id=Number((audioPrompt?.match(/#口播(\d+)/)||[])[1]||slide.page),direction=(audioPrompt?.match(/描述：<([^>]*)>/)||[])[1];
  return {...slide,title:manifestPage?.title||slide.title,type:manifestPage?.type||slide.type,narration:audioPrompt?narrationFrom(audioPrompt):slide.narration,audioPrompt,voiceoverId:id,recordingDirection:direction,plannedDurationSeconds:audioPrompt?Number((audioPrompt.matchAll(/\[(\d+(?:\.\d+)?)s\s*:\s*(\d+(?:\.\d+)?)s\]/g).toArray().at(-1)?.[2]||0)):slide.plannedDurationSeconds};
});
project.mediaManifest={...mediaManifest,source:project.sourcePath};project.voiceScript=voiceScript;project.playbackPlan=playbackPlan;project.status="scripted";
await Promise.all([
  fs.writeFile(projectPath,`${JSON.stringify(project,null,2)}\n`),
  fs.writeFile(path.join(projectDirectory,"media_manifest.json"),`${JSON.stringify(project.mediaManifest,null,2)}\n`),
  fs.writeFile(path.join(projectDirectory,"voice_script.json"),`${JSON.stringify(voiceScript,null,2)}\n`),
  fs.writeFile(path.join(projectDirectory,"playback_plan.json"),`${JSON.stringify(playbackPlan,null,2)}\n`)
]);
console.log(JSON.stringify({projectId,pages:project.slides.length,prompts:promptByPage.size,batches:voiceScript.generation_batches.length,audioGenerated:false},null,2));
