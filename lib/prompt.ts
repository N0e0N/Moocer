import fs from "node:fs/promises";
import path from "node:path";

export async function renderPrompt(fileName:string,variables:Record<string,string|number>){
  const promptPath=path.join(process.cwd(),"prompts",fileName);
  let prompt=await fs.readFile(promptPath,"utf8");
  for(const [name,value] of Object.entries(variables))prompt=prompt.replaceAll(`{{${name}}}`,String(value));
  const unresolved=[...prompt.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map(match=>match[1]);
  if(unresolved.length)throw new Error(`Prompt 缺少变量：${[...new Set(unresolved)].join("、")}`);
  return prompt.trim();
}
