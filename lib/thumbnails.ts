import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import type { Project } from "./types";

const run=promisify(execFile);
const thumbnailName=(page:number)=>`slide-${String(page).padStart(2,"0")}.jpg`;

export async function ensureProjectThumbnails(project:Project){
  const output=path.join(path.dirname(project.outlinePath),"thumbnails");
  await fs.mkdir(output,{recursive:true});
  const missing:number[]=[];
  for(const slide of project.slides){try{const stat=await fs.stat(path.join(output,thumbnailName(slide.page)));if(stat.size<1000)missing.push(slide.page)}catch{missing.push(slide.page)}}
  if(!missing.length)return;
  if(project.sourceType==="html"||project.sourceType==="htm")await renderHtmlThumbnails(project,output,missing);
  else if(project.sourceType==="pdf")await renderPdfThumbnails(project,output,missing);
  else throw new Error(`当前还不能为 ${project.sourceType.toUpperCase()} 课件自动生成缩略图。`);
  for(const page of missing){const file=path.join(output,thumbnailName(page));try{const stat=await fs.stat(file);if(stat.size<1000)throw new Error()}catch{throw new Error(`第 ${page} 页缩略图生成失败。`)}}
}

async function renderHtmlThumbnails(project:Project,output:string,pages:number[]){
  const browser=await chromium.launch({headless:true});
  try{
    const browserPage=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
    await browserPage.goto(pathToFileURL(project.sourcePath).href,{waitUntil:"load",timeout:60000});
    await browserPage.evaluate(async()=>{const nav=document.getElementById("nav");if(nav)nav.style.visibility="hidden";await document.fonts?.ready});
    for(const page of pages){
      await browserPage.evaluate(index=>{
        const globalWindow=window as Window&{show?:(page:number)=>void};
        if(typeof globalWindow.show==="function")globalWindow.show(index);
        else {
          const candidates=document.querySelectorAll("#deck > .slide,.slide,[data-slide],[data-page],section");
          candidates.forEach((node,nodeIndex)=>{const element=node as HTMLElement;element.classList.toggle("active",nodeIndex===index);element.style.display=nodeIndex===index?"block":"none"});
        }
      },page-1);
      await browserPage.waitForTimeout(180);
      await browserPage.screenshot({path:path.join(output,thumbnailName(page)),type:"jpeg",quality:78,animations:"disabled"});
    }
    await browserPage.close();
  }finally{await browser.close()}
}

async function renderPdfThumbnails(project:Project,output:string,pages:number[]){
  for(const page of pages){
    const base=path.join(output,`pdf-${String(page).padStart(2,"0")}`);
    await run("pdftoppm",["-f",String(page),"-l",String(page),"-singlefile","-jpeg","-scale-to-x","1280","-scale-to-y","-1","-jpegopt","quality=78",project.sourcePath,base],{timeout:60000});
    await fs.rename(`${base}.jpg`,path.join(output,thumbnailName(page)));
  }
}
