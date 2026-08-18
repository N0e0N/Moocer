import { prepareVoicePrompts } from "../../lib/agent";
import { getProject } from "../../lib/store";

const projectId=process.argv[2];
if(!projectId)throw new Error("用法：npx tsx scripts/maintenance/snapshot-prompts.ts <project-id>");
const project=await getProject(projectId),prompts=await prepareVoicePrompts(project);
console.log(JSON.stringify({projectId,systemPromptCharacters:prompts.systemPrompt.length,userPromptCharacters:prompts.userPrompt.length,outputDirectory:`data/projects/${projectId}/generation-input`},null,2));
