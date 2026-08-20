import path from "node:path";
import { NextResponse } from "next/server";
import { synthesize,type VoiceOptions } from "@/lib/media";
import { projectDir } from "@/lib/store";
export const runtime="nodejs";
export const maxDuration=300;

type PreviewRequest=VoiceOptions&{sampleId?:string;text?:string};

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params,body=await request.json().catch(()=>({})) as PreviewRequest;
    const sampleId=body.sampleId||"sample",text=(body.text||"").trim();
    if(!text)return NextResponse.json({error:"试听文案不能为空。"},{status:400});
    const directory=await projectDir(id),audioDirectory=path.join(directory,"design-preview");
    const {mkdir}=await import("node:fs/promises");await mkdir(audioDirectory,{recursive:true});
    const output=path.join(audioDirectory,`${sampleId}.mp3`);
    await synthesize(text,output,undefined,{role:body.role,speakerId:body.speakerId,speechRate:body.speechRate,pitchRate:body.pitchRate,loudnessRate:body.loudnessRate});
    const url=`/api/files/${id}/design-preview/${sampleId}.mp3?v=${Date.now()}`;
    return NextResponse.json({url});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"试听生成失败"},{status:500});
  }
}
