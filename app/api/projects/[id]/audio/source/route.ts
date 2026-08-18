import { NextResponse } from "next/server";
import { getProject,publicProject,saveProject } from "@/lib/store";

export const runtime="nodejs";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params,body=await request.json(),page=Number(body.page),source=body.source as "ai"|"recording";
    if(source!=="ai"&&source!=="recording")throw new Error("不支持的音频来源。");
    const project=await getProject(id),slide=project.slides.find(item=>item.page===page);
    if(!slide)throw new Error("没有找到对应页面。");
    const url=source==="ai"?slide.aiAudioUrl:slide.recordingAudioUrl;
    const audioPath=source==="ai"?slide.aiAudioPath:slide.recordingAudioPath;
    const duration=source==="ai"?slide.aiDurationSeconds:slide.recordingDurationSeconds;
    if(!url||!audioPath)throw new Error(source==="ai"?"本页还没有 AI 配音。":"本页还没有本人录音。");
    slide.audioSource=source;slide.audioUrl=url;slide.audioPath=audioPath;slide.durationSeconds=duration;
    await saveProject(project);
    return NextResponse.json(publicProject(project));
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"音频切换失败"},{status:500})}
}
