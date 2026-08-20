import { NextResponse } from "next/server";
import { getProject,publicProject,saveProject } from "@/lib/store";
import type { CourseDesign } from "@/lib/types";
export const runtime="nodejs";

type DesignRequest={design?:CourseDesign;targetMinutes?:number};

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params,project=await getProject(id),body=await request.json().catch(()=>({})) as DesignRequest;
    const voice=body.design?.voice;
    if(!voice||typeof voice.role!=="string")return NextResponse.json({error:"慕课设计内容不完整。"},{status:400});
    project.design={
      voice:{role:voice.role.trim()||"",speakerId:voice.speakerId?.trim()||"",speechRate:Number(voice.speechRate)||0,pitchRate:Number(voice.pitchRate)||0,loudnessRate:Number(voice.loudnessRate)||0},
      style:(body.design?.style||project.style||"").trim(),
      preview:body.design?.preview||project.design?.preview||{},
      updatedAt:new Date().toISOString()
    };
    project.style=project.design.style;
    const targetMinutes=Math.round(Number(body.targetMinutes));
    if(Number.isFinite(targetMinutes)&&targetMinutes>=3&&targetMinutes<=180)project.targetMinutes=targetMinutes;
    await saveProject(project);
    return NextResponse.json(publicProject(project));
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"慕课设计保存失败"},{status:500});
  }
}
