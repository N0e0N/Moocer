import fs from "node:fs/promises";
import path from "node:path";

export type GenerationProgress={
  status:"idle"|"running"|"complete"|"error";
  phase:"preparing"|"planning"|"batching"|"oralizing"|"finalizing"|"complete"|"error";
  label:string;
  percent:number;
  completedPages:number;
  totalPages:number;
  currentBatch?:number;
  totalBatches?:number;
  range?:string;
  updatedAt:string;
  error?:string;
};

const fileFor=(projectDirectory:string)=>path.join(projectDirectory,"generation-progress.json");
export async function writeGenerationProgress(projectDirectory:string,progress:Omit<GenerationProgress,"updatedAt">){
  await fs.writeFile(fileFor(projectDirectory),`${JSON.stringify({...progress,updatedAt:new Date().toISOString()},null,2)}\n`,"utf8");
}
export async function readGenerationProgress(projectDirectory:string):Promise<GenerationProgress>{
  try{return JSON.parse(await fs.readFile(fileFor(projectDirectory),"utf8")) as GenerationProgress}
  catch{return {status:"idle",phase:"preparing",label:"等待生成",percent:0,completedPages:0,totalPages:0,updatedAt:new Date().toISOString()}}
}
