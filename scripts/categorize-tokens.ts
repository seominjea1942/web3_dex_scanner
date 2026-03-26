/**
 * Categorize tokens using:
 * 1. Jupiter API tags
 * 2. Keyword-based classification from name/symbol
 */
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const JUPITER_STRICT_URL = "https://token.jup.ag/strict";

// Keyword → category mapping
const KEYWORD_CATEGORIES: [RegExp, string][] = [
  [/\b(meme|pepe|doge|shib|bonk|wojak|chad|frog|cat|dog|inu|moon|rocket|elon|trump|biden|based)\b/i, "meme"],
  [/\b(ai|gpt|neural|machine|intelligence|agent|llm|compute)\b/i, "ai"],
  [/\b(game|gaming|play|nft|metaverse|virtual|avatar)\b/i, "gaming"],
  [/\b(defi|swap|lend|borrow|yield|farm|stake|liquid|amm|dex|finance)\b/i, "defi"],
  [/\b(sol|solana|raydium|orca|jupiter|marinade|jito)\b/i, "infrastructure"],
  [/\b(usdc|usdt|dai|busd|tusd|frax|stable)\b/i, "stablecoin"],
  [/\b(wrapped|bridge|wormhole|portal)\b/i, "wrapped"],
  [/\b(social|community|dao|governance|vote)\b/i, "social"],
  [/\b(rwa|real\s*world|tokenized|bond|treasury)\b/i, "rwa"],
  [/\b(depin|iot|sensor|network|wireless|helium)\b/i, "depin"],
];

function classifyByKeywords(name: string, symbol: string): string | null {
  const text = `${symbol} ${name}`.toLowerCase();
  for (const [re, cat] of KEYWORD_CATEGORIES) {
    if (re.test(text)) return cat;
  }
  return null;
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.TIDB_HOST,
    port: Number(process.env.TIDB_PORT || 4000),
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD || "",
    database: process.env.TIDB_DATABASE || "chainscope",
    ssl: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionLimit: 5,
  });

  console.log("🏷️  Categorizing tokens...\n");

  // 1. Fetch Jupiter tags
  console.log("  1. Fetching Jupiter token tags...");
  const jupiterTags = new Map<string, string[]>();
  try {
    const resp = await fetch(JUPITER_STRICT_URL);
    const tokens: { address: string; symbol: string; tags?: string[] }[] = await resp.json();
    for (const t of tokens) {
      if (t.tags && t.tags.length > 0) {
        jupiterTags.set(t.address, t.tags);
      }
    }
    console.log(`     Found tags for ${jupiterTags.size} tokens`);
  } catch (e) {
    console.warn("     ⚠️ Jupiter API failed:", e);
  }

  // 2. Get all our tokens
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT address, name, symbol FROM tokens WHERE category IS NULL"
  );
  console.log(`\n  2. Categorizing ${rows.length} uncategorized tokens...`);

  // Jupiter tag → category mapping
  const TAG_MAP: Record<string, string> = {
    "old-registry": "established",
    "community": "community",
    "strict": "verified",
    "token-2022": "token2022",
    "lst": "defi",
    "birdeye-trending": "trending",
  };

  let fromJupiter = 0;
  let fromKeywords = 0;
  let uncategorized = 0;

  for (const row of rows) {
    let category: string | null = null;

    // Try Jupiter tags first
    const tags = jupiterTags.get(row.address);
    if (tags) {
      // Pick the most specific tag
      for (const tag of tags) {
        if (TAG_MAP[tag] && TAG_MAP[tag] !== "verified" && TAG_MAP[tag] !== "established") {
          category = TAG_MAP[tag];
          break;
        }
      }
    }

    // Fallback: keyword classification
    if (!category) {
      category = classifyByKeywords(row.name || "", row.symbol || "");
    }

    if (category) {
      await pool.execute(
        "UPDATE tokens SET category = ? WHERE address = ?",
        [category, row.address]
      );
      if (tags) fromJupiter++;
      else fromKeywords++;
    } else {
      uncategorized++;
    }
  }

  console.log(`     Jupiter tags: ${fromJupiter}`);
  console.log(`     Keywords: ${fromKeywords}`);
  console.log(`     Uncategorized: ${uncategorized}`);

  // 3. Summary
  const [stats] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT category, COUNT(*) as cnt FROM tokens WHERE category IS NOT NULL GROUP BY category ORDER BY cnt DESC`
  );
  console.log(`\n  ✅ Category distribution:`);
  for (const s of stats) {
    console.log(`     ${s.category}: ${s.cnt}`);
  }

  const [total] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) as total, SUM(category IS NOT NULL) as categorized FROM tokens"
  );
  console.log(`\n     Total: ${total[0].total}, Categorized: ${total[0].categorized}`);

  await pool.end();
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
