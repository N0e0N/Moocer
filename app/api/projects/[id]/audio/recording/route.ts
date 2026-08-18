import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { denoiseRecording } from "@/lib/media";
import { getProject,projectDir,publicProject,saveProject } from "@/lib/store";

export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params,form=await request.formData(),page=Number(form.get("page")),file=form.get("audio");
    if(!(file instanceof File)||!file.size)throw new Error("没有收到录音文件。");
    if(file.size>100*1024*1024)throw new Error("单页录音不能超过 100MB。");
    if(file.type&&!file.type.startsWith("audio/"))throw new Error("上传的文件不是有效音频。");
    const project=await getProject(id),slide=project.slides.find(item=>item.page===page);if(!slide)throw new Error("没有找到对应页面。");
    const extension=file.type.includes("ogg")?"ogg":file.type.includes("wav")?"wav":"webm",directory=path.join(await projectDir(id),"audio");await fs.mkdir(directory,{recursive:true});
    const pageName=String(page).padStart(2,"0"),originalName=`page-${pageName}-recording-original.${extension}`,cleanName=`page-${pageName}-recording.mp3`,original=path.join(directory,originalName),clean=path.join(directory,cleanName);
    await fs.writeFile(original,Buffer.from(await file.arrayBuffer()));
    const duration=await denoiseRecording(original,clean),url=`/api/files/${id}/audio/${cleanName}?v=${Date.now()}`;
    slide.recordingOriginalPath=original;slide.recordingDenoised=true;slide.recordingNormalized=true;
    slide.recordingAudioPath=clean;slide.recordingAudioUrl=url;slide.recordingDurationSeconds=duration;
    slide.audioPath=clean;slide.audioUrl=url;slide.durationSeconds=duration;slide.audioSource="recording";
    project.status=project.slides.every(item=>item.narration&&item.audioUrl)?"voiced":"audio-partial";await saveProject(project);return NextResponse.json(publicProject(project));
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"录音上传失败"},{status:500})}
}
