import { NextResponse } from "next/server";
import { projectDir } from "@/lib/store";
import { readVideoProgress } from "@/lib/video-progress";

export const runtime="nodejs";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  return NextResponse.json(await readVideoProgress(await projectDir(id)));
}
