import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { loadBackendEnv } from "./env";
import { renderPrompt } from "./prompt";
import { ensureProjectThumbnails } from "./thumbnails";
import { writeGenerationProgress } from "./generation-progress";
import type { MediaPage, PlaybackPlan, Project, Slide, VoicePlan, VoiceScript } from "./types";

const generatedSlide=z.object({
  page:z.number(),
  title:z.string(),
  teachingTask:z.enum(["导入","提出问题","展示案例","解释机制","比较","总结","转场"]),
  learningOutcome:z.string(),
  recordingDirection:z.string(),
  narration:z.string()
});
const schema=z.object({slides:z.array(generatedSlide)});
const revisionSchema=z.object({narration:z.string()});
const planSchema=z.object({
  courseThesis:z.string(),
  sections:z.array(z.object({title:z.string(),startPage:z.number(),endPage:z.number(),purpose:z.string(),targetMinutes:z.number()})),
  pages:z.array(z.object({page:z.number(),teachingTask:z.enum(["导入","提出问题","展示案例","解释机制","比较","总结","转场"]),learningOutcome:z.string(),visualFocus:z.string(),continuity:z.string(),targetChars:z.number().int().positive()}))
});
const round=(value:number)=>Math.round(value*10)/10;
function createModel(purpose:"planning"|"narration"|"oralization"){
  const env=loadBackendEnv();
  if(!env.VOLCENGINE_API_KEY||!env.VOLCENGINE_LLM_MODEL)throw new Error("backend.env 中缺少火山方舟模型配置。");
  const thinkingEnabled=env.VOLCENGINE_THINKING!=="disabled";
  const model=purpose==="oralization"?(env.VOLCENGINE_NARRATION_MODEL||env.VOLCENGINE_LLM_MODEL):env.VOLCENGINE_LLM_MODEL;
  return new ChatOpenAI({apiKey:env.VOLCENGINE_API_KEY,model,temperature:purpose==="oralization"?.65:.3,maxTokens:24000,timeout:360000,modelKwargs:{thinking:{type:thinkingEnabled?"enabled":"disabled"}},configuration:{baseURL:(env.VOLCENGINE_BASE_URL||"").replace(/\/$/,"")}});
}
const MODEL_MAX_ATTEMPTS=3;
const wait=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function speakingCharsPerSecond(project:Project){
  const speechRate=project.design?.voice.speechRate||0;
  return Math.max(2.4,Math.min(7.2,4.8*(1+speechRate/100)));
}
function targetNarrationChars(project:Project){return Math.round(project.targetMinutes*60*speakingCharsPerSecond(project))}
function modelErrorMessage(error:unknown){return error instanceof Error?error.message:String(error)}
async function invokeWithModelRetry<T>(label:string,directory:string,invoke:()=>Promise<T>,onRetry?:(attempt:number,maxAttempts:number,error:string)=>Promise<void>){
  let lastError:unknown;
  for(let attempt=1;attempt<=MODEL_MAX_ATTEMPTS;attempt++){
    try{return await invoke()}catch(error){
      lastError=error;
      const message=modelErrorMessage(error);
      await fs.mkdir(directory,{recursive:true});
      await fs.appendFile(path.join(directory,"model-attempts.jsonl"),`${JSON.stringify({label,attempt,maxAttempts:MODEL_MAX_ATTEMPTS,status:"failed",error:message,at:new Date().toISOString()})}\n`);
      if(attempt===MODEL_MAX_ATTEMPTS)break;
      if(onRetry)await onRetry(attempt+1,MODEL_MAX_ATTEMPTS,message);
      await wait(attempt===1?1500:4000);
    }
  }
  throw new Error(`${label}失败，已自动尝试 ${MODEL_MAX_ATTEMPTS} 次：${modelErrorMessage(lastError)}`);
}
const spokenChars=(text:string)=>(text.match(/[\u3400-\u9fffA-Za-z0-9]/g)||[]).length;
const spokenDuration=(text:string)=>round(Math.max(2.5,spokenChars(text)/4.8));
const MIN_SEGMENT_CHARS=17;
const MAX_SEGMENT_CHARS=72;
function mergeShortSegments(segments:string[]){
  const merged:string[]=[];let current="";
  for(const segment of segments){
    current+=segment;
    if(spokenChars(current)>=MIN_SEGMENT_CHARS){merged.push(current);current=""}
  }
  if(current){
    const previous=merged.at(-1);
    if(previous&&spokenChars(previous)+spokenChars(current)<=MAX_SEGMENT_CHARS)merged[merged.length-1]=previous+current;
    else merged.push(current);
  }
  return merged;
}
const splitSegments=(text:string)=>{
  if(spokenDuration(text)<=16)return [text];
  const sentences=text.match(/[^。！？；]+[。！？；]?/g)||[text];
  return sentences.flatMap(sentence=>spokenDuration(sentence)<=16?[sentence]:mergeShortSegments((sentence.match(/[^，、：]+[，、：]?/g)||[sentence]).filter(Boolean))).filter(Boolean);
};
function editRatio(before:string,after:string){
  const left=before.replace(/\s/g,""),right=after.replace(/\s/g,"");
  if(!left&&!right)return 0;
  const previous=Array.from({length:right.length+1},(_,index)=>index);
  for(let row=1;row<=left.length;row++){
    let diagonal=previous[0];previous[0]=row;
    for(let column=1;column<=right.length;column++){
      const above=previous[column],cost=left[row-1]===right[column-1]?0:1;
      previous[column]=Math.min(previous[column]+1,previous[column-1]+1,diagonal+cost);diagonal=above;
    }
  }
  return previous[right.length]/Math.max(left.length,right.length,1);
}
const pauseAfter=(segment:string,next:string)=>{
  const clean=segment.trim();
  if(/[,，、：]$/.test(clean))return .35;
  if(/[？?]$/.test(clean))return .9;
  if(/[！!]$/.test(clean))return .7;
  if(/[；;]$/.test(clean))return .45;
  if(/^(先看|请观察|想一想|注意|先不要急)/.test(clean))return .8;
  if(/^(所以|因此|接下来|现在|最后|换句话说|也就是说|这时|当)/.test(next.trim()))return .65;
  return spokenChars(clean)<=16?.65:.5;
};
function lineDuration(text:string){const segments=splitSegments(text);return round(spokenDuration(text)+segments.slice(0,-1).reduce((sum,segment,index)=>sum+pauseAfter(segment,segments[index+1]),0))}
function timestamped(text:string,start:number,end:number){
  const segments=splitSegments(text),total=Math.max(1,spokenChars(text)),pauses:number[]=segments.map((segment,index)=>index===segments.length-1?0:pauseAfter(segment,segments[index+1]));
  const available=end-start-pauses.reduce<number>((sum,pause)=>sum+pause,0);let cursor=start;
  return segments.map((segment,index)=>{const segmentEnd=index===segments.length-1?end:round(cursor+available*spokenChars(segment)/total),result=`[${cursor.toFixed(1)}s:${segmentEnd.toFixed(1)}s]【${segment.trim()}】`;cursor=round(segmentEnd+pauses[index]);return result});
}
function voiceScriptPage(slide:Pick<Slide,"page"|"title"|"teachingTask"|"recordingDirection"|"narration">,voiceoverId:number){
  const narration=slide.narration?.trim()||"",duration=lineDuration(narration),direction=(slide.recordingDirection||"语气平稳，核心判断清楚落点").replace(/^<|>$/g,"");
  return {
    page:slide.page,
    title:slide.title,
    teachingTask:slide.teachingTask||"解释机制",
    audio_prompt:[`#口播${voiceoverId}`,`描述：<${direction}>`,"台词：",...timestamped(narration,0,duration)].join("\n")
  };
}
export function refreshSlideVoicePrompt(slide:Slide,voiceoverId:number){
  const result=voiceScriptPage(slide,voiceoverId);
  return {audioPrompt:result.audio_prompt,plannedDurationSeconds:lineDuration(slide.narration||"")};
}
export async function optimizeSlideNarration(project:Project,page:number,intent:string){
  const slide=project.slides.find(item=>item.page===page);
  if(!slide?.narration)throw new Error("当前页还没有可优化的口播稿。");
  if(!intent.trim())throw new Error("请先填写修改意图。");
  const systemPrompt=await renderPrompt("course-voice-revise.system.md",{});
  const userPrompt=await renderPrompt("course-voice-revise.user.md",{PAGE:page,TITLE:slide.title,TEACHING_TASK:slide.teachingTask||"解释机制",RECORDING_DIRECTION:slide.recordingDirection||"",CURRENT_NARRATION:slide.narration,REVISION_INTENT:intent.trim()});
  const directory=path.join(path.dirname(project.outlinePath),"generation-input","revisions",`page-${String(page).padStart(2,"0")}`);await fs.mkdir(directory,{recursive:true});
  await Promise.all([fs.writeFile(path.join(directory,"system-prompt.md"),`${systemPrompt}\n`),fs.writeFile(path.join(directory,"user-prompt.md"),`${userPrompt}\n`)]);
  const revisionModel=createModel("oralization").withStructuredOutput(revisionSchema,{name:`revise_voiceover_page_${page}`});
  const result=await invokeWithModelRetry("本页口播优化",directory,()=>revisionModel.invoke([{role:"system",content:systemPrompt},{role:"user",content:userPrompt}]));
  const narration=result.narration.trim();if(!narration)throw new Error("优化结果为空，请换一种修改意图重试。");
  slide.narration=narration;const voice=refreshSlideVoicePrompt(slide,project.slides.findIndex(item=>item.page===page)+1);slide.audioPrompt=voice.audioPrompt;slide.plannedDurationSeconds=voice.plannedDurationSeconds;slide.audioOutdated=!!slide.aiAudioUrl||slide.audioSource==="ai"&&!!slide.audioUrl;
  const voicePage=project.voiceScript?.pages.find(item=>item.page===page);if(voicePage)voicePage.audio_prompt=voice.audioPrompt;
  const timeline=project.voiceScript?.timeline.find(item=>item.page===page);if(timeline)timeline.audio_prompt=voice.audioPrompt;
  await fs.writeFile(path.join(directory,"result.json"),`${JSON.stringify({page,narration},null,2)}\n`);
  return project;
}
function buildArtifacts(project:Project,slides:Slide[]):{voiceScript:VoiceScript;playbackPlan:PlaybackPlan;slides:Slide[]}{
  const persona=project.design?.voice?.role?.trim()||"35至45岁、有经验的大学讲师。普通话清晰，语速约每秒4.8个汉字，语气平静、温和、有教学现场感。不加背景音乐和音效";
  const role=`角色设定：${persona}。讲述像带着学生共同观察画面，术语与作品名清楚落点。课程受众：${project.audience}。讲述风格：${project.style}`;
  const lines=slides.map((slide,index)=>({...slide,id:index+1,duration:lineDuration(slide.narration||""),isTransition:slide.type==="transition"||slide.teachingTask==="转场"}));
  const timeline:VoiceScript["timeline"]=[],generation_batches:VoiceScript["generation_batches"]=[],voicePages:VoiceScript["pages"]=[];
  for(const line of lines){
    const end=line.duration,audioPrompt=voiceScriptPage(line,line.id).audio_prompt;
    timeline.push({type:"voice",page:line.page,audio_prompt:audioPrompt});
    voicePages.push({page:line.page,title:line.title,teachingTask:line.teachingTask||"解释机制",audio_prompt:audioPrompt});
    generation_batches.push({batch:line.id,range:`#口播${line.id}-#口播${line.id}`,batch_timeline:`0.0s-${end.toFixed(1)}s`});
    line.audioPrompt=audioPrompt;line.voiceoverId=line.id;line.plannedDurationSeconds=line.duration;
  }
  let absolute=0;const events:PlaybackPlan["events"]=[];
  lines.forEach((line,index)=>{if(index)absolute=round(absolute+(line.isTransition?1:.6));events.push({type:"page_flip",page:line.page,planned_at_seconds:absolute});absolute=round(absolute+line.duration);const hold=project.mediaManifest?.pages.find(page=>page.page===line.page)?.watch_seconds||0;if(hold){events.push({type:"visual_hold",page:line.page,seconds:hold});absolute=round(absolute+hold)}});
  return {voiceScript:{doubao_role_setting:role,pages:voicePages,generation_batches,timeline},playbackPlan:{events},slides:lines.map(line=>{const slide={...line};delete (slide as Partial<typeof line>).id;delete (slide as Partial<typeof line>).duration;delete (slide as Partial<typeof line>).isTransition;return slide})};
}

export async function writeNarrations(project:Project){
  const model=createModel("narration");
  const projectDirectory=path.dirname(project.outlinePath);
  await writeGenerationProgress(projectDirectory,{status:"running",phase:"preparing",label:"正在检查课件截图",percent:2,completedPages:0,totalPages:project.slides.length});
  await ensureProjectThumbnails(project);
  const outline=(await fs.readFile(project.outlinePath,"utf8")).slice(0,40000),targetChars=targetNarrationChars(project),pages=project.slides.map(slide=>pageInput(project,slide));
  await writeGenerationProgress(projectDirectory,{status:"running",phase:"planning",label:"正在根据课纲规划章节与口播结构",percent:6,completedPages:0,totalPages:pages.length});
  const voicePlan=project.voicePlan||await createVoicePlan(model,project,outline,pages,targetChars),generated: z.infer<typeof generatedSlide>[]=[];
  const chapterBatches=buildChapterBatches(voicePlan,pages),totalBatches=chapterBatches.length;
  await writeGenerationProgress(projectDirectory,{status:"running",phase:"planning",label:`章节规划已完成，共 ${totalBatches} 个章节`,percent:12,completedPages:0,totalPages:pages.length,totalBatches});
  for(const [batchIndex,chapter] of chapterBatches.entries()){
    const batchNumber=batchIndex+1,range=`${chapter.startPage}-${chapter.endPage}`;
    await writeGenerationProgress(projectDirectory,{status:"running",phase:"batching",label:`正在撰写：${chapter.title}`,percent:Math.round(12+(generated.length/pages.length)*80),completedPages:generated.length,totalPages:pages.length,currentBatch:batchNumber,totalBatches,range});
    const batchResult=await createNarrationBatch(model,project,voicePlan,chapter.pages,generated,targetChars,batchNumber,chapter.title,async()=>{
      await writeGenerationProgress(projectDirectory,{status:"running",phase:"oralizing",label:`正在口语化改写：${chapter.title}`,percent:Math.round(12+((generated.length+chapter.pages.length*.55)/pages.length)*80),completedPages:generated.length,totalPages:pages.length,currentBatch:batchNumber,totalBatches,range});
    });generated.push(...batchResult);await saveDraftCheckpoint(project,voicePlan,generated);
    await writeGenerationProgress(projectDirectory,{status:"running",phase:"batching",label:`已完成：${chapter.title}`,percent:Math.round(12+(generated.length/pages.length)*80),completedPages:generated.length,totalPages:pages.length,currentBatch:batchNumber,totalBatches,range});
  }
  const map=new Map(generated.map(slide=>[slide.page,slide]));
  const merged=project.slides.map(slide=>{const generated=map.get(slide.page);if(!generated)throw new Error(`模型遗漏了第 ${slide.page} 页，请重新生成。`);return {...slide,title:generated.title||slide.title,teachingTask:generated.teachingTask,learningOutcome:generated.learningOutcome,recordingDirection:generated.recordingDirection,narration:generated.narration.trim(),audioUrl:undefined,audioPath:undefined,durationSeconds:undefined}});
  if(map.size!==project.slides.length)throw new Error(`模型返回 ${map.size} 页，但课件共有 ${project.slides.length} 页，请重新生成。`);
  await writeGenerationProgress(projectDirectory,{status:"running",phase:"finalizing",label:"正在整理时间戳和口播批次",percent:96,completedPages:pages.length,totalPages:pages.length,totalBatches});
  const artifacts={...buildArtifacts(project,merged),voicePlan};
  await writeGenerationProgress(projectDirectory,{status:"complete",phase:"complete",label:"逐页口播稿生成完成",percent:100,completedPages:pages.length,totalPages:pages.length,totalBatches});
  return artifacts;
}

export async function planNarrations(project:Project){
  const projectDirectory=path.dirname(project.outlinePath),outline=(await fs.readFile(project.outlinePath,"utf8")).slice(0,40000),pages=project.slides.map(slide=>pageInput(project,slide)),targetChars=targetNarrationChars(project);
  await writeGenerationProgress(projectDirectory,{status:"running",phase:"planning",label:"正在根据课纲规划章节",percent:25,completedPages:project.slides.filter(slide=>slide.narration).length,totalPages:pages.length});
  const model=createModel("planning");
  const voicePlan=await createVoicePlan(model,project,outline,pages,targetChars);
  await writeGenerationProgress(projectDirectory,{status:"complete",phase:"complete",label:`章节规划完成，共 ${voicePlan.sections.length} 章`,percent:100,completedPages:project.slides.filter(slide=>slide.narration).length,totalPages:pages.length,totalBatches:voicePlan.sections.length});
  return voicePlan;
}

export async function writeNarrationChapter(project:Project,sectionIndex:number){
  if(!project.voicePlan)throw new Error("请先生成章节规划。");
  const sections=[...project.voicePlan.sections].sort((a,b)=>a.startPage-b.startPage),section=sections[sectionIndex];
  if(!section)throw new Error("没有找到要生成的章节。");
  const projectDirectory=path.dirname(project.outlinePath),pages=project.slides.map(slide=>pageInput(project,slide)),batchPages=pages.filter(page=>page.page>=section.startPage&&page.page<=section.endPage),targetChars=targetNarrationChars(project);
  await writeGenerationProgress(projectDirectory,{status:"running",phase:"preparing",label:`正在准备：${section.title}`,percent:5,completedPages:project.slides.filter(slide=>slide.narration).length,totalPages:project.slides.length,currentBatch:sectionIndex+1,totalBatches:sections.length,range:`${section.startPage}-${section.endPage}`});
  await ensureProjectThumbnails(project);
  await writeGenerationProgress(projectDirectory,{status:"running",phase:"batching",label:`正在撰写：${section.title}`,percent:35,completedPages:project.slides.filter(slide=>slide.narration).length,totalPages:project.slides.length,currentBatch:sectionIndex+1,totalBatches:sections.length,range:`${section.startPage}-${section.endPage}`});
  const model=createModel("narration");
  const previous=project.slides.filter(slide=>slide.narration&&slide.page<section.startPage).map(slide=>({page:slide.page,title:slide.title,teachingTask:(slide.teachingTask||"解释机制") as z.infer<typeof generatedSlide>["teachingTask"],learningOutcome:slide.learningOutcome||"",recordingDirection:slide.recordingDirection||"",narration:slide.narration||""}));
  const generated=await createNarrationBatch(model,project,project.voicePlan,batchPages,previous,targetChars,sectionIndex+1,section.title,async()=>{
    await writeGenerationProgress(projectDirectory,{status:"running",phase:"oralizing",label:`正在口语化改写：${section.title}`,percent:68,completedPages:project.slides.filter(slide=>slide.narration).length,totalPages:project.slides.length,currentBatch:sectionIndex+1,totalBatches:sections.length,range:`${section.startPage}-${section.endPage}`});
  }),generatedMap=new Map(generated.map(slide=>[slide.page,slide]));
  const merged=project.slides.map(slide=>{const item=generatedMap.get(slide.page);if(!item)return slide;const final=voiceScriptPage(item,project.slides.findIndex(current=>current.page===slide.page)+1);return {...slide,...item,narration:item.narration.trim(),audioPrompt:final.audio_prompt,voiceoverId:project.slides.findIndex(current=>current.page===slide.page)+1,plannedDurationSeconds:lineDuration(item.narration),audioUrl:undefined,audioPath:undefined,durationSeconds:undefined}});
  const completed=merged.filter(slide=>slide.narration),artifacts=buildArtifacts(project,completed),allComplete=completed.length===merged.length;
  await writeGenerationProgress(projectDirectory,{status:"complete",phase:"complete",label:`已完成：${section.title}`,percent:100,completedPages:completed.length,totalPages:merged.length,currentBatch:sectionIndex+1,totalBatches:sections.length,range:`${section.startPage}-${section.endPage}`});
  return {slides:merged,voiceScript:artifacts.voiceScript,playbackPlan:artifacts.playbackPlan,allComplete};
}

type PageInput={page:number;title:string;type:Slide["type"];assets:MediaPage["assets"];animations:MediaPage["animations"];watchSeconds:number};
function pageInput(project:Project,slide:Slide):PageInput{const media=project.mediaManifest?.pages.find(page=>page.page===slide.page);return {page:slide.page,title:slide.title,type:slide.type,assets:media?.assets||[],animations:media?.animations||[],watchSeconds:media?.watch_seconds||0}}
async function createVoicePlan(model:ChatOpenAI,project:Project,outline:string,pages:PageInput[],targetChars:number):Promise<VoicePlan>{
  const voice=project.design?.voice;
  const systemPrompt=await renderPrompt("course-voice-plan.system.md",{TARGET_MINUTES:project.targetMinutes,TARGET_CHARS:targetChars,AUDIENCE:project.audience,STYLE:project.style,PAGE_COUNT:pages.length,VOICE_ROLE:voice?.role||"系统默认大学讲师",SPEAKER_ID:voice?.speakerId||"系统默认音色",SPEECH_RATE:voice?.speechRate||0,PITCH_RATE:voice?.pitchRate||0,LOUDNESS_RATE:voice?.loudnessRate||0,SPEAKING_CHARS_PER_SECOND:speakingCharsPerSecond(project).toFixed(2)});
  const userPrompt=await renderPrompt("course-voice-plan.user.md",{OUTLINE:outline,PAGE_COUNT:pages.length});
  const directory=path.join(path.dirname(project.outlinePath),"generation-input","plan");await fs.mkdir(directory,{recursive:true});
  await Promise.all([fs.writeFile(path.join(directory,"system-prompt.md"),`${systemPrompt}\n`),fs.writeFile(path.join(directory,"user-prompt.md"),`${userPrompt}\n`)]);
  const planner=model.withStructuredOutput(planSchema,{name:"course_voiceover_plan"});
  const plan=await invokeWithModelRetry("口播规划模型调用",directory,async()=>{
    const candidate=await planner.invoke([{role:"system",content:systemPrompt},{role:"user",content:userPrompt}]);
    const plannedPages=new Set(candidate.pages.map(page=>page.page));if(candidate.pages.length!==pages.length||pages.some(page=>!plannedPages.has(page.page)))throw new Error(`口播规划页数不完整：应为 ${pages.length} 页，实际为 ${candidate.pages.length} 页。`);
    validateSections(candidate,pages.length);return candidate;
  },async(attempt,maxAttempts)=>writeGenerationProgress(path.dirname(project.outlinePath),{status:"running",phase:"planning",label:`规划模型响应异常，正在自动重试 ${attempt}/${maxAttempts}`,percent:25,completedPages:project.slides.filter(slide=>slide.narration).length,totalPages:pages.length}));
  await fs.writeFile(path.join(directory,"voice-plan.json"),`${JSON.stringify(plan,null,2)}\n`);return plan;
}
async function createNarrationBatch(model:ChatOpenAI,project:Project,voicePlan:VoicePlan,batchPages:PageInput[],previous:z.infer<typeof generatedSlide>[],targetChars:number,batchNumber:number,chapterTitle:string,onDraftReady?:()=>Promise<void>){
  const pageNumbers=batchPages.map(page=>page.page),range=`${pageNumbers[0]}-${pageNumbers.at(-1)}`,planPages=voicePlan.pages.filter(page=>pageNumbers.includes(page.page));
  const systemPrompt=await renderPrompt("course-voice-script.system.md",{TARGET_MINUTES:project.targetMinutes,TARGET_CHARS:targetChars,AUDIENCE:project.audience,STYLE:project.style,PAGE_SCOPE_RULE:`当前是分批生成。本次只返回第 ${range} 页，共 ${batchPages.length} 页；不得返回批次外页面。`,PAGE_COMPLETENESS_RULE:`只检查本批第 ${range} 页：页码必须与本批输入完全一致，无遗漏、无重复。`});
  const previousNarrations=previous.length?previous.map(slide=>`## 第 ${slide.page} 页｜${slide.title}\n${slide.narration}`).join("\n\n"):"这是第一批，前面没有已生成口播。";
  const userPrompt=await renderPrompt("course-voice-batch.user.md",{VOICE_PLAN_JSON:JSON.stringify(voicePlan,null,2),PREVIOUS_NARRATIONS:previousNarrations,CHAPTER_TITLE:chapterTitle,BATCH_RANGE:range,BATCH_PAGES_JSON:JSON.stringify(batchPages.map(page=>({...page,plan:planPages.find(item=>item.page===page.page)})),null,2),BATCH_COUNT:batchPages.length,BATCH_PAGE_NUMBERS:pageNumbers.join("、")});
  const content:Array<{type:"text";text:string}|{type:"image_url";image_url:{url:string;detail:"high"}}>= [{type:"text",text:userPrompt}];
  for(const page of batchPages){const thumbnail=path.join(path.dirname(project.outlinePath),"thumbnails",`slide-${String(page.page).padStart(2,"0")}.jpg`),image=await fs.readFile(thumbnail);content.push({type:"text",text:`\n以下图片是第 ${page.page} 页真实课件截图：`},{type:"image_url",image_url:{url:`data:image/jpeg;base64,${image.toString("base64")}`,detail:"high"}})}
  const directory=path.join(path.dirname(project.outlinePath),"generation-input",`chapter-${String(batchNumber).padStart(2,"0")}`);await fs.mkdir(directory,{recursive:true});
  await Promise.all([fs.writeFile(path.join(directory,"system-prompt.md"),`${systemPrompt}\n`),fs.writeFile(path.join(directory,"user-prompt.md"),`${userPrompt}\n`),fs.writeFile(path.join(directory,"screenshots.json"),`${JSON.stringify(batchPages.map(page=>({page:page.page,file:`../../thumbnails/slide-${String(page.page).padStart(2,"0")}.jpg`})),null,2)}\n`)]);
  const drafter=model.withStructuredOutput(schema,{name:`course_voiceover_batch_${range}`});
  const result=await invokeWithModelRetry(`第 ${range} 页口播初稿模型调用`,directory,async()=>{
    const candidate=await drafter.invoke([{role:"system",content:systemPrompt},new HumanMessage({content})]);
    const returned=new Set(candidate.slides.map(slide=>slide.page));if(candidate.slides.length!==batchPages.length||pageNumbers.some(page=>!returned.has(page))||candidate.slides.some(slide=>!pageNumbers.includes(slide.page)))throw new Error(`第 ${range} 页批次返回不完整或包含越界页码。`);
    return candidate;
  },async(attempt,maxAttempts)=>writeGenerationProgress(path.dirname(project.outlinePath),{status:"running",phase:"batching",label:`第 ${range} 页模型响应异常，正在自动重试 ${attempt}/${maxAttempts}`,percent:35,completedPages:project.slides.filter(slide=>slide.narration).length,totalPages:project.slides.length,currentBatch:batchNumber,totalBatches:voicePlan.sections.length,range}));
  const orderedDrafts=result.slides.sort((a,b)=>a.page-b.page);
  await fs.writeFile(path.join(directory,"draft-result.json"),`${JSON.stringify({slides:orderedDrafts},null,2)}\n`);
  if(onDraftReady)await onDraftReady();
  const styleReference=await loadCourseStyleReference(project);
  const oralizeSystemPrompt=await renderPrompt("course-voice-oralize.system.md",{AUDIENCE:project.audience,STYLE:project.style,BATCH_RANGE:range,BATCH_COUNT:batchPages.length});
  const oralizeUserPrompt=await renderPrompt("course-voice-oralize.user.md",{CHAPTER_TITLE:chapterTitle,BATCH_RANGE:range,STYLE_REFERENCE_FILE:styleReference.fileName,STYLE_REFERENCE:styleReference.content,DRAFT_JSON:JSON.stringify({slides:orderedDrafts},null,2),BATCH_PAGE_NUMBERS:pageNumbers.join("、")});
  await Promise.all([
    fs.writeFile(path.join(directory,"oralize-system-prompt.md"),`${oralizeSystemPrompt}\n`),
    fs.writeFile(path.join(directory,"oralize-user-prompt.md"),`${oralizeUserPrompt}\n`)
  ]);
  const oralizationModel=createModel("oralization");
  const oralizer=oralizationModel.withStructuredOutput(schema,{name:`course_voiceover_oralized_${range}`});
  const invokeOralizer=(prompt:string)=>invokeWithModelRetry(`第 ${range} 页口语化模型调用`,directory,async()=>{
    const candidate=await oralizer.invoke([{role:"system",content:oralizeSystemPrompt},{role:"user",content:prompt}]);
    const returned=new Set(candidate.slides.map(slide=>slide.page));if(candidate.slides.length!==orderedDrafts.length||pageNumbers.some(page=>!returned.has(page))||candidate.slides.some(slide=>!pageNumbers.includes(slide.page)))throw new Error(`第 ${range} 页口语化改写返回不完整或包含越界页码。`);
    return candidate;
  },async(attempt,maxAttempts)=>writeGenerationProgress(path.dirname(project.outlinePath),{status:"running",phase:"oralizing",label:`第 ${range} 页口语化响应异常，正在自动重试 ${attempt}/${maxAttempts}`,percent:68,completedPages:project.slides.filter(slide=>slide.narration).length,totalPages:project.slides.length,currentBatch:batchNumber,totalBatches:voicePlan.sections.length,range}));
  let oralizedResult=await invokeOralizer(oralizeUserPrompt);
  const draftMap=new Map(orderedDrafts.map(slide=>[slide.page,slide]));
  const changedEnough=(slides:z.infer<typeof generatedSlide>[])=>{
    const substantive=slides.filter(slide=>spokenChars(draftMap.get(slide.page)?.narration||"")>=40);
    return !substantive.length||substantive.filter(slide=>editRatio(draftMap.get(slide.page)?.narration||"",slide.narration)>=.08).length>=Math.ceil(substantive.length*.7);
  };
  if(!changedEnough(oralizedResult.slides)){
    const retryPrompt=`${oralizeUserPrompt}\n\n# 强化改写要求\n\n上一版与初稿过于相似，不能通过口语化检查。请重新改写：每个非转场内容页至少完成两类可观察转换，包括重组书面句序、补足自然承接、把抽象名词改成直接动词、把静态说明改成共同观察、为术语加入不新增事实的白话解释、合并清单式短句。不能只删除虚词或替换一两个词，也不能原样返回；保持事实与页面字段不变。`;
    await fs.writeFile(path.join(directory,"oralize-user-prompt-retry.md"),`${retryPrompt}\n`);
    oralizedResult=await invokeOralizer(retryPrompt);
    if(!changedEnough(oralizedResult.slides))await fs.writeFile(path.join(directory,"oralize-low-change-result.json"),`${JSON.stringify({warning:"口语化改写幅度低于建议值，已保留结构完整的改写结果。",slides:oralizedResult.slides},null,2)}\n`);
  }
  const oralizedMap=new Map(oralizedResult.slides.map(slide=>[slide.page,slide]));
  const oralizedDrafts=orderedDrafts.map(draft=>{
    const oralized=oralizedMap.get(draft.page);
    if(!oralized?.narration.trim())throw new Error(`第 ${draft.page} 页口语化改写结果为空。`);
    return {...draft,narration:oralized.narration.trim()};
  });
  const pageOrder=new Map(project.slides.map((slide,index)=>[slide.page,index+1]));
  const finalResult={slides:oralizedDrafts.map(slide=>voiceScriptPage(slide,pageOrder.get(slide.page)??slide.page))};
  await Promise.all([
    fs.writeFile(path.join(directory,"oralized-result.json"),`${JSON.stringify({slides:oralizedDrafts},null,2)}\n`),
    fs.writeFile(path.join(directory,"result.json"),`${JSON.stringify(finalResult,null,2)}\n`)
  ]);
  return oralizedDrafts;
}

async function loadCourseStyleReference(project:Project){
  const projectDirectory=path.dirname(project.outlinePath),recordPath=path.join(projectDirectory,"generation-input","style-reference.json");
  const configured=loadBackendEnv().VOICE_SCRIPT_CASES_DIR,casesDirectory=configured?path.resolve(configured):path.resolve(process.cwd(),"resources/voice-script-cases");
  try{
    const saved=JSON.parse(await fs.readFile(recordPath,"utf8")) as {fileName:string};
    return {fileName:saved.fileName,content:await fs.readFile(path.join(casesDirectory,saved.fileName),"utf8")};
  }catch{ /* 首次生成时尚未选择参考案例。 */ }
  const files=(await fs.readdir(casesDirectory,{withFileTypes:true})).filter(item=>item.isFile()&&item.name.toLowerCase().endsWith(".txt")).map(item=>item.name).sort();
  if(!files.length)throw new Error(`口播稿案例目录中没有 TXT 文件：${casesDirectory}`);
  const fileName=files[crypto.randomInt(files.length)],sourcePath=path.join(casesDirectory,fileName),content=await fs.readFile(sourcePath,"utf8");
  await fs.mkdir(path.dirname(recordPath),{recursive:true});
  await fs.writeFile(recordPath,`${JSON.stringify({fileName,selectedAt:new Date().toISOString()},null,2)}\n`);
  return {fileName,content};
}

function validateSections(plan:VoicePlan,totalPages:number){
  if(!plan.sections.length)throw new Error("口播规划没有生成章节。");
  const sorted=[...plan.sections].sort((a,b)=>a.startPage-b.startPage);
  let expected=1;
  for(const section of sorted){if(section.startPage!==expected||section.endPage<section.startPage||section.endPage>totalPages)throw new Error(`章节规划不连续：${section.title} 的页码范围为 ${section.startPage}-${section.endPage}。`);expected=section.endPage+1}
  if(expected!==totalPages+1)throw new Error(`章节规划没有覆盖全部 ${totalPages} 页。`);
}
function buildChapterBatches(plan:VoicePlan,pages:PageInput[]){
  return [...plan.sections].sort((a,b)=>a.startPage-b.startPage).map(section=>({...section,pages:pages.filter(page=>page.page>=section.startPage&&page.page<=section.endPage)}));
}

async function saveDraftCheckpoint(project:Project,voicePlan:VoicePlan,slides:z.infer<typeof generatedSlide>[]){
  const directory=path.join(path.dirname(project.outlinePath),"generation-input");
  await fs.writeFile(path.join(directory,"draft-checkpoint.json"),`${JSON.stringify({voicePlan,completedPages:slides.map(slide=>slide.page),slides},null,2)}\n`);
}

export async function prepareVoicePrompts(project:Project,outline?:string,pages?:Array<{page:number;title:string;text:string;type:Slide["type"];assets:unknown[]}>,targetChars?:number){
  const actualOutline=outline??(await fs.readFile(project.outlinePath,"utf8")).slice(0,40000);
  const actualPages=pages??project.slides.map(slide=>({page:slide.page,title:slide.title,text:slide.text.slice(0,2200),type:slide.type,assets:project.mediaManifest?.pages.find(page=>page.page===slide.page)?.assets||[]}));
  const actualTargetChars=targetChars??targetNarrationChars(project);
  const systemPrompt=await renderPrompt("course-voice-script.system.md",{TARGET_MINUTES:project.targetMinutes,TARGET_CHARS:actualTargetChars,AUDIENCE:project.audience,STYLE:project.style,PAGE_SCOPE_RULE:"必须完整返回课件中的每一页，页码不得缺失、重复或重新排序。",PAGE_COMPLETENESS_RULE:"返回页数与输入页面总数完全一致，页码连续对应，无遗漏、无重复。"});
  const userPrompt=await renderPrompt("course-voice-script.user.md",{OUTLINE:actualOutline,PAGES_JSON:JSON.stringify(actualPages,null,2),PAGE_COUNT:actualPages.length});
  const promptSnapshotDir=path.join(path.dirname(project.outlinePath),"generation-input");
  await fs.mkdir(promptSnapshotDir,{recursive:true});
  await Promise.all([fs.writeFile(path.join(promptSnapshotDir,"system-prompt.md"),`${systemPrompt}\n`,"utf8"),fs.writeFile(path.join(promptSnapshotDir,"user-prompt.md"),`${userPrompt}\n`,"utf8")]);
  return {systemPrompt,userPrompt};
}
