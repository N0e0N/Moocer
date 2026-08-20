import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET(request:Request,{params}:{params:Promise<{id:string;parts:string[]}>}){
  try{
    const {id,parts}=await params,root=path.resolve(process.cwd(),"data/projects",id),file=path.resolve(root,...parts);
    if(!file.startsWith(root))return new NextResponse("Forbidden",{status:403});
    const data=await fs.readFile(file),ext=path.extname(file).toLowerCase(),download=new URL(request.url).searchParams.get("download")==="1";
    const types:Record<string,string>={".mp3":"audio/mpeg",".mp4":"video/mp4",".m4a":"audio/mp4",".webm":"audio/webm",".ogg":"audio/ogg",".wav":"audio/wav",".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",".webp":"image/webp"};
    const baseHeaders={"Accept-Ranges":"bytes","Cache-Control":"public, max-age=31536000, immutable","Content-Type":types[ext]||"application/octet-stream","Content-Disposition":download?`attachment; filename="${path.basename(file)}"`:"inline"};
    const range=request.headers.get("range");
    if(ext===".mp4"&&!download&&range){
      const match=/bytes=(\d*)-(\d*)/.exec(range),start=match?.[1]?Number(match[1]):0,end=Math.min(match?.[2]?Number(match[2]):data.length-1,data.length-1);
      if(!match||start>end||start>=data.length)return new NextResponse(null,{status:416,headers:{...baseHeaders,"Content-Range":`bytes */${data.length}`}});
      const chunk=data.subarray(start,end+1);
      return new NextResponse(chunk,{status:206,headers:{...baseHeaders,"Content-Length":String(chunk.length),"Content-Range":`bytes ${start}-${end}/${data.length}`}});
    }
    return new NextResponse(data,{headers:{...baseHeaders,"Content-Length":String(data.length)}});
  }catch{return new NextResponse("Not found",{status:404})}
}
