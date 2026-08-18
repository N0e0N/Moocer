import { NextResponse } from "next/server";
import { readAudioProgress } from "@/lib/audio-progress";
import { projectDir } from "@/lib/store";

export const runtime="nodejs";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  return NextResponse.json(await readAudioProgress(await projectDir(id)));
}
