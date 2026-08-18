import fs from "node:fs/promises";
import path from "node:path";
import { denoiseRecording, normalizeAudio } from "../../lib/media";
import { getProject, saveProject } from "../../lib/store";

const ids=process.argv.slice(2);
if(!ids.length)throw new Error("请显式提供要归一化的项目 ID。");

async function exists(file:string|undefined){if(!file)return false;try{await fs.access(file);return true}catch{return false}}

for(const id of ids){
  const project=await getProject(id);let aiCount=0,recordingCount=0;
  for(const slide of project.slides){
    const pageName=String(slide.page).padStart(2,"0"),version=Date.now();
    if(await exists(slide.aiAudioPath)){
      const target=slide.aiAudioPath!,temporary=`${target}.normalized.mp3`,duration=await normalizeAudio(target,temporary);
      await fs.rename(temporary,target);slide.aiDurationSeconds=duration;slide.aiNormalized=true;slide.aiAudioUrl=`/api/files/${id}/audio/${path.basename(target)}?v=${version}`;
      if(slide.audioSource!=="recording"){slide.audioPath=target;slide.audioUrl=slide.aiAudioUrl;slide.durationSeconds=duration}
      aiCount++;
    }
    if(await exists(slide.recordingAudioPath)){
      const current=slide.recordingAudioPath!,directory=path.dirname(current),extension=path.extname(current)||".webm",clean=path.join(directory,`page-${pageName}-recording.mp3`),temporary=`${clean}.normalized.mp3`;
      let original=slide.recordingOriginalPath;
      if(!await exists(original)){original=path.join(directory,`page-${pageName}-recording-original${extension}`);await fs.copyFile(current,original)}
      const duration=slide.recordingDenoised?await normalizeAudio(current,temporary):await denoiseRecording(original!,temporary);
      await fs.rename(temporary,clean);slide.recordingOriginalPath=original;slide.recordingAudioPath=clean;slide.recordingAudioUrl=`/api/files/${id}/audio/${path.basename(clean)}?v=${version}`;slide.recordingDurationSeconds=duration;slide.recordingDenoised=true;slide.recordingNormalized=true;
      if(slide.audioSource==="recording"){slide.audioPath=clean;slide.audioUrl=slide.recordingAudioUrl;slide.durationSeconds=duration}
      recordingCount++;
    }
  }
  await saveProject(project);
  console.log(`${project.title}: AI ${aiCount} 条，本人录音 ${recordingCount} 条已统一响度`);
}
