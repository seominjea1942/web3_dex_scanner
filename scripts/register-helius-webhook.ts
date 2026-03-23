/**
 * One-time script to register a Helius enhanced webhook.
 * Watches the top 50 pools (by 24h volume) for swaps, liquidity, and pool creation events.
 *
 * Usage:
 *   npx tsx scripts/register-helius-webhook.ts
 *
 * Options:
 *   --delete-all   Delete all existing webhooks before registering
 *   --list         List existing webhooks and exit
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getPool } from "../lib/db";
import { createWebhook, listWebhooks, deleteWebhook } from "../lib/helius";
import type { RowDataPacket } from "mysql2";

async function main() {
  const args = process.argv.slice(2);

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    console.error("Error: HELIUS_API_KEY not set in .env.local");
    process.exit(1);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    console.error("Error: NEXT_PUBLIC_APP_URL not set in .env.local");
    console.error("  For local dev, use your ngrok URL (e.g. https://abc123.ngrok.io)");
    process.exit(1);
  }

  // --list: show existing webhooks
  if (args.includes("--list")) {
    console.log("Existing Helius webhooks:");
    const hooks = await listWebhooks();
    console.log(JSON.stringify(hooks, null, 2));
    process.exit(0);
  }

  // --delete-all: remove all existing webhooks
  if (args.includes("--delete-all")) {
    console.log("Deleting all existing webhooks...");
    const hooks = (await listWebhooks()) as Array<{ webhookID: string }>;
    for (const hook of hooks) {
      console.log(`  Deleting ${hook.webhookID}...`);
      await deleteWebhook(hook.webhookID);
    }
    console.log(`Deleted ${hooks.length} webhooks.`);
    if (!args.includes("--register")) {
      process.exit(0);
    }
  }

  // Get top 50 pool addresses from TiDB
  const db = getPool();
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT pool_address FROM pools ORDER BY volume_24h DESC LIMIT 50"
  );
  const addresses = rows.map((r) => r.pool_address as string);

  if (addresses.length === 0) {
    console.error("No pools found in database. Run the seed script first.");
    process.exit(1);
  }

  console.log(`Found ${addresses.length} pools to watch.`);
  console.log(`Webhook URL: ${appUrl}/api/webhooks/helius`);
  console.log("Registering webhook with Helius...");

  const webhookId = await createWebhook(addresses);

  console.log(`\nWebhook registered successfully!`);
  console.log(`  Webhook ID: ${webhookId}`);
  console.log(`  Watching: ${addresses.length} pools`);
  console.log(`  Types: SWAP, ADD_LIQUIDITY, REMOVE_LIQUIDITY, CREATE_ACCOUNT, INITIALIZE_ACCOUNT`);
  console.log(`\nHelius will now POST swap events to:`);
  console.log(`  ${appUrl}/api/webhooks/helius`);

  await db.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
