import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { supabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No shared-secret check: this is a liveness probe. It reports which
// integrations are configured, not whether they work.
export function GET() {
  return NextResponse.json({
    data: {
      status: "ok",
      service: "samurai-meet-ai",
      configured: {
        openai: Boolean(env.OPENAI_API_KEY),
        google_maps: Boolean(env.GOOGLE_MAPS_API_KEY),
        supabase: supabaseConfigured(),
        shared_secret: Boolean(env.AI_SERVICE_SHARED_SECRET),
      },
      // The AI logic (lib/ai.ts, lib/geo.ts) is stubbed; routes return 501.
      ai_logic_implemented: false,
    },
  });
}
