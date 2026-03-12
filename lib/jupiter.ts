export interface JupiterToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI: string;
  tags?: string[];
}

// Hardcoded top Solana tokens with their mint addresses
// Used as fallback when Jupiter API is unreachable
const TOP_SOLANA_TOKENS: JupiterToken[] = [
  { address: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Wrapped SOL", decimals: 9, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" },
  { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png" },
  { address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "USDT", decimals: 6, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.svg" },
  { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk", decimals: 5, logoURI: "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I" },
  { address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "WIF", name: "dogwifhat", decimals: 6, logoURI: "https://bafkreibk3covs5ltyqxa272uodhber6kc6rwrmheqx2y4jln2osv5bgkri.ipfs.nftstorage.link" },
  { address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6, logoURI: "https://static.jup.ag/jup/icon.png" },
  { address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", symbol: "RAY", name: "Raydium", decimals: 6, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png" },
  { address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", symbol: "POPCAT", name: "Popcat", decimals: 9, logoURI: "https://bafkreidvkvuzyslw5jh5z242lgpfil6h56g6bbi5fvlg4dzbkz3jigcmza.ipfs.nftstorage.link" },
  { address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", symbol: "PYTH", name: "Pyth Network", decimals: 6, logoURI: "https://pyth.network/token.svg" },
  { address: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", symbol: "ETH", name: "Ether (Wormhole)", decimals: 8, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png" },
  { address: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", symbol: "mSOL", name: "Marinade staked SOL", decimals: 9, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png" },
  { address: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", symbol: "JTO", name: "Jito", decimals: 9, logoURI: "https://metadata.jito.network/token/jto/icon.png" },
  { address: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", symbol: "jitoSOL", name: "Jito Staked SOL", decimals: 9, logoURI: "https://storage.googleapis.com/token-metadata/JitoSOL-256.png" },
  { address: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof", symbol: "RENDER", name: "Render Token", decimals: 8, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof/logo.png" },
  { address: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ", symbol: "W", name: "Wormhole", decimals: 6, logoURI: "https://wormhole.com/token.png" },
  { address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", symbol: "ORCA", name: "Orca", decimals: 6, logoURI: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png" },
  { address: "METAewgxyPbgwsseH8T16a39CQ5VyVxVi9A7vf2xFNq", symbol: "MPLX", name: "Metaplex Token", decimals: 6, logoURI: "https://arweave.net/VRKOl2-UB1DGHK3A_3tBSMOYabpMCnLmkbFMpKSOzFk" },
  { address: "TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6", symbol: "TNSR", name: "Tensor", decimals: 9, logoURI: "https://arweave.net/6oGxoHW4mPPHEK2J57jiZfqaLPBOpYMNS95Hnwf6vHY" },
  { address: "HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC", symbol: "AI16Z", name: "ai16z", decimals: 9, logoURI: "" },
  { address: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5", symbol: "MEW", name: "cat in a dogs world", decimals: 5, logoURI: "https://bafkreidlwyr565dxtao2ipsze6bmzpszqzybz7sqi2zaet5fs7k2kuntci.ipfs.nftstorage.link" },
  { address: "A8C3xuqscfmyLrte3VwZQsJz7BdkEFnRvUfuGR9KHjyX", symbol: "FARTCOIN", name: "Fartcoin", decimals: 9, logoURI: "" },
  { address: "3S8qX1MsMqRbiwKg2cQyx7nis1oHMgaCuc9c4VfvVdPN", symbol: "MOTHER", name: "MOTHER IGGY", decimals: 6, logoURI: "" },
  { address: "CLoUDKc4Ane7HeQcPpE3YHnznRxhMimJ4MyaUAH3g6Eq", symbol: "CLOUD", name: "Cloud", decimals: 9, logoURI: "" },
  { address: "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump", symbol: "PNUT", name: "Peanut the Squirrel", decimals: 6, logoURI: "" },
  { address: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82", symbol: "BOME", name: "BOOK OF MEME", decimals: 6, logoURI: "" },
  { address: "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm", symbol: "INF", name: "Infinity", decimals: 9, logoURI: "" },
  { address: "SHDWyBxihqiCj6YekG2GUr7wqKLeLAMK1gHZck9pL6y", symbol: "SHDW", name: "Shadow Token", decimals: 9, logoURI: "" },
  { address: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7d", symbol: "DRIFT", name: "Drift", decimals: 6, logoURI: "" },
  { address: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS", symbol: "KMNO", name: "Kamino", decimals: 6, logoURI: "" },
  { address: "nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7", symbol: "NOS", name: "Nosana", decimals: 6, logoURI: "" },
  { address: "BZLbGTNCSFfoth2GYDtwr7e4imWzpR5jqcUuGEwr646K", symbol: "IO", name: "io.net", decimals: 8, logoURI: "" },
];

export async function fetchTopTokens(limit = 100): Promise<JupiterToken[]> {
  // Try Jupiter API first
  try {
    console.log("  Fetching Jupiter token list...");
    const res = await fetch("https://token.jup.ag/strict", {
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const tokens: JupiterToken[] = await res.json();
      console.log(`  Got ${tokens.length} tokens from Jupiter API`);
      return tokens.slice(0, limit);
    }
  } catch {
    console.log("  Jupiter API unreachable, using hardcoded token list...");
  }

  // Fallback to hardcoded list
  console.log(`  Using ${TOP_SOLANA_TOKENS.length} hardcoded top Solana tokens`);
  return TOP_SOLANA_TOKENS.slice(0, limit);
}
