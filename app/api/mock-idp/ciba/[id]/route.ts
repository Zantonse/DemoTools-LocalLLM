import { config } from "@/lib/config";
import { decideCiba } from "@/lib/idp/mock";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (config.mode !== "mock") return new Response("Not found", { status: 404 });
  const { id } = await params;
  const { decision } = (await req.json().catch(() => ({}))) as { decision?: string };
  if (decision !== "approved" && decision !== "denied") return Response.json({ error: "bad decision" }, { status: 400 });
  return decideCiba(id, decision) ? Response.json({ ok: true }) : Response.json({ error: "not pending" }, { status: 409 });
}
