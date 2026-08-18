const fs=require("fs");
const path=require("path");
const {pathToFileURL}=require("url");
const {chromium}=require("playwright");

(async()=>{
  const ids=process.argv.slice(2); if(!ids.length)throw new Error("Provide project IDs");
  const browser=await chromium.launch({headless:true});
  for(const id of ids){
    const dir=path.resolve("data/projects",id),project=JSON.parse(fs.readFileSync(path.join(dir,"project.json"),"utf8")),output=path.join(dir,"thumbnails");
    fs.mkdirSync(output,{recursive:true}); const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
    await page.goto(pathToFileURL(project.sourcePath).href,{waitUntil:"load"}); await page.evaluate(()=>{const nav=document.getElementById("nav");if(nav)nav.style.display="none"});
    for(const slide of project.slides){await page.evaluate(index=>{if(typeof window.show==="function")window.show(index);else document.querySelectorAll("section.slide,section").forEach((node,i)=>node.style.display=i===index?"block":"none")},slide.page-1);await page.waitForTimeout(80);await page.screenshot({path:path.join(output,`slide-${String(slide.page).padStart(2,"0")}.jpg`),type:"jpeg",quality:74});}
    await page.close(); console.log(`${project.title}: ${project.slides.length} thumbnails`);
  }
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
