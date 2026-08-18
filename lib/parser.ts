import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { load } from "cheerio";
import JSZip from "jszip";
import type { MediaAsset, MediaManifest, PageAnimation, Slide } from "./types";

const run=promisify(execFile);

const clean=(s:string)=>s.replace(/\s+/g," ").trim();
const slideCandidates=($:ReturnType<typeof load>)=>{
  const selectors=["#deck > .slide",".slide","[data-slide]","[data-page]","section"];
  for(const selector of selectors){const nodes=$(selector);if(nodes.length)return nodes}
  return $([]);
};
const semanticTitle=($:ReturnType<typeof load>,node:ReturnType<ReturnType<typeof load>>[number],page:number)=>{
  const root=$(node),declared=root.attr("data-title")||root.attr("aria-label"),heading=clean(root.find("h1,h2,h3,.title,[data-title]").first().text());
  if(declared?.trim())return clean(declared);
  if(heading)return heading;
  const candidates=root.find("div,span,p").toArray().map(element=>{const item=$(element),text=clean(item.clone().children().remove().end().text()),size=Number((item.attr("style")?.match(/font-size\s*:\s*([\d.]+)px/i)||[])[1]||0);return {text,size}}).filter(item=>item.text.length>=2&&item.text.length<=80&&!/^\d+$/.test(item.text));
  candidates.sort((a,b)=>b.size-a.size||a.text.length-b.text.length);
  return candidates[0]?.text||`第 ${page} 页`;
};
export async function parseDeck(filePath:string, ext:string):Promise<Slide[]>{
  if([".html",".htm"].includes(ext)){
    const html=await fs.readFile(filePath,"utf8"), $=load(html), candidates=slideCandidates($),slides:Slide[]=[];
    candidates.each((i,el)=>{ const node=$(el),text=clean(node.text()),declared=node.attr("data-slide-type"); const title=semanticTitle($,el,i+1); const motion=declared==="motion"||node.find("video,canvas,[data-motion]").length>0||node.find("img[src$='.gif']").length>0; const transition=declared==="transition"||text.length<18; slides.push({page:i+1,title,text,type:motion?"motion":transition?"transition":"static"}); });
    if(!slides.length) throw new Error("没有识别到幻灯片页面。支持 #deck > .slide、.slide、data-slide、data-page 或 section 页面结构。"); return slides;
  }
  if(ext===".pptx"){
    const zip=await JSZip.loadAsync(await fs.readFile(filePath)); const names=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/\d+/)![0])-Number(b.match(/\d+/)![0]));
    return Promise.all(names.map(async(n,i)=>{const xml=await zip.file(n)!.async("string"); const texts=[...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m=>m[1].replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim()).filter(Boolean); return {page:i+1,title:texts[0]||`第 ${i+1} 页`,text:clean(texts.join(" ")),type:texts.join("").length<18?"transition":"static"} as Slide;}));
  }
  if(ext===".pdf"){
    const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs"); const doc=await pdfjs.getDocument({data:new Uint8Array(await fs.readFile(filePath)),useSystemFonts:true}).promise; const slides:Slide[]=[];
    for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),content=await page.getTextContent(), text=clean(content.items.map(x=>("str" in x?x.str:"")).join(" "));slides.push({page:i,title:text.split(/[。！？]/)[0].slice(0,60)||`第 ${i} 页`,text,type:text.length<18?"transition":"static"});} return slides;
  }
  throw new Error("暂不支持这种课件格式。");
}

export async function readOutline(filePath:string,ext:string){
  if([".md",".txt"].includes(ext)) return fs.readFile(filePath,"utf8");
  if(ext===".docx"){const zip=await JSZip.loadAsync(await fs.readFile(filePath)); const xml=await zip.file("word/document.xml")?.async("string"); if(!xml)throw new Error("无法读取 DOCX 课纲。"); return clean(xml.replace(/<w:tab\/>/g,"\t").replace(/<\/w:p>/g,"\n").replace(/<[^>]+>/g," "));}
  throw new Error("课纲请使用 Markdown、TXT 或 DOCX。");
}

export async function buildMediaManifest(sourcePath:string,slides:Slide[]):Promise<MediaManifest>{
  const pages:MediaManifest["pages"]=[];
  if(/\.html?$/i.test(sourcePath)){
    const $=load(await fs.readFile(sourcePath,"utf8")), candidates=slideCandidates($);
    for(const [index,element] of candidates.toArray().entries()){
      const node=$(element),slide=slides[index],textBlocks=[...new Set(node.find("h1,h2,h3,h4,h5,h6,p,li,td,th,figcaption,div,span").toArray().map(item=>clean($(item).clone().children().remove().end().text())).filter(text=>text.length>=2&&text.length<=500))];
      const assetElements=node.find("img,video,audio,source").toArray(),assets:MediaAsset[]=[];
      for(const assetElement of assetElements){
        const asset=$(assetElement),source=asset.attr("src");if(!source||source.startsWith("data:")||/^https?:/i.test(source))continue;
        if(assets.some(item=>item.path===source))continue;
        const tag=assetElement.tagName.toLowerCase(),extension=path.extname(source.split(/[?#]/)[0]).toLowerCase(),kind:MediaAsset["kind"]=tag==="video"||[".mp4",".mov",".webm",".m4v"].includes(extension)?"video":tag==="audio"||[".mp3",".wav",".m4a",".aac"].includes(extension)?"audio":extension===".gif"?"gif":extension===".svg"?"svg":tag==="img"?"image":"unknown";
        const localPath=path.resolve(path.dirname(sourcePath),decodeURIComponent(source.split(/[?#]/)[0])),metadata=await probeAsset(localPath,kind);
        const parent=asset.parent("video,audio");
        assets.push({path:source,kind,...metadata,autoplay:asset.is("[autoplay]")||parent.is("[autoplay]"),loop:asset.is("[loop]")||parent.is("[loop]"),muted:asset.is("[muted]")||parent.is("[muted]"),controls:asset.is("[controls]")||parent.is("[controls]")});
      }
      const html=node.html()||"",animations:PageAnimation[]=[];
      if(node.find("canvas").length)animations.push({kind:"canvas",detail:`包含 ${node.find("canvas").length} 个 Canvas 画布`});
      if(node.find("[data-motion]").length)animations.push({kind:"data-motion",detail:`包含 ${node.find("[data-motion]").length} 个 data-motion 元素`});
      if(/animation(?:-name)?\s*:/i.test(html))animations.push({kind:"css-animation",detail:"页面元素包含 CSS animation"});
      if(/transition\s*:/i.test(html))animations.push({kind:"css-transition",detail:"页面元素包含 CSS transition"});
      if(node.find("[onclick],[onmouseover],[onmouseenter],[onmousemove],[onchange],button,input,select,textarea").length)animations.push({kind:"scripted",detail:"页面包含可交互元素或事件处理器"});
      const motionDuration=Math.max(0,...assets.filter(asset=>asset.kind==="video"||asset.kind==="gif").map(asset=>asset.duration_seconds||0));
      pages.push({page:slide.page,title:slide.title,type:slide.type,visible_text:slide.text,text_blocks:textBlocks.slice(0,120),html_excerpt:compactHtml(node.html()||""),assets,animations,has_canvas:node.find("canvas").length>0,has_interaction:animations.some(animation=>animation.kind==="scripted"),watch_seconds:slide.type==="motion"?Math.min(12,Math.max(5,motionDuration?Math.round(motionDuration*.45):7)):0});
    }
  }else{
    pages.push(...slides.map(slide=>({page:slide.page,title:slide.title,type:slide.type,visible_text:slide.text,text_blocks:slide.text?[slide.text]:[],html_excerpt:"",assets:[],animations:[],has_canvas:false,has_interaction:false,watch_seconds:0})));
  }
  return {
    version:2,source:sourcePath,generated_at:new Date().toISOString(),pages,
    transition_pages:slides.filter(slide=>slide.type==="transition").map(slide=>slide.page)
  };
}

function compactHtml(html:string){return html.replace(/<!--([\s\S]*?)-->/g,"").replace(/\s(?:class|id)=("[^"]*"|'[^']*')/gi,"").replace(/style=("[^"]*"|'[^']*')/gi,match=>{const value=match.slice(7,-1),kept=value.split(";").filter(rule=>/^(?:position|left|top|width|height|font-size|font-weight|color|background|opacity|display|animation|transition|transform|object-fit)\s*:/i.test(rule.trim()));return kept.length?`style="${kept.join(";")}"`:""}).replace(/\s+/g," ").trim().slice(0,12000)}
async function probeAsset(filePath:string,kind:MediaAsset["kind"]):Promise<Partial<MediaAsset>>{
  try{
    const {stdout}=await run("ffprobe",["-v","error","-show_entries","format=duration:stream=width,height,duration","-of","json",filePath],{timeout:15000,maxBuffer:1024*1024}),result=JSON.parse(stdout),stream=result.streams?.find((item:{width?:number;height?:number})=>item.width||item.height)||result.streams?.[0]||{},duration=Number(result.format?.duration||stream.duration||0);
    return {duration_seconds:Number.isFinite(duration)&&duration>0?Math.round(duration*10)/10:undefined,width:stream.width||undefined,height:stream.height||undefined,missing:false};
  }catch{return {missing:kind!=="unknown"}}
}
