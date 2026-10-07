import { checkLlm } from "@/lib/agent/llm";
import { config } from "@/lib/config";
import { idp } from "@/lib/idp";
import { getSession, store } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  return Response.json({
    mode: config.mode,
    idpLabel: idp.label,
    llm: { model: config.llm.model, baseUrl: config.llm.baseUrl, status: await checkLlm() },
    agentName: config.agent.name,
    user: session.user ?? null,
    settings: store.settings,
    transcript: session.transcript,
    events: session.events,
  });
}
