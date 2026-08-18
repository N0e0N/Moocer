import { NextResponse } from "next/server";
import { listProjects, publicProject } from "@/lib/store";
export const runtime="nodejs";
export async function GET(){try{return NextResponse.json((await listProjects()).map(publicProject))}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"课程列表读取失败"},{status:500})}}
