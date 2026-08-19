import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { loadBackendEnv } from "./env";

const LOUDNESS_TARGET={integrated:-16,truePeak:-1.5,range:11};
const MP3_COMPENSATED_TARGET=-15.55;
type ProcessOutput={stdout:string;stderr:string};

function runWithOutput(command:string,args:string[],cwd?:string){return new Promise<ProcessOutput>((resolve,reject)=>{const p=spawn(command,args,{cwd});let stdout="",stderr="";p.stdout.on("data",data=>stdout+=data);p.stderr.on("data",data=>stderr+=data);p.on("error",reject);p.on("close",code=>code===0?resolve({stdout,stderr}):reject(new Error(stderr.slice(-2400)||`${command} 失败`)));});}

export type VoiceOptions={role?:string;speakerId?:string;speechRate?:number;pitchRate?:number;loudnessRate?:number};
const DEFAULT_ROLE="35至45岁、有经验的大学讲师。普通话清晰，语速约每秒4.8个汉字，语气平静、温和、有教学现场感。不加背景音乐和音效。";
export async function synthesize(text:string,output:string,direction?:string,options:VoiceOptions={}){
  const env=loadBackendEnv(); const base=env.VOLCENGINE_AUDIO_BASE_URL, key=env.VOLCENGINE_AUDIO_API_KEY, model=env.VOLCENGINE_AUDIO_MODEL, speaker=options.speakerId?.trim()||env.VOLCENGINE_AUDIO_SPEAKER;
  if(!base||!key||!model||!speaker) throw new Error("backend.env 中缺少豆包音频配置。");
  const delivery=direction?.trim().replace(/^<|>$/g,"");
  const role=`你是一位${options.role?.trim()||DEFAULT_ROLE}。${delivery?`本页演绎要求：${delivery}`:""}演绎要求不是台词，不得朗读。`;
  let last="未知错误";
  for(let attempt=1;attempt<=3;attempt++){
    const response=await fetch(base.replace(/\/$/,"")+"/tts/create",{method:"POST",headers:{"Content-Type":"application/json","X-Api-Key":key,"X-Api-Request-Id":randomUUID()},body:JSON.stringify({model,text_prompt:`${role}\n\n台词：【${text}】`,references:[{speaker}],audio_config:{format:"mp3",sample_rate:48000,pitch_rate:1+(options.pitchRate??0)/100,speech_rate:1+(options.speechRate??0)/100,loudness_rate:1+(options.loudnessRate??0)/100},watermark:{}}),signal:AbortSignal.timeout(300000)});
    const payload=await response.json() as {code?:number;message?:string;audio?:string}; if(response.ok&&payload.audio){const raw=`${output}.source.mp3`;try{await fs.writeFile(raw,Buffer.from(payload.audio,"base64"));return await normalizeAudio(raw,output)}finally{await fs.rm(raw,{force:true})}}last=payload.message||String(response.status);if(attempt<3)await new Promise(r=>setTimeout(r,attempt*1500));
  }
  throw new Error(`音频生成失败：${last}`);
}
export async function run(command:string,args:string[],cwd?:string){return (await runWithOutput(command,args,cwd)).stdout;}
export async function probe(file:string){const out=await run("ffprobe",["-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",file]);return Number(out.trim());}
async function measureLoudness(input:string){
  const target=`I=${LOUDNESS_TARGET.integrated}:TP=${LOUDNESS_TARGET.truePeak}:LRA=${LOUDNESS_TARGET.range}`,analysis=await runWithOutput("ffmpeg",["-hide_banner","-nostats","-i",input,"-vn","-af",`loudnorm=${target}:print_format=json`,"-f","null","-"]);
  const report=[...analysis.stderr.matchAll(/\{\s*"input_i"[\s\S]*?\}/g)].at(-1)?.[0];
  return report?JSON.parse(report) as Record<string,string>:null;
}
export async function normalizeAudio(input:string,output:string){
  const stage=`${output}.loudness.wav`,target=`I=-15.5:TP=${LOUDNESS_TARGET.truePeak}:LRA=${LOUDNESS_TARGET.range}`;
  try{
    await run("ffmpeg",["-y","-i",input,"-vn","-af",`acompressor=threshold=0.08:ratio=3:attack=15:release=180:makeup=3,loudnorm=${target}:linear=false`,"-ac","1","-ar","48000","-c:a","pcm_s16le",stage]);
    const measured=await measureLoudness(stage),integrated=Number(measured?.input_i),gain=Number.isFinite(integrated)?MP3_COMPENSATED_TARGET-integrated:0;
    await run("ffmpeg",["-y","-i",stage,"-vn","-af",`volume=${gain.toFixed(2)}dB,alimiter=limit=0.79:attack=5:release=50:level=false`,"-ac","1","-ar","48000","-c:a","libmp3lame","-b:a","160k",output]);
    return probe(output);
  }finally{await fs.rm(stage,{force:true})}
}
export async function denoiseRecording(input:string,output:string){
  const denoised=`${output}.denoised.wav`,filters=[
    "highpass=f=70",
    "afftdn=nr=10:nf=-45:tn=1:gs=5",
    "lowpass=f=15000"
  ].join(",");
  try{
    await run("ffmpeg",["-y","-i",input,"-vn","-af",filters,"-ac","1","-ar","48000","-c:a","pcm_s16le",denoised]);
    return await normalizeAudio(denoised,output);
  }finally{await fs.rm(denoised,{force:true})}
}
export async function concatAudio(files:string[],output:string){const list=path.join(path.dirname(output),"audio-list.txt");await fs.writeFile(list,files.map(f=>`file '${f.replace(/'/g,"'\\''")}'`).join("\n"));await run("ffmpeg",["-y","-f","concat","-safe","0","-i",list,"-c:a","aac","-b:a","192k",output]);}
