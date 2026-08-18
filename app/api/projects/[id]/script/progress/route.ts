import path from "node:path";
import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { readGenerationProgress } from "@/lib/generation-progress";
export const runtime="nodejs";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){try{const {id}=await params,project=await getProject(id);return NextResponse.json(await readGenerationProgress(path.dirname(project.outlinePath)))}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"进度读取失败"},{status:404})}}
