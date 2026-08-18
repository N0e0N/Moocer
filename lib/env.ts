import fs from "node:fs";
import path from "node:path";

let loaded=false;
export function loadBackendEnv(){
  if(loaded)return process.env; loaded=true;
  const candidates=[
    process.env.BACKEND_ENV_PATH,
    path.resolve(process.cwd(),".env.local")
  ].filter((file):file is string=>Boolean(file));
  const file=candidates.find(candidate=>fs.existsSync(candidate));
  if(!file)return process.env;
  for(const line of fs.readFileSync(file,"utf8").split(/\r?\n/)){
    if(!line.includes("=")||line.trim().startsWith("#"))continue;
    const at=line.indexOf("="); const key=line.slice(0,at).trim(); const value=line.slice(at+1).trim().replace(/^['"]|['"]$/g,"");
    if(!process.env[key]) process.env[key]=value;
  }
  return process.env;
}
