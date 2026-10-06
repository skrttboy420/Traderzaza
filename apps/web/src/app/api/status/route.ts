import { NextResponse } from "next/server";
import { ASSETS } from "@atc/market-data";

import { capabilities, serverEnv } from "@/lib/env";
import { marketService } from "@/lib/scan";

export const dynamic = "force-dynamic";

/**
 * GET /api/status
 *
 * What the browser is allowed to know about the server configuration (§54,
 * §71, §77). Capability booleans and provider names only — never a key, never
 * a key fragment. The settings screen uses this to tell the user the truth
 * about which markets are live and whether a language model is attached.
 */
export async function GET() {
  const env = serverEnv();
  const service = marketService();

  const providers = ASSETS.map((asset) => {
    const provider = service.providerFor(asset.symbol);
    return {
      symbol: asset.symbol,
      display: asset.display,
      assetClass: asset.assetClass,
      provider: provider.name,
      quality: provider.quality,
    };
  });

  return NextResponse.json({
    capabilities: capabilities(env),
    candleLimit: env.candleLimit,
    /** Present so the user can see which model would be used, not the key. */
    aiModel: env.anthropicApiKey ? (env.anthropicModel ?? "claude (default)") : null,
    providers,
  });
}
