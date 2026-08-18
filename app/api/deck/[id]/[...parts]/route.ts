import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
export const runtime="nodejs";

export async function GET(_:Request,{params}:{params:Promise<{id:string;parts:string[]}>}){
  try{
    const {id,parts}=await params,project=await getProject(id),root=path.dirname(project.sourcePath),file=path.resolve(root,...parts);
    if(!file.startsWith(root))return new NextResponse("Forbidden",{status:403});
    const data=await fs.readFile(file),ext=path.extname(file).toLowerCase();
    const types:Record<string,string>={".html":"text/html; charset=utf-8",".htm":"text/html; charset=utf-8",".css":"text/css",".js":"text/javascript",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",".webp":"image/webp",".mp4":"video/mp4",".mov":"video/quicktime",".svg":"image/svg+xml"};
    return new NextResponse(data,{headers:{"Content-Type":types[ext]||"application/octet-stream"}});
  }catch{return new NextResponse("Not found",{status:404})}
}
