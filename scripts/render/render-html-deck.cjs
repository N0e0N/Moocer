const fs=require("fs");
const path=require("path");
const os=require("os");
const {pathToFileURL}=require("url");
const {chromium}=require("playwright");

function executable(){
  const own=chromium.executablePath();if(fs.existsSync(own))return own;
  const cache=path.join(os.homedir(),"Library","Caches","ms-playwright");
  if(process.platform==="darwin"&&fs.existsSync(cache)){
    const folder=fs.readdirSync(cache).filter(name=>/^chromium-\d+$/.test(name)).sort().at(-1);
    if(folder){const file=path.join(cache,folder,"chrome-mac-arm64","Google Chrome for Testing.app","Contents","MacOS","Google Chrome for Testing");if(fs.existsSync(file))return file}
  }
  return own;
}
function writeProgress(plan,item,index){
  if(!plan.progress_path)return;
  const finished=plan.cached_pages+index,percent=Math.round(5+((index+1)/Math.max(1,plan.pages.length))*48);
  fs.writeFileSync(plan.progress_path,`${JSON.stringify({status:"running",phase:"video",label:`正在录制第 ${item.page} 页画面`,percent,completedPages:finished,totalPages:plan.total_pages,currentPage:item.page,updatedAt:new Date().toISOString()},null,2)}\n`);
}

(async()=>{
  const [planPath]=process.argv.slice(2),plan=JSON.parse(fs.readFileSync(planPath,"utf8"));
  const browser=await chromium.launch({headless:true,executablePath:executable(),args:["--autoplay-policy=no-user-gesture-required","--allow-file-access-from-files"]});
  try{
    for(const [index,item] of plan.pages.entries()){
      fs.mkdirSync(path.dirname(item.visual_path),{recursive:true});
      const temporary=path.join(path.dirname(item.visual_path),`.record-${item.page}`);fs.mkdirSync(temporary,{recursive:true});
      const context=await browser.newContext({viewport:{width:1920,height:1080},recordVideo:{dir:temporary,size:{width:1920,height:1080}}});
      const page=await context.newPage(),video=page.video();
      await page.goto(pathToFileURL(plan.html_path).href,{waitUntil:"load"});
      await page.evaluate(async index=>{
        if(document.fonts?.ready)await document.fonts.ready;
        const nav=document.getElementById("nav");if(nav)nav.style.display="none";
        if(typeof window.show==="function")window.show(index);else{const slides=document.querySelectorAll("section.slide, section");slides.forEach((section,current)=>section.style.display=current===index?"block":"none")}
        document.querySelectorAll("video, audio").forEach(media=>{media.pause();media.currentTime=0;media.muted=true});
        document.querySelectorAll(".slide.active video, section[style*='block'] video").forEach(media=>media.play().catch(()=>{}));
      },item.slide_index);
      await page.waitForTimeout(Math.max(1000,Math.round(item.duration_seconds*1000)));
      await page.close();await context.close();
      if(!video)throw new Error(`第 ${item.page} 页没有生成录制文件。`);
      await video.saveAs(item.visual_path);writeProgress(plan,item,index);
      fs.rmSync(temporary,{recursive:true,force:true});
    }
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
