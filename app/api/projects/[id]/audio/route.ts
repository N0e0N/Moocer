import path from "node:path";
import { NextResponse } from "next/server";
import { synthesize } from "@/lib/media";
import { writeAudioProgress } from "@/lib/audio-progress";
import { getProject,projectDir,publicProject,saveProject } from "@/lib/store";
import { refreshSlideVoicePrompt } from "@/lib/agent";

export const runtime="nodejs";
export const maxDuration=1800;

type AudioRequest={mode?:"page"|"chapter"|"all";page?:number;sectionIndex?:number;force?:boolean;text?:string};

function spokenText(value:string){
  const segments=[...value.matchAll(/【([^】]+)】/g)].map(match=>match[1].trim()).filter(Boolean);
  return (segments.length?segments.join(""):value).replace(/^#口播\d+\s*/m,"").replace(/^描述：<[^>]*>\s*/m,"").replace(/^台词：\s*/m,"").replace(/^\[[\d.]+s:[\d.]+s\]\s*/gm,"").trim();
}

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  let directory="",totalPages=0;
  try{
    const {id}=await params,project=await getProject(id),body=await request.json().catch(()=>({})) as AudioRequest;
    directory=await projectDir(id);
    const narrated=project.slides.filter(slide=>slide.narration?.trim());
    if(!narrated.length)throw new Error("请先生成并审阅口播稿。");
    let targets=body.mode==="page"?narrated.filter(slide=>slide.page===Number(body.page)):narrated;
    if(body.mode==="page"&&body.text?.trim()){
      const slide=targets[0],updated=spokenText(body.text);
      if(!slide||!updated)throw new Error("修改后的台词为空，无法更新音频。");
      slide.narration=updated;
      const voice=refreshSlideVoicePrompt(slide,project.slides.findIndex(item=>item.page===slide.page)+1);
      slide.audioPrompt=voice.audioPrompt;slide.plannedDurationSeconds=voice.plannedDurationSeconds;
      const voicePage=project.voiceScript?.pages.find(item=>item.page===slide.page);if(voicePage)voicePage.audio_prompt=voice.audioPrompt;
      const timeline=project.voiceScript?.timeline.find(item=>item.page===slide.page);if(timeline)timeline.audio_prompt=voice.audioPrompt;
    }
    if(body.mode==="chapter"){
      const section=project.voicePlan?.sections[Number(body.sectionIndex)];
      if(!section)throw new Error("没有找到要配音的章节。");
      targets=narrated.filter(slide=>slide.page>=section.startPage&&slide.page<=section.endPage);
    }
    if(!targets.length)throw new Error("所选范围还没有可配音的口播稿。");
    if(!body.force)targets=targets.filter(slide=>!slide.aiAudioUrl||!slide.aiAudioPath);
    totalPages=targets.length;
    if(!targets.length)return NextResponse.json(publicProject(project));
    const audioDirectory=path.join(directory,"audio");
    const {mkdir}=await import("node:fs/promises");await mkdir(audioDirectory,{recursive:true});
    await writeAudioProgress(directory,{status:"running",phase:"audio",label:"正在准备逐页配音",percent:2,completedPages:0,totalPages});
    for(const [index,slide] of targets.entries()){
      await writeAudioProgress(directory,{status:"running",phase:"audio",label:`正在生成第 ${slide.page} 页 MP3`,percent:Math.round((index/totalPages)*100),completedPages:index,totalPages,currentPage:slide.page});
      const fileName=`page-${String(slide.page).padStart(2,"0")}.mp3`,output=path.join(audioDirectory,fileName);
      const duration=await synthesize(slide.narration!,output,slide.recordingDirection);
      const url=`/api/files/${id}/audio/${fileName}?v=${Date.now()}`;
      slide.aiAudioPath=output;slide.aiAudioUrl=url;slide.aiDurationSeconds=duration;slide.aiNormalized=true;
      slide.audioPath=output;slide.audioUrl=url;slide.durationSeconds=duration;slide.audioSource="ai";slide.audioOutdated=false;
      await saveProject(project);
    }
    const allVoiced=project.slides.every(slide=>!slide.narration||slide.audioUrl);
    project.status=allVoiced&&project.slides.every(slide=>slide.narration)?"voiced":"audio-partial";
    await saveProject(project);
    await writeAudioProgress(directory,{status:"complete",phase:"complete",label:`已生成 ${totalPages} 页 MP3`,percent:100,completedPages:totalPages,totalPages});
    return NextResponse.json(publicProject(project));
  }catch(error){
    if(directory)await writeAudioProgress(directory,{status:"error",phase:"error",label:"MP3 生成中断",percent:0,completedPages:0,totalPages,error:error instanceof Error?error.message:"MP3 生成失败"});
    return NextResponse.json({error:error instanceof Error?error.message:"MP3 生成失败"},{status:500});
  }
}
