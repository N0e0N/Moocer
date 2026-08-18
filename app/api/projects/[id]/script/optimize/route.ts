import { NextResponse } from "next/server";
import { optimizeSlideNarration } from "@/lib/agent";
import { getProject,publicProject,saveProject,saveWorkflowArtifacts } from "@/lib/store";

export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const {id}=await params,body=await request.json(),project=await getProject(id);await optimizeSlideNarration(project,Number(body.page),String(body.intent||""));await saveProject(project);await saveWorkflowArtifacts(project);return NextResponse.json(publicProject(project))}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"口播优化失败"},{status:500})}
}
