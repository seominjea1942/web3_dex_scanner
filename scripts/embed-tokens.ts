#!/usr/bin/env npx tsx
/**
 * Batch-embed all tokens in the `tokens` table using OpenAI text-embedding-3-small.
 *
 * Usage:
 *   npx tsx scripts/embed-tokens.ts
 *
 * Requires: OPENAI_API_KEY + TiDB env vars in .env.local
 */
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
import mysql from "mysql2/promise";
import OpenAI from "openai";

const BATCH_SIZE = 100;
const MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;

async function main() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const sslEnabled =
    (process.env.TIDB_SSL ?? "true").trim().toLowerCase() !== "false";

  const pool = mysql.createPool({
    host: process.env.TIDB_HOST,
    port: Number(process.env.TIDB_PORT || 4000),
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD || "",
    database: process.env.TIDB_DATABASE || "chainscope",
    ssl: sslEnabled
      ? { minVersion: "TLSv1.2" as const, rejectUnauthorized: true }
      : undefined,
  });

  // Fetch all tokens without embeddings
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT address, name, symbol FROM tokens WHERE embedding IS NULL"
  );

  console.log(`Found ${rows.length} tokens without embeddings.`);
  if (rows.length === 0) {
    console.log("Nothing to do.");
    await pool.end();
    return;
  }

  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const inputs = batch.map(
      (r) => `${r.symbol || ""} ${r.name || ""}`.trim() || r.address
    );

    console.log(
      `Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)} (${batch.length} tokens)...`
    );

    const response = await openai.embeddings.create({
      model: MODEL,
      input: inputs,
      dimensions: DIMENSIONS,
    });

    // Update each token with its embedding
    for (let j = 0; j < batch.length; j++) {
      const embedding = response.data[j].embedding;
      const vecString = `[${embedding.join(",")}]`;
      await pool.query(
        "UPDATE tokens SET embedding = ? WHERE address = ?",
        [vecString, batch[j].address]
      );
    }

    total += batch.length;
    console.log(`  Done. ${total}/${rows.length} embedded.`);
  }

  // Verify
  const [countRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) as cnt FROM tokens WHERE embedding IS NOT NULL"
  );
  console.log(`\nVerification: ${countRows[0].cnt} tokens have embeddings.`);

  await pool.end();
  console.log("Done!");
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
