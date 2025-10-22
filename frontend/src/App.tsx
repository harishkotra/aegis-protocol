import { useState, useEffect, FC } from "react";
import {
  WagmiProvider,
  createConfig,
  http,
  useAccount,
  useConnect,
  useDisconnect,
  useWalletClient,
  usePublicClient,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain, type PublicClient, type WalletClient, getAddress, type Address } from "viem";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GraphQLClient, gql } from "graphql-request";
import { toMetaMaskSmartAccount, type SmartAccount, Implementation } from "@metamask/delegation-toolkit";

import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico"; // Correct import
import { pimlicoActions } from "permissionless/actions/pimlico";

// --- CONFIGURATION ---
const FACTORY_CONTRACT_ADDRESS = import.meta.env.VITE_FACTORY_CONTRACT_ADDRESS as `0x${string}`;
const INDEXER_URL = import.meta.env.VITE_INDEXER_GRAPHQL_URL;
const PIMLICO_API_KEY = import.meta.env.VITE_PIMLICO_API_KEY;

if (!PIMLICO_API_KEY) {
  throw new Error("VITE_PIMLICO_API_KEY must be set in the .env file.");
}
if (!FACTORY_CONTRACT_ADDRESS || !INDEXER_URL) {
  throw new Error("VITE_FACTORY_CONTRACT_ADDRESS and VITE_INDEXER_GRAPHQL_URL must be set in the .env file.");
}

const monadTestnet = defineChain({
    id: 10143,
    name: "Monad Testnet",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz/"] } },
    blockExplorers: { default: { name: "MonadScan", url: "https://testnet.monadscan.com" } }, 
    testnet: true
});

const BUNDLER_URL = `https://api.pimlico.io/v2/${monadTestnet.id}/rpc?apikey=${PIMLICO_API_KEY}`;

import AegisPactFactoryAbi from "./abis/AegisPactFactory.json";
import AegisPactAbi from "./abis/AegisPact.json";

const config = createConfig({ chains: [monadTestnet], transports: { [monadTestnet.id]: http() } });
const queryClient = new QueryClient();
const gqlClient = new GraphQLClient(INDEXER_URL);
type Pact = { id: `0x${string}`; beneficiary: string; lastCheckIn: string; checkInInterval: string; protectedToken: string };

function toWeiBigInt(value: any): bigint {
  if (value === undefined || value === null) return 0n;
  // plain bigint
  if (typeof value === "bigint") return value;
  // hex string like "0x..."
  if (typeof value === "string" && value.startsWith("0x")) {
    return BigInt(value);
  }
  // decimal string of digits
  if (typeof value === "string" && /^\d+$/.test(value)) {
    // if long, probably wei already
    if (value.length > 12) return BigInt(value);
    // else treat as gwei (common), convert to wei
    return BigInt(value) * 10n ** 9n;
  }
  // number
  if (typeof value === "number" && !Number.isNaN(value) && Number.isFinite(value)) {
    // if it's tiny (<1e3) it's probably gwei value like 120 -> treat as gwei
    // if it's very large (>1e12) it's probably already wei
    if (value > 1e12) return BigInt(Math.floor(value));
    return BigInt(Math.floor(value * 1e9)); // interpret number as gwei -> to wei
  }
  // last resort: try to coerce then assume wei
  try { return BigInt(value); } catch { return 0n; }
}

// --- UI Components ---
const OnboardingModal: FC<{ status: string }> = ({ status }) => ( <div className="modal-backdrop"><div className="modal-content"><h2>Creating Your Secure Aegis Vault</h2><p>This is a one-time setup. Your personal vault will act as your secure profile on Aegis.</p><div className="flow-diagram"><div className={`flow-step ${status === 'connecting' || status === 'deploying' || status === 'ready' ? 'active' : ''}`}><div className="step-icon">1</div><h4>You Connect</h4><p>Your wallet gives permission.</p></div><div className={`flow-step ${status === 'deploying' || status === 'ready' ? 'active' : ''}`}><div className="step-icon">2</div><h4>Aegis Deploys</h4><p>Your secure vault is created on-chain.</p></div><div className={`flow-step ${status === 'ready' ? 'active' : ''}`}><div className="step-icon">3</div><h4>Vault is Ready!</h4><p>You're ready to protect your assets.</p></div></div>{status !== 'ready' && <div className="spinner"></div>}<p className="status-text">{status === 'deploying' ? 'Deploying to the blockchain... (This may take a moment)' : 'Initializing...'}</p></div></div> );
const ProtectionStatus: FC<{ pacts: Pact[] }> = ({ pacts }) => { if (pacts.length === 0) { return <div className="protection-status status-neutral"><h3>Status: Unprotected</h3><p>Create your first Pact to secure your assets.</p></div> } return <div className="protection-status status-secure"><h3>Status: Protected</h3><p>Your assets are secured by {pacts.length} pact(s).</p></div> };
const Header: FC = () => ( <header><h1>Aegis Protocol</h1><p>Protecting Your Digital Legacy</p></header> );
const LandingPage: FC<{ connect: () => void }> = ({ connect }) => ( <div className="landing-page"><div className="card"><h2>Secure Your On-Chain Assets, Autonomously.</h2><p>Aegis is a decentralized inheritance protocol. It ensures your digital assets are never lost, even if you are. By creating a 'Pact', you can designate a beneficiary to receive your assets if you become inactive.</p></div><div className="card how-it-works"><h2>How It Works</h2><div className="steps"><div className="step"><h3>1. Connect Wallet</h3><p>Start by connecting your existing MetaMask wallet.</p></div><div className="step"><h3>2. Activate Your Vault</h3><p>Create a secure Aegis Vault that will own and manage your pacts on-chain.</p></div><div className="step"><h3>3. Protect Your Assets</h3><p>Use your new Vault to create pacts and perform periodic "check-ins" to stay active.</p></div></div></div><button className="connect-button-main" onClick={connect}>Connect Wallet to Get Started</button></div> );
const TimeRemaining: FC<{ pact: Pact }> = ({ pact }) => { const [timeLeft, setTimeLeft] = useState(""); useEffect(() => { const calculateTimeLeft = () => { const deadline = Number(pact.lastCheckIn) + Number(pact.checkInInterval); const remaining = deadline - Math.floor(Date.now() / 1000); if (remaining <= 0) { setTimeLeft("Expired!"); return; } const days = Math.floor(remaining / 86400), hours = Math.floor((remaining % 86400) / 3600), minutes = Math.floor((remaining % 3600) / 60); setTimeLeft(`${days}d ${hours}h ${minutes}m`); }; calculateTimeLeft(); const timer = setInterval(calculateTimeLeft, 60000); return () => clearInterval(timer); }, [pact]); return <span>{timeLeft}</span>; };

const Dashboard: FC<{ vault: SmartAccount; aaClient: SmartAccountClient }> = ({ vault, aaClient }) => { 
    const [beneficiary, setBeneficiary] = useState("");
    const [intervalDays, setIntervalDays] = useState("30");
    const [tokenAddress, setTokenAddress] = useState("0x1A801b8465d4a1C1E6f0322F24855D285585802b");
    const [userPacts, setUserPacts] = useState<Pact[]>([]);
    const [isLoadingPacts, setIsLoadingPacts] = useState(false);
    const [error, setError] = useState("");
    const [isTxPending, setIsTxPending] = useState(false);
    const [txHash, setTxHash] = useState("");

    useEffect(() => { const fetchPacts = async () => { if (!vault.address) return; setIsLoadingPacts(true); const query = gql`query GetPactsByOwner($owner: String!) { Pact(where: { owner: { _eq: $owner } }) { id, beneficiary, lastCheckIn, checkInInterval, protectedToken } }`; try { const response = await gqlClient.request(query, { owner: vault.address.toLowerCase() }); setUserPacts((response as any).Pact); } catch (e) { console.error("Failed to fetch pacts:", e); setError("Could not fetch pacts from the indexer."); } setIsLoadingPacts(false); }; fetchPacts(); }, [vault.address, txHash]);
    const handleTransaction = async (txFunction: Promise<`0x${string}`>) => { setError(""); setTxHash(""); setIsTxPending(true); try { const hash = await txFunction; setTxHash(hash); } catch (err: any) { console.error("Transaction failed:", err); setError(err.message || "Transaction failed or was rejected."); } setIsTxPending(false); };
    
    const handleCreatePact = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!aaClient) { console.error("aaClient is not available yet."); setError("Wallet client not ready. Please wait and try again."); return; }
      if (!beneficiary || !intervalDays || !tokenAddress) { setError("Please fill in all fields."); return; }
      let checksummedBeneficiary: `0x${string}`; let checksummedTokenAddress: `0x${string}`;
      try { checksummedBeneficiary = getAddress(beneficiary); checksummedTokenAddress = getAddress(tokenAddress); } catch (err) { console.error("Invalid address format:", err); setError("Invalid address format. Please check and correct the addresses."); return; }
      handleTransaction( aaClient.writeContract({ address: FACTORY_CONTRACT_ADDRESS, abi: AegisPactFactoryAbi, functionName: "createPact", args: [ checksummedBeneficiary, BigInt(Number(intervalDays) * 86400), checksummedTokenAddress, ], }) );
    };

    const handleCheckIn = async (pactAddress: `0x${string}`) => {
      if (!aaClient) { console.error("aaClient is not available yet."); setError("Wallet client not ready. Please wait and try again."); return; }
      handleTransaction( aaClient.writeContract({ address: pactAddress, abi: AegisPactAbi, functionName: "checkIn", args: [], }) );
    };

    return (
        <main>
            <div className="wallet-info success"><p>Your Secure Vault is Active: <code>{vault.address}</code></p></div>
            <ProtectionStatus pacts={userPacts} />
            <div className="dashboard-content">
                <div className="card">
                    <h2>Create a New Pact</h2>
                    <p className="card-subtitle">A Pact is an inheritance rule for a specific asset.</p>
                    <form onSubmit={handleCreatePact}>
                        <label>Beneficiary Address</label>
                        <input type="text" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="0x..." />
                        <label>Check-in Every (Days)</label>
                        <input type="number" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
                        <label>Token to Protect (Address)</label>
                        <input type="text" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} />
                        <button type="submit" disabled={isTxPending}> {isTxPending ? "Pending..." : "Create Pact"} </button>
                    </form>
                </div>
                <div className="card">
                    <h2>Your Pacts</h2>
                    {isLoadingPacts ? ( <p>Loading pacts...</p> ) : userPacts.length > 0 ? ( userPacts.map((pact) => ( <div key={pact.id} className="pact-item"> <p><strong>Pact Address:</strong> <code>{pact.id}</code></p> <p><strong>Beneficiary:</strong> <code>{pact.beneficiary}</code></p> <p><strong>Next Check-in Due:</strong> <TimeRemaining pact={pact} /></p> <button onClick={() => handleCheckIn(pact.id)} disabled={isTxPending}> {isTxPending ? "Pending..." : "Check In Now"} </button> </div> )) ) : ( <p>You haven't created any pacts yet.</p> )}
                </div>
            </div>
            {error && <p className="error-message">Error: {error}</p>}
            {txHash && <p className="success-message">Transaction sent! Hash: <code>{txHash}</code></p>}
        </main>
    );
};

const App: FC = () => {
    const { address: eoaAddress, isConnected } = useAccount();
    const { connect } = useConnect();
    const { data: walletClient } = useWalletClient();
    const publicClient = usePublicClient();
    const { disconnect } = useDisconnect();
    const [vault, setVault] = useState<SmartAccount | null>(null);
    const [aaClient, setAaClient] = useState<SmartAccountClient | null>(null);
    const [onboardingStatus, setOnboardingStatus] = useState<string | null>(null);
    const [onboardingError, setOnboardingError] = useState<string | null>(null);

    useEffect(() => {
        const createVaultAndClient = async () => {
            if (isConnected && !vault && walletClient && eoaAddress && publicClient) {
                setOnboardingStatus('deploying');
                setOnboardingError(null);
                try {
                    const newVault = await toMetaMaskSmartAccount({
                        client: publicClient as PublicClient,
                        signer: { walletClient: walletClient as WalletClient },
                        implementation: Implementation.Hybrid,
                        deployParams: [eoaAddress, [], [], []],
                        deploySalt: "0x",
                    });
                    console.log("Smart Account Created:", newVault.address);

                    // --- CORRECTED CLIENT CREATION - Ensuring EntryPoint Consistency ---
                    // Define the EntryPoint address and version explicitly based on supportedEntryPoints result
                    const ENTRYPOINT_ADDRESS_V07: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"; // Use the address confirmed by eth_supportedEntryPoints
                    const ENTRYPOINT_VERSION = "0.7";

                    // Create a dedicated Pimlico Client for interacting with the Pimlico RPC
                    // CRITICAL: Ensure the EntryPoint configuration matches the SmartAccountClient
                    const pimlicoClient = createPimlicoClient({
                        transport: http(BUNDLER_URL),
                        entryPoint: {
                            address: ENTRYPOINT_ADDRESS_V07,
                            version: ENTRYPOINT_VERSION,
                        },
                    });
                    console.log("Pimlico Client Created with EntryPoint:", ENTRYPOINT_ADDRESS_V07);

                    const smartAccountClient = createSmartAccountClient({
                      account: newVault,
                      chain: monadTestnet,
                      bundlerTransport: http(BUNDLER_URL),
                      entryPoint: {
                        address: ENTRYPOINT_ADDRESS_V07,
                        version: ENTRYPOINT_VERSION,
                      },

                      userOperation: {
                        estimateFeesPerGas: async () => {
                          try {
                            const gasPrices = await pimlicoClient.getUserOperationGasPrice();
                            console.log("pimlico gasPrices raw:", gasPrices);

                            // Prefer fast, fallback to standard/avg/raw
                            const raw = gasPrices?.fast ?? gasPrices?.standard ?? gasPrices?.avg ?? gasPrices;

                            // parse helper: converts string/number/bigint in wei or gwei -> bigint wei
                            const toWeiBigInt = (value: any): bigint => {
                              if (value === undefined || value === null) return 0n;
                              if (typeof value === "bigint") return value;
                              if (typeof value === "string" && value.startsWith("0x")) return BigInt(value);
                              if (typeof value === "string" && /^\d+$/.test(value)) {
                                // if long decimal, assume it's already wei
                                if (value.length > 12) return BigInt(value);
                                // else assume gwei
                                return BigInt(value) * 10n ** 9n;
                              }
                              if (typeof value === "number" && Number.isFinite(value)) {
                                if (value > 1e12) return BigInt(Math.floor(value)); // likely wei
                                return BigInt(Math.floor(value * 1e9)); // treat number as gwei
                              }
                              try { return BigInt(value); } catch { return 0n; }
                            };

                            let maxFeePerGas = toWeiBigInt(raw);
                            // priority fee: try explicit fields, otherwise 10% of maxFee
                            const rawPriority = gasPrices?.priority ?? gasPrices?.fastPriority ?? gasPrices?.priorityFee ?? null;
                            let maxPriorityFeePerGas = rawPriority ? toWeiBigInt(rawPriority) : (maxFeePerGas / 10n);

                            // Fallbacks if parsing failed
                            if (maxFeePerGas <= 0n) maxFeePerGas = 160n * 10n ** 9n; // 160 gwei fallback
                            if (maxPriorityFeePerGas <= 0n) maxPriorityFeePerGas = (maxFeePerGas / 10n);

                            // Safety margin to avoid rejections due to spikes (e.g., 25%)
                            const SAFETY_NUM = 125n, SAFETY_DEN = 100n;
                            maxFeePerGas = (maxFeePerGas * SAFETY_NUM) / SAFETY_DEN;
                            maxPriorityFeePerGas = (maxPriorityFeePerGas * SAFETY_NUM) / SAFETY_DEN;

                            console.log("Using fees (wei):", { maxFeePerGas: maxFeePerGas.toString(), maxPriorityFeePerGas: maxPriorityFeePerGas.toString() });
                            return { maxFeePerGas, maxPriorityFeePerGas };
                          } catch (err) {
                            console.error("Error getting Pimlico gas price, falling back to safe defaults:", err);
                            return {
                              maxFeePerGas: 200n * 10n ** 9n,       // 200 gwei
                              maxPriorityFeePerGas: 20n * 10n ** 9n // 20 gwei
                            };
                          }
                        }
                      },

                      middleware: {
                        gasPrice: async () => {
                          try {
                            const gp = await pimlicoClient.getUserOperationGasPrice();
                            const fast = gp?.fast ?? gp?.standard ?? gp?.avg ?? gp;
                            return toWeiBigInt(fast);
                          } catch {
                            return 120n * 10n ** 9n; // fallback 120 gwei
                          }
                        },
                      },
                    });
                    console.log("Smart Account Client Created with EntryPoint:", ENTRYPOINT_ADDRESS_V07);

                    // Extend the SmartAccountClient with Pimlico actions for potential future use
                    const extendedSmartAccountClient = smartAccountClient.extend(pimlicoActions);
                    console.log("Smart Account Client Extended with Pimlico");

                    setOnboardingStatus('ready');
                    setTimeout(() => {
                        setVault(newVault);
                        setAaClient(extendedSmartAccountClient);
                        setOnboardingStatus(null);
                    }, 2000);
                } catch (err: any) {
                    console.error("Failed to create vault or client:", err);
                    setOnboardingError(err.message || "An unknown error occurred during vault creation.");
                    setOnboardingStatus(null);
                }
            }
        };
        createVaultAndClient();
    }, [isConnected, walletClient, eoaAddress, publicClient]);

    useEffect(() => {
        if (!isConnected) {
            setVault(null);
            setAaClient(null);
            setOnboardingError(null);
            setOnboardingStatus(null);
        }
    }, [isConnected]);

    return (
        <div className="container">
            {onboardingStatus && <OnboardingModal status={onboardingStatus} />}
            <Header />

            {!isConnected && <LandingPage connect={() => { setOnboardingStatus('connecting'); connect({ connector: injected() }); }} />}

            {isConnected && (
                <>
                    <div className="wallet-info">
                        <p>Controller Wallet: <code>{eoaAddress}</code></p>
                        <button onClick={() => disconnect()}>Disconnect</button>
                    </div>

                    {onboardingError && (
                        <div className="card error-message">
                            <h2>Vault Creation Failed</h2>
                            <p>There was a problem creating your secure vault. Please disconnect and try again.</p>
                            <p><strong>Error:</strong> {onboardingError}</p>
                        </div>
                    )}

                    {vault && aaClient && !onboardingError && (
                        <Dashboard vault={vault} aaClient={aaClient} />
                    )}
                </>
            )}
        </div>
    );
};

const Root: FC = () => (
    <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
            <App />
        </QueryClientProvider>
    </WagmiProvider>
);

export default Root;