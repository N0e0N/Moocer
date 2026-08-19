import { NextResponse } from "next/server";
import fs from "node:fs/promises";
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
    const result=await renderVideo(project,directory,{startPage,endPage}),createdAt=new Date(),versionId=`v-${createdAt.getTime()}`,exportsDirectory=path.join(directory,"exports"),filename=`${versionId}-pages-${String(result.startPage).padStart(2,"0")}-${String(result.endPage).padStart(2,"0")}.mp4`,versionPath=path.join(exportsDirectory,filename);
    await fs.mkdir(exportsDirectory,{recursive:true});await fs.copyFile(result.output,versionPath);
    const versionUrl=`/api/files/${id}/exports/${encodeURIComponent(filename)}?v=${createdAt.getTime()}`;
    const legacyVersions=project.videoVersions?.length?project.videoVersions:project.videoUrl&&project.videoPath?[{id:"v-legacy",url:project.videoUrl,path:project.videoPath,createdAt:project.createdAt,startPage:1,endPage:project.slides.length,durationSeconds:project.slides.reduce((total,slide)=>total+(slide.durationSeconds||0),0)}]:[];
    project.videoVersions=[{id:versionId,url:versionUrl,path:versionPath,createdAt:createdAt.toISOString(),startPage:result.startPage,endPage:result.endPage,durationSeconds:result.durationSeconds},...legacyVersions];project.videoPath=versionPath;
    project.videoUrl=versionUrl;
    if(result.fullCourse)project.status="completed";await saveProject(project);
    return NextResponse.json(publicProject(project));
  }catch(error){
    if(directory)await writeVideoProgress(directory,{status:"error",phase:"error",label:"视频导出失败",percent:0,completedPages:0,totalPages,error:error instanceof Error?error.message:"视频导出失败"});
    return NextResponse.json({error:error instanceof Error?error.message:"视频导出失败"},{status:500});
  }
}
