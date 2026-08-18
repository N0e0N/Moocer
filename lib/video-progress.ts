import fs from "node:fs/promises";
import path from "node:path";

export type VideoProgress={
  status:"idle"|"running"|"complete"|"error";
  phase:"video"|"finalizing"|"complete"|"error";
  label:string;
  percent:number;
  completedPages:number;
  totalPages:number;
  currentPage?:number;
  range?:string;
  updatedAt:string;
  error?:string;
};

const fileFor=(projectDirectory:string)=>path.join(projectDirectory,"video-progress.json");
export async function writeVideoProgress(projectDirectory:string,progress:Omit<VideoProgress,"updatedAt">){
  await fs.writeFile(fileFor(projectDirectory),`${JSON.stringify({...progress,updatedAt:new Date().toISOString()},null,2)}\n`,"utf8");
}
export async function readVideoProgress(projectDirectory:string):Promise<VideoProgress>{
  try{return JSON.parse(await fs.readFile(fileFor(projectDirectory),"utf8")) as VideoProgress}
  catch{return {status:"idle",phase:"video",label:"等待导出视频",percent:0,completedPages:0,totalPages:0,updatedAt:new Date().toISOString()}}
}
