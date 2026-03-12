import { getPool } from "./db";
import type { RowDataPacket } from "mysql2";
import { REPLAY_WEIGHTS } from "./constants";

interface TemplateRow extends RowDataPacket {
  id: number;
  event_type: string;
  token_symbol: string;
  token_logo_url: string;
  description_template: string;
  wallet_address: string;
  amount_usd: number;
  dex_name: string;
}

export async function replayOneEvent(): Promise<void> {
  const pool = getPool();

  // Pick a random event type by weight
  const eventType = weightedRandomType();

  // Get a random template of that type
  const [rows] = await pool.query<TemplateRow[]>(
    `SELECT * FROM event_templates WHERE event_type = ? ORDER BY RAND() LIMIT 1`,
    [eventType]
  );

  if (rows.length === 0) {
    // Fallback: try any template
    const [fallback] = await pool.query<TemplateRow[]>(
      `SELECT * FROM event_templates ORDER BY RAND() LIMIT 1`
    );
    if (fallback.length === 0) return;
    await insertMutatedEvent(fallback[0]);
    return;
  }

  await insertMutatedEvent(rows[0]);
}

async function insertMutatedEvent(template: TemplateRow): Promise<void> {
  const pool = getPool();

  // Mutate wallet: keep first 4 + last 4 chars, randomize middle
  const wallet = mutateWallet(template.wallet_address);

  // Mutate amount: ±20%
  const multiplier = 0.8 + Math.random() * 0.4;
  const amount = Math.round(template.amount_usd * multiplier * 100) / 100;

  // Rebuild description
  const description = template.description_template
    .replace("{amount}", formatAmount(amount, template.token_symbol))
    .replace("{usd}", formatUsd(amount));

  await pool.execute(
    `INSERT INTO defi_events (event_type, token_symbol, token_logo_url, description, wallet_address, amount_usd, dex_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      template.event_type,
      template.token_symbol,
      template.token_logo_url,
      description,
      wallet,
      amount,
      template.dex_name,
    ]
  );
}

function mutateWallet(original: string): string {
  if (original.length < 12) return original;
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const prefix = original.slice(0, 4);
  const suffix = original.slice(-4);
  let middle = "";
  for (let i = 0; i < 6; i++) {
    middle += chars[Math.floor(Math.random() * chars.length)];
  }
  return prefix + middle + suffix;
}

function weightedRandomType(): string {
  const entries = Object.entries(REPLAY_WEIGHTS);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let rand = Math.random() * total;

  for (const [type, weight] of entries) {
    rand -= weight;
    if (rand <= 0) return type;
  }
  return "swap";
}

function formatAmount(usd: number, symbol: string): string {
  // Convert USD to rough token amount for display
  const tokenPrices: Record<string, number> = {
    BONK: 0.00003,
    WIF: 2.5,
    JUP: 1.2,
    RAY: 5.0,
    POPCAT: 0.8,
    SOL: 150,
    PYTH: 0.4,
    JTO: 3.5,
    W: 0.3,
    RENDER: 7.0,
  };
  const price = tokenPrices[symbol] ?? 1;
  const tokenAmount = usd / price;

  if (tokenAmount >= 1_000_000) return `${(tokenAmount / 1_000_000).toFixed(1)}M`;
  if (tokenAmount >= 1_000) return `${(tokenAmount / 1_000).toFixed(1)}K`;
  return tokenAmount.toFixed(1);
}

function formatUsd(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K`;
  return amount.toFixed(0);
}
