import fs from "node:fs/promises";
import path from "node:path";
import type { Project } from "./types";
import { probe } from "./media";

const root=path.resolve(process.cwd(),"data/projects");
export async function projectDir(id:string){ const dir=path.join(root,id); await fs.mkdir(dir,{recursive:true}); return dir; }
const toStoredPath=(value:string|undefined)=>value&&path.isAbsolute(value)?path.relative(process.cwd(),value):value;
const toRuntimePath=(value:string|undefined)=>value&&!path.isAbsolute(value)?path.resolve(process.cwd(),value):value;
function storedProject(project:Project):Project{
  return {
    ...project,
    sourcePath:toStoredPath(project.sourcePath)!,
    outlinePath:toStoredPath(project.outlinePath)!,
    videoPath:toStoredPath(project.videoPath),
    slides:project.slides.map(slide=>({...slide,audioPath:toStoredPath(slide.audioPath),aiAudioPath:toStoredPath(slide.aiAudioPath),recordingAudioPath:toStoredPath(slide.recordingAudioPath),recordingOriginalPath:toStoredPath(slide.recordingOriginalPath)})),
    mediaManifest:project.mediaManifest?{...project.mediaManifest,source:toStoredPath(project.mediaManifest.source)!}:undefined
  };
}
function runtimeProject(project:Project):Project{
  project.sourcePath=toRuntimePath(project.sourcePath)!;
  project.outlinePath=toRuntimePath(project.outlinePath)!;
  project.videoPath=toRuntimePath(project.videoPath);
  for(const slide of project.slides){slide.audioPath=toRuntimePath(slide.audioPath);slide.aiAudioPath=toRuntimePath(slide.aiAudioPath);slide.recordingAudioPath=toRuntimePath(slide.recordingAudioPath);slide.recordingOriginalPath=toRuntimePath(slide.recordingOriginalPath)}
  if(project.mediaManifest)project.mediaManifest.source=toRuntimePath(project.mediaManifest.source)!;
  return project;
}
export async function saveProject(project:Project){ const dir=await projectDir(project.id); await fs.writeFile(path.join(dir,"project.json"),JSON.stringify(storedProject(project),null,2),"utf8"); return project; }
export async function saveWorkflowArtifacts(project:Project){
  const dir=await projectDir(project.id);
  const portable=storedProject(project);
  if(portable.mediaManifest)await fs.writeFile(path.join(dir,"media_manifest.json"),`${JSON.stringify(portable.mediaManifest,null,2)}\n`,"utf8");
  if(project.voicePlan)await fs.writeFile(path.join(dir,"voice_plan.json"),`${JSON.stringify(project.voicePlan,null,2)}\n`,"utf8");
  if(project.voiceScript)await fs.writeFile(path.join(dir,"voice_script.json"),`${JSON.stringify(project.voiceScript,null,2)}\n`,"utf8");
  if(project.playbackPlan)await fs.writeFile(path.join(dir,"playback_plan.json"),`${JSON.stringify(project.playbackPlan,null,2)}\n`,"utf8");
}
function rebaseProjectPath(value:string|undefined,id:string){
  if(!value||!path.isAbsolute(value))return value;
  const normalized=value.replaceAll("\\","/");
  const marker=`/data/projects/${id}/`;
  const markerIndex=normalized.indexOf(marker);
  if(markerIndex<0)return value;
  return path.join(root,id,...normalized.slice(markerIndex+marker.length).split("/").filter(Boolean));
}

async function migrateProjectPaths(project:Project){
  let changed=false;
  const update=(value:string|undefined)=>{
    const next=rebaseProjectPath(value,project.id);
    if(next!==value)changed=true;
    return next;
  };
  project.sourcePath=update(project.sourcePath)!;
  project.outlinePath=update(project.outlinePath)!;
  project.videoPath=update(project.videoPath);
  for(const slide of project.slides){
    slide.audioPath=update(slide.audioPath);
    slide.aiAudioPath=update(slide.aiAudioPath);
    slide.recordingAudioPath=update(slide.recordingAudioPath);
    slide.recordingOriginalPath=update(slide.recordingOriginalPath);
    if(slide.audioUrl&&slide.audioPath){
      if(slide.audioSource==="recording"&&!slide.recordingAudioUrl){slide.recordingAudioUrl=slide.audioUrl;slide.recordingAudioPath=slide.audioPath;slide.recordingDurationSeconds=slide.durationSeconds;changed=true}
      if(slide.audioSource!=="recording"&&!slide.aiAudioUrl){slide.aiAudioUrl=slide.audioUrl;slide.aiAudioPath=slide.audioPath;slide.aiDurationSeconds=slide.durationSeconds;changed=true}
    }
    const pageName=String(slide.page).padStart(2,"0"),projectRoot=path.join(root,project.id),aiPath=path.join(projectRoot,"audio",`page-${pageName}.mp3`);
    if(!slide.aiAudioUrl){try{await fs.access(aiPath);slide.aiAudioPath=aiPath;slide.aiAudioUrl=`/api/files/${project.id}/audio/page-${pageName}.mp3`;changed=true}catch{ /* No legacy AI file for this page. */ }}
    if(!slide.recordingAudioUrl){
      try{const files=await fs.readdir(path.join(projectRoot,"audio"));const recording=files.find(file=>file.startsWith(`page-${pageName}-recording.`));if(recording){slide.recordingAudioPath=path.join(projectRoot,"audio",recording);slide.recordingAudioUrl=`/api/files/${project.id}/audio/${recording}`;changed=true}}catch{ /* The project may not have an audio directory yet. */ }
    }
    if(slide.aiAudioPath&&!slide.aiDurationSeconds){try{slide.aiDurationSeconds=await probe(slide.aiAudioPath);changed=true}catch{ /* Invalid legacy audio is ignored. */ }}
    if(slide.recordingAudioPath&&!slide.recordingDurationSeconds){try{slide.recordingDurationSeconds=await probe(slide.recordingAudioPath);changed=true}catch{ /* Invalid legacy recording is ignored. */ }}
  }
  if(project.mediaManifest)project.mediaManifest.source=update(project.mediaManifest.source)!;
  return changed;
}

export async function getProject(id:string){
  const stored=JSON.parse(await fs.readFile(path.join(root,id,"project.json"),"utf8")) as Project;
  const hadAbsolutePaths=[stored.sourcePath,stored.outlinePath,stored.videoPath,stored.mediaManifest?.source,...stored.slides.flatMap(slide=>[slide.audioPath,slide.aiAudioPath,slide.recordingAudioPath,slide.recordingOriginalPath])].some(value=>value&&path.isAbsolute(value));
  const project=runtimeProject(stored);
  if(await migrateProjectPaths(project)||hadAbsolutePaths)await saveProject(project);
  return project;
}
export async function listProjects(){
  await fs.mkdir(root,{recursive:true}); const entries=await fs.readdir(root,{withFileTypes:true}); const projects:Project[]=[];
  for(const entry of entries){if(!entry.isDirectory())continue;try{projects.push(await getProject(entry.name))}catch{continue}}
  return projects.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export function publicProject(project:Project){ return {...project,sourceFile:project.sourceFile||path.basename(project.sourcePath),sourcePath:undefined,outlinePath:undefined,videoPath:undefined,slides:project.slides.map(s=>({...s,audioPath:undefined,aiAudioPath:undefined,recordingAudioPath:undefined,recordingOriginalPath:undefined}))}; }
