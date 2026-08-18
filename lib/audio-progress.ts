import fs from "node:fs/promises";
import path from "node:path";

export type AudioProgress={
  status:"idle"|"running"|"complete"|"error";
  phase:"audio"|"complete"|"error";
  label:string;
  percent:number;
  completedPages:number;
  totalPages:number;
  currentPage?:number;
  updatedAt:string;
  error?:string;
};

const fileFor=(projectDirectory:string)=>path.join(projectDirectory,"audio-progress.json");
export async function writeAudioProgress(projectDirectory:string,progress:Omit<AudioProgress,"updatedAt">){
  await fs.writeFile(fileFor(projectDirectory),`${JSON.stringify({...progress,updatedAt:new Date().toISOString()},null,2)}\n`,"utf8");
}
export async function readAudioProgress(projectDirectory:string):Promise<AudioProgress>{
  try{return JSON.parse(await fs.readFile(fileFor(projectDirectory),"utf8")) as AudioProgress}
  catch{return {status:"idle",phase:"audio",label:"等待生成 MP3",percent:0,completedPages:0,totalPages:0,updatedAt:new Date().toISOString()}}
}
