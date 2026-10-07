import { config } from "@/lib/config";
import { listCibaRequests } from "@/lib/idp/mock";

export const dynamic = "force-dynamic";

/** Pending approval pushes, for the mock "Okta Verify" approver page. */
export async function GET() {
  if (config.mode !== "mock") return Response.json({ requests: [] });
  return Response.json({ agentName: config.agent.name, requests: listCibaRequests() });
}
