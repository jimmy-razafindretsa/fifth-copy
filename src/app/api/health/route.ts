import { connection } from "next/server";
import { getHealth } from "@/features/health";

export async function GET() {
  await connection(); // always evaluated at request time
  const health = await getHealth();
  return Response.json(health, { status: health.ok ? 200 : 503 });
}
