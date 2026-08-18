import fs from "node:fs/promises";
import path from "node:path";

const projectId=process.argv[2];
if(!projectId)throw new Error("请提供项目 ID。");
const root=path.resolve("data/projects",projectId),projectPath=path.join(root,"project.json");
const project=JSON.parse(await fs.readFile(projectPath,"utf8"));
const planPath=path.join(root,"generation-input","plan","voice-plan.json");
project.voicePlan=JSON.parse(await fs.readFile(planPath,"utf8"));
const chapters=(await fs.readdir(path.join(root,"generation-input"),{withFileTypes:true})).filter(item=>item.isDirectory()&&/^chapter-\d+$/.test(item.name)).sort((a,b)=>a.name.localeCompare(b.name));
const drafts=new Map(),prompts=new Map();
for(const chapter of chapters){
  const directory=path.join(root,"generation-input",chapter.name);
  try{for(const slide of JSON.parse(await fs.readFile(path.join(directory,"draft-result.json"),"utf8")).slides)drafts.set(slide.page,slide)}catch{}
  try{for(const slide of JSON.parse(await fs.readFile(path.join(directory,"result.json"),"utf8")).slides)prompts.set(slide.page,slide.audio_prompt)}catch{}
}
project.slides=project.slides.map((slide,index)=>{const draft=drafts.get(slide.page),audioPrompt=prompts.get(slide.page);return draft?{...slide,...draft,audioPrompt,voiceoverId:index+1}:slide});
project.status=project.slides.every(slide=>slide.narration)?"scripted":"script-partial";
await Promise.all([
  fs.writeFile(projectPath,`${JSON.stringify(project,null,2)}\n`),
  fs.writeFile(path.join(root,"voice_plan.json"),`${JSON.stringify(project.voicePlan,null,2)}\n`)
]);
console.log(JSON.stringify({projectId,status:project.status,recovered:project.slides.filter(slide=>slide.narration).length,sections:project.voicePlan.sections.length},null,2));
