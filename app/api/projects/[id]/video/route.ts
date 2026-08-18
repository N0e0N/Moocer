import { NextResponse } from "next/server";
import path from "node:path";
import { renderVideo } from "@/lib/video";
import { writeVideoProgress } from "@/lib/video-progress";
import { getProject,projectDir,publicProject,saveProject } from "@/lib/store";

export const runtime="nodejs";
export const maxDuration=3600;

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  let directory="",totalPages=0;
  try{
    const {id}=await params,project=await getProject(id);directory=await projectDir(id);totalPages=project.slides.length;
    const body=await request.json().catch(()=>({})) as {startPage?:unknown;endPage?:unknown},rawStart=Number(body.startPage),rawEnd=Number(body.endPage),startPage=Number.isFinite(rawStart)?rawStart:1,endPage=Number.isFinite(rawEnd)?rawEnd:totalPages;
    const result=await renderVideo(project,directory,{startPage,endPage});project.videoPath=result.output;
    project.videoUrl=`/api/files/${id}/${encodeURIComponent(path.basename(result.output))}?v=${Date.now()}`;
    if(result.fullCourse)project.status="completed";await saveProject(project);
    return NextResponse.json(publicProject(project));
  }catch(error){
    if(directory)await writeVideoProgress(directory,{status:"error",phase:"error",label:"视频导出失败",percent:0,completedPages:0,totalPages,error:error instanceof Error?error.message:"视频导出失败"});
    return NextResponse.json({error:error instanceof Error?error.message:"视频导出失败"},{status:500});
  }
}
