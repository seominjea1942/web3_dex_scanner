/**
 * Collect safety data for tokens:
 * 1. Fetch Jupiter strict token list → mark as verified
 * 2. Compute risk_score from existing columns
 */
import mysql from "mysql2/promise";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const JUPITER_STRICT_URL = "https://token.jup.ag/strict";

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

  console.log("📋 Collecting safety data...\n");

  // 1. Fetch Jupiter verified tokens
  console.log("  1. Fetching Jupiter strict token list...");
  let verifiedAddresses = new Set<string>();
  try {
    const resp = await fetch(JUPITER_STRICT_URL);
    const tokens: { address: string; tags?: string[] }[] = await resp.json();
    verifiedAddresses = new Set(tokens.map((t) => t.address));
    console.log(`     Found ${verifiedAddresses.size} verified tokens`);
  } catch (e) {
    console.warn("     ⚠️ Jupiter API failed, skipping verified flag:", e);
  }

  // 2. Mark verified tokens
  if (verifiedAddresses.size > 0) {
    // Get all our token addresses
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT token_address FROM token_safety"
    );
    let verified = 0;
    for (const row of rows) {
      if (verifiedAddresses.has(row.token_address)) {
        await pool.execute(
          "UPDATE token_safety SET is_verified = 1 WHERE token_address = ?",
          [row.token_address]
        );
        verified++;
      }
    }
    console.log(`     Marked ${verified} tokens as verified`);
  }

  // 3. Compute risk_score for all tokens
  console.log("\n  2. Computing risk scores...");
  const [safetyRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT token_address, holder_count, is_mintable, is_freezable,
            top10_holder_pct, lp_locked, is_lp_burned, is_verified
     FROM token_safety`
  );

  let scored = 0;
  for (const r of safetyRows) {
    let score = 0;
    // No mint authority = safer (+20)
    if (r.is_mintable === 0) score += 20;
    // No freeze authority = safer (+10)
    if (r.is_freezable === 0) score += 10;
    // LP locked = safer (+15)
    if (r.lp_locked === 1) score += 15;
    // LP burned = safest LP state (+25)
    if (r.is_lp_burned === 1) score += 25;
    // Decentralized holders (+15)
    if (r.top10_holder_pct !== null && Number(r.top10_holder_pct) < 50) score += 15;
    // More holders = safer (+15)
    if (r.holder_count !== null && Number(r.holder_count) > 100) score += 15;

    await pool.execute(
      "UPDATE token_safety SET risk_score = ? WHERE token_address = ?",
      [score, r.token_address]
    );
    scored++;
  }
  console.log(`     Computed risk_score for ${scored} tokens`);

  // 4. Summary
  const [stats] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT
       COUNT(*) as total,
       SUM(is_verified = 1) as verified,
       SUM(risk_score >= 60) as safe,
       SUM(risk_score >= 80) as very_safe,
       AVG(risk_score) as avg_score
     FROM token_safety`
  );
  const s = stats[0];
  console.log(`\n  ✅ Summary:`);
  console.log(`     Total tokens: ${s.total}`);
  console.log(`     Verified: ${s.verified}`);
  console.log(`     Safe (score ≥ 60): ${s.safe}`);
  console.log(`     Very safe (score ≥ 80): ${s.very_safe}`);
  console.log(`     Average risk score: ${Number(s.avg_score).toFixed(1)}`);

  await pool.end();
}

main().catch((e) => {
  console.error("❌ Failed:", e);
  process.exit(1);
});
