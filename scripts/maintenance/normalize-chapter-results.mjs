import fs from "node:fs/promises";
import path from "node:path";

const projectId=process.argv[2];
if(!projectId)throw new Error("请提供项目 ID。");
const projectDirectory=path.resolve("data/projects",projectId);
const project=JSON.parse(await fs.readFile(path.join(projectDirectory,"project.json"),"utf8"));
const order=new Map(project.slides.map((slide,index)=>[slide.page,index+1]));
const spokenChars=text=>(text.match(/[\u3400-\u9fffA-Za-z0-9]/g)||[]).length;
const round=value=>Math.round(value*10)/10;
const spokenDuration=text=>round(Math.max(2.5,spokenChars(text)/4.8));
const splitSegments=text=>{
  if(spokenDuration(text)<=16)return [text];
  return (text.match(/[^。！？；]+[。！？；]?/g)||[text]).flatMap(sentence=>spokenDuration(sentence)<=16?[sentence]:(sentence.match(/[^，、：]+[，、：]?/g)||[sentence])).filter(Boolean);
};
const pauseAfter=(segment,next)=>{
  const clean=segment.trim();
  if(/[,，、：]$/.test(clean))return .35;
  if(/[？?]$/.test(clean))return .9;
  if(/[！!]$/.test(clean))return .7;
  if(/[；;]$/.test(clean))return .45;
  if(/^(先看|请观察|想一想|注意|先不要急)/.test(clean))return .8;
  if(/^(所以|因此|接下来|现在|最后|换句话说|也就是说|这时|当)/.test(next.trim()))return .65;
  return spokenChars(clean)<=16?.65:.5;
};
function makeAudioPrompt(slide){
  const text=slide.narration.trim(),segments=splitSegments(text),pauses=segments.map((segment,index)=>index===segments.length-1?0:pauseAfter(segment,segments[index+1]));
  const duration=round(Math.max(2.5,spokenChars(text)/4.8)+pauses.reduce((sum,pause)=>sum+pause,0));
  const available=duration-pauses.reduce((sum,pause)=>sum+pause,0),total=Math.max(1,spokenChars(text));let cursor=0;
  const timestamps=segments.map((segment,index)=>{const end=index===segments.length-1?duration:round(cursor+available*spokenChars(segment)/total),line=`[${cursor.toFixed(1)}s:${end.toFixed(1)}s]【${segment.trim()}】`;cursor=round(end+pauses[index]);return line});
  const direction=(slide.recordingDirection||"语气平稳，核心判断清楚落点").replace(/^<|>$/g,"");
  return [`#口播${order.get(slide.page)??slide.page}`,`描述：<${direction}>`,"台词：",...timestamps].join("\n");
}

const inputRoot=path.join(projectDirectory,"generation-input");
const chapters=(await fs.readdir(inputRoot,{withFileTypes:true})).filter(item=>item.isDirectory()&&/^chapter-\d+$/.test(item.name));
let converted=0;
for(const chapter of chapters){
  const resultPath=path.join(inputRoot,chapter.name,"result.json");
  try{
    const result=JSON.parse(await fs.readFile(resultPath,"utf8"));
    if(!result.slides?.length||result.slides.every(slide=>typeof slide.audio_prompt==="string"))continue;
    await fs.writeFile(path.join(inputRoot,chapter.name,"draft-result.json"),`${JSON.stringify(result,null,2)}\n`);
    const slides=result.slides.map(slide=>({page:slide.page,title:slide.title,teachingTask:slide.teachingTask,audio_prompt:makeAudioPrompt(slide)}));
    await fs.writeFile(resultPath,`${JSON.stringify({slides},null,2)}\n`);converted++;
  }catch(error){if(error?.code!=="ENOENT")throw error}
}
console.log(JSON.stringify({projectId,converted},null,2));
