import { NextResponse } from "next/server";
import { getProject, publicProject } from "@/lib/store";
import { ensureProjectThumbnails } from "@/lib/thumbnails";
export const runtime="nodejs";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){try{const {id}=await params,project=await getProject(id);await ensureProjectThumbnails(project);return NextResponse.json(publicProject(project))}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"课程读取失败"},{status:500})}}
