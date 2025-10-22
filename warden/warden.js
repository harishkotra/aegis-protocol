import { createWalletClient, http, publicActions, parseAbiItem, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GraphQLClient, gql } from "graphql-request";
import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// --- CONFIGURATION ---
const rawWardenPrivateKey = process.env.WARDEN_PRIVATE_KEY;
const rpcUrl = process.env.MONAD_RPC_URL;
const indexerUrl = process.env.INDEXER_GRAPHQL_URL;

// Check for missing environment variables
if (!rawWardenPrivateKey || !rpcUrl || !indexerUrl) {
  throw new Error(
    "Missing required environment variables. Please check your .env file."
  );
}

// --- VIEM CLIENT SETUP ---

const wardenPrivateKey = rawWardenPrivateKey.startsWith('0x') 
  ? rawWardenPrivateKey 
  : `0x${rawWardenPrivateKey}`;

// ADDED: Define the Monad Testnet chain manually for viem
const monadTestnet = defineChain({
    id: 10143, // The Chain ID from your working Envio config
    name: 'Monad Testnet',
    nativeCurrency: {
      name: 'Monad',
      symbol: 'MON',
      decimals: 18,
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] },
    },
    blockExplorers: {
      default: { name: 'MonadScan', url: 'https://testnet.monadscan.com/' },
    },
    testnet: true,
});

// Create a wallet account object from the private key
const wardenAccount = privateKeyToAccount(wardenPrivateKey);

// Create a Wallet Client to send transactions
const walletClient = createWalletClient({
  account: wardenAccount,
  chain: monadTestnet, // Use our custom chain definition
  transport: http(), // Viem will use the RPC from the chain definition
}).extend(publicActions);

console.log(`Warden service initialized. Warden address: ${wardenAccount.address}`);

// --- GRAPHQL CLIENT SETUP ---
const gqlClient = new GraphQLClient(indexerUrl);

// The query to fetch all active pacts from our indexer
const GET_ALL_PACTS = gql`
  query GetAllPacts {
    Pact(order_by: { createdAt: asc }) {
      id # This is the pact's contract address
      lastCheckIn
      checkInInterval
    }
  }
`;

// The ABI for the `recoverAssets` function we need to call
const PACT_ABI = [parseAbiItem("function recoverAssets() external")];

// --- CORE WARDEN LOGIC ---

async function scanAndExecutePacts() {
  console.log("\nScanning for expired pacts...");

  try {
    // 1. Fetch all pacts from the indexer
    const response = await gqlClient.request(GET_ALL_PACTS);
    const pacts = response.Pact;

    if (!pacts || pacts.length === 0) {
      console.log("No active pacts found. Standing by.");
      return;
    }

    console.log(`Found ${pacts.length} pact(s) to evaluate.`);

    // 2. Determine the current time (in seconds)
    const now = Math.floor(Date.now() / 1000);

    // 3. Filter for pacts that are expired
    const expiredPacts = pacts.filter((pact) => {
      // The pact's data from GraphQL are strings, so we convert them to numbers
      const lastCheckIn = Number(pact.lastCheckIn);
      // It's possible checkInInterval is null if the indexer hasn't populated it yet, handle this case.
      const checkInInterval = Number(pact.checkInInterval);

      if (!checkInInterval) return false;

      // The condition for expiry
      return lastCheckIn + checkInInterval < now;
    });

    if (expiredPacts.length === 0) {
      console.log("All pacts are up to date.");
      return;
    }

    console.log(`Found ${expiredPacts.length} expired pact(s). Preparing to execute recovery...`);

    // 4. Execute the `recoverAssets` transaction for each expired pact
    for (const pact of expiredPacts) {
      console.log(`- Executing recovery for pact: ${pact.id}`);
      try {
        const { request } = await walletClient.simulateContract({
            address: pact.id,
            abi: PACT_ABI,
            functionName: 'recoverAssets',
            account: wardenAccount
        });

        const txHash = await walletClient.writeContract(request);

        console.log(`  - Transaction sent! Hash: ${txHash}`);
        console.log(`  - Waiting for transaction receipt...`);
        const receipt = await walletClient.waitForTransactionReceipt({ hash: txHash });

        if (receipt.status === 'success') {
          console.log(`  - ✅ Recovery successful for pact ${pact.id}!`);
        } else {
          console.error(`  - ❌ Transaction failed for pact ${pact.id}. Receipt:`, receipt);
        }

      } catch (error) {
        console.error(`  - ❌ Error executing recovery for pact ${pact.id}:`, error.message);
      }
    }
  } catch (error) {
    console.error("Failed to scan for pacts:", error.message);
  }
}

// --- JOB SCHEDULER ---
const SCAN_INTERVAL_MS = 60 * 1000;

console.log(`Starting scheduler. Will scan every ${SCAN_INTERVAL_MS / 1000} seconds.`);
scanAndExecutePacts();
setInterval(scanAndExecutePacts, SCAN_INTERVAL_MS);