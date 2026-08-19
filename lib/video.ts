import fs from "node:fs/promises";
import path from "node:path";
import { probe,run } from "./media";
import { writeVideoProgress } from "./video-progress";
import type { Project,Slide } from "./types";

const RENDER_VERSION=2;
const round=(value:number)=>Math.round(value*10)/10;
const escapeConcatPath=(value:string)=>value.replace(/'/g,"'\\''");

type RenderPage={
  page:number;
  slideIndex:number;
  audioPath:string;
  audioSource:"ai"|"recording";
  audioDuration:number;
  visualHold:number;
  transitionGap:number;
  duration:number;
  signature:string;
  visualPath:string;
  segmentPath:string;
};
type RenderManifest={
  version:number;
  updatedAt:string;
  pages:Array<{
    page:number;
    signature:string;
    audioSource:"ai"|"recording";
    audioDuration:number;
    visualHold:number;
    transitionGap:number;
    duration:number;
    segmentFile:string;
    status:"ready";
  }>;
};
export type RenderVideoOptions={startPage?:number;endPage?:number};
export type RenderVideoResult={output:string;startPage:number;endPage:number;fullCourse:boolean;durationSeconds:number};

async function fileReady(file:string){try{return (await fs.stat(file)).size>1024}catch{return false}}
async function loadManifest(file:string):Promise<RenderManifest>{
  try{const value=JSON.parse(await fs.readFile(file,"utf8")) as RenderManifest;return value.version===RENDER_VERSION?value:{version:RENDER_VERSION,updatedAt:new Date().toISOString(),pages:[]}}
  catch{return {version:RENDER_VERSION,updatedAt:new Date().toISOString(),pages:[]}}
}
async function saveManifest(file:string,manifest:RenderManifest){manifest.updatedAt=new Date().toISOString();await fs.writeFile(file,`${JSON.stringify(manifest,null,2)}\n`,"utf8")}
function holdFor(project:Project,page:number){return project.playbackPlan?.events.find(event=>event.type==="visual_hold"&&event.page===page)?.seconds||0}
function transitionGap(slides:Slide[],index:number){if(index>=slides.length-1)return 0;const next=slides[index+1];return next.type==="transition"||next.teachingTask==="转场"?1:.6}

async function pagePlan(project:Project,videoDirectory:string,startPage:number,endPage:number){
  const deck=await fs.stat(project.sourcePath),pages:RenderPage[]=[];
  const selected=project.slides.map((slide,index)=>({slide,index})).filter(({slide})=>slide.page>=startPage&&slide.page<=endPage);
  if(!selected.length)throw new Error("所选范围内没有可导出的课件页面。");
  for(const [selectedIndex,{slide,index}] of selected.entries()){
    if(!slide.audioPath)throw new Error(`第 ${slide.page} 页还没有可用音频。`);
    const audio=await fs.stat(slide.audioPath),audioDuration=round(slide.durationSeconds||await probe(slide.audioPath));
    const visualHold=round(holdFor(project,slide.page)),gap=selectedIndex===selected.length-1?0:transitionGap(project.slides,index),duration=round(Math.max(1,audioDuration+visualHold+gap));
    const name=String(slide.page).padStart(2,"0"),signature=[RENDER_VERSION,deck.size,Math.round(deck.mtimeMs),audio.size,Math.round(audio.mtimeMs),index,duration].join(":");
    pages.push({page:slide.page,slideIndex:index,audioPath:slide.audioPath,audioSource:slide.audioSource==="recording"?"recording":"ai",audioDuration,visualHold,transitionGap:gap,duration,signature,visualPath:path.join(videoDirectory,"raw",`page-${name}.webm`),segmentPath:path.join(videoDirectory,"pages",`page-${name}.mp4`)});
  }
  return pages;
}

export async function renderVideo(project:Project,projectDirectory:string,options:RenderVideoOptions={}):Promise<RenderVideoResult>{
  if(project.sourceType!=="html"&&project.sourceType!=="htm")throw new Error("当前视频导出只支持 HTML 课件。");
  const firstPage=project.slides[0]?.page||1,lastPage=project.slides.at(-1)?.page||firstPage,startPage=Math.max(firstPage,Math.min(lastPage,Math.floor(options.startPage??firstPage))),endPage=Math.max(firstPage,Math.min(lastPage,Math.floor(options.endPage??lastPage)));
  if(startPage>endPage)throw new Error("导出起始页不能大于结束页。");
  const videoDirectory=path.join(projectDirectory,"video"),pagesDirectory=path.join(videoDirectory,"pages"),rawDirectory=path.join(videoDirectory,"raw");
  await Promise.all([fs.mkdir(pagesDirectory,{recursive:true}),fs.mkdir(rawDirectory,{recursive:true})]);
  const manifestPath=path.join(videoDirectory,"render-manifest.json"),progressPath=path.join(projectDirectory,"video-progress.json"),manifest=await loadManifest(manifestPath),pages=await pagePlan(project,videoDirectory,startPage,endPage);
  const stale:RenderPage[]=[];
  for(const page of pages){const cached=manifest.pages.find(item=>item.page===page.page);if(!cached||cached.signature!==page.signature||!await fileReady(page.segmentPath))stale.push(page)}
  const cachedCount=pages.length-stale.length;
  await writeVideoProgress(projectDirectory,{status:"running",phase:"video",label:stale.length?`准备逐页导出，${cachedCount} 页可复用`:`所有分页视频均可复用`,percent:3,completedPages:cachedCount,totalPages:pages.length});

  if(stale.length){
    const renderer=path.resolve(process.cwd(),"scripts/render/render-html-deck.cjs"),planFile=path.join(videoDirectory,"render-plan.json");
    await fs.writeFile(planFile,`${JSON.stringify({html_path:project.sourcePath,progress_path:progressPath,total_pages:pages.length,cached_pages:cachedCount,pages:stale.map(page=>({page:page.page,slide_index:page.slideIndex,duration_seconds:page.duration,visual_path:page.visualPath}))},null,2)}\n`);
    await run("node",[renderer,planFile],process.cwd());
  }

  let completed=cachedCount;
  for(const page of stale){
    await writeVideoProgress(projectDirectory,{status:"running",phase:"video",label:`正在合成第 ${page.page} 页音画`,percent:Math.round(55+(completed/pages.length)*35),completedPages:completed,totalPages:pages.length,currentPage:page.page});
    await run("ffmpeg",["-y","-sseof",`-${page.duration.toFixed(1)}`,"-i",page.visualPath,"-i",page.audioPath,"-map","0:v:0","-map","1:a:0","-af",`apad=whole_dur=${page.duration.toFixed(1)}`,"-t",page.duration.toFixed(1),"-r","30","-c:v","libx264","-preset","medium","-crf","20","-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-ar","48000","-movflags","+faststart",page.segmentPath]);
    const entry={page:page.page,signature:page.signature,audioSource:page.audioSource,audioDuration:page.audioDuration,visualHold:page.visualHold,transitionGap:page.transitionGap,duration:page.duration,segmentFile:path.relative(projectDirectory,page.segmentPath),status:"ready" as const};
    manifest.pages=manifest.pages.filter(item=>item.page!==page.page);manifest.pages.push(entry);manifest.pages.sort((a,b)=>a.page-b.page);await saveManifest(manifestPath,manifest);completed++;
  }

  await writeVideoProgress(projectDirectory,{status:"running",phase:"finalizing",label:`正在合并第 ${startPage}–${endPage} 页视频`,percent:94,completedPages:pages.length,totalPages:pages.length,range:`${startPage}–${endPage}`});
  const fullCourse=startPage===firstPage&&endPage===lastPage,rangeName=`${String(startPage).padStart(2,"0")}-${String(endPage).padStart(2,"0")}`,concatFile=path.join(videoDirectory,`concat-${rangeName}.txt`);await fs.writeFile(concatFile,pages.map(page=>`file '${escapeConcatPath(page.segmentPath)}'`).join("\n"),"utf8");
  const output=path.join(projectDirectory,fullCourse?"course.mp4":`course-pages-${rangeName}.mp4`);await run("ffmpeg",["-y","-f","concat","-safe","0","-i",concatFile,"-c","copy","-movflags","+faststart",output]);
  await writeVideoProgress(projectDirectory,{status:"complete",phase:"complete",label:`第 ${startPage}–${endPage} 页 MP4 已导出`,percent:100,completedPages:pages.length,totalPages:pages.length,range:`${startPage}–${endPage}`});
  return {output,startPage,endPage,fullCourse,durationSeconds:round(pages.reduce((total,page)=>total+page.duration,0))};
}
