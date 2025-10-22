import { useState, useEffect, FC, PropsWithChildren } from "react";
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
import { defineChain, type WalletClient } from "viem";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GraphQLClient, gql } from "graphql-request";

import {
  toMetaMaskSmartAccount,
  type SmartAccount,
  Implementation,
} from "@metamask/delegation-toolkit";

const FACTORY_CONTRACT_ADDRESS = import.meta.env.VITE_FACTORY_CONTRACT_ADDRESS as `0x${string}`;
const INDEXER_URL = import.meta.env.VITE_INDEXER_GRAPHQL_URL;

if (!FACTORY_CONTRACT_ADDRESS || !INDEXER_URL) {
  throw new Error("VITE_FACTORY_CONTRACT_ADDRESS and VITE_INDEXER_GRAPHQL_URL must be set in the .env file.");
}

import AegisPactFactoryAbi from "./abis/AegisPactFactory.json";
import AegisPactAbi from "./abis/AegisPact.json";

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz/"] } },
  blockExplorers: { default: { name: "MonadScan", url: "https://testnet.monadscan.com" } },
  testnet: true,
});

// --- END CONFIGURATION ---

const config = createConfig({ chains: [monadTestnet], transports: { [monadTestnet.id]: http() } });
const queryClient = new QueryClient();
const gqlClient = new GraphQLClient(INDEXER_URL);

type Pact = { id: `0x${string}`; beneficiary: string; lastCheckIn: string; checkInInterval: string; protectedToken: string };

// --- UI Components ---

const Header: FC = () => (
  <header>
    <h1>Aegis Protocol</h1>
    <p>Protecting Your Digital Legacy</p>
  </header>
);

const LandingPage: FC = () => {
  const { connect } = useConnect();
  return (
    <div className="landing-page">
      <div className="card">
        <h2>Secure Your On-Chain Assets, Autonomously.</h2>
        <p>Aegis is a decentralized inheritance protocol. It ensures your digital assets are never lost, even if you are. By creating a 'Pact', you can designate a beneficiary to receive your assets if you become inactive.</p>
      </div>
      <div className="card how-it-works">
        <h2>How It Works</h2>
        <div className="steps">
          <div className="step"><h3>1. Connect Wallet</h3><p>Start by connecting your existing MetaMask wallet (your EOA).</p></div>
          <div className="step"><h3>2. Activate Smart Account</h3><p>Create a secure MetaMask Smart Account that will own and manage your pacts on-chain.</p></div>
          <div className="step"><h3>3. Create & Manage Pacts</h3><p>Use your new Smart Account to create pacts, deposit assets, and perform periodic "check-ins" to stay active.</p></div>
        </div>
      </div>
      <button className="connect-button-main" onClick={() => connect({ connector: injected() })}>Connect Wallet to Get Started</button>
    </div>
  );
};

const TimeRemaining: FC<{ pact: Pact }> = ({ pact }) => {
    const [timeLeft, setTimeLeft] = useState("");
    useEffect(() => {
      const calculateTimeLeft = () => {
        const deadline = Number(pact.lastCheckIn) + Number(pact.checkInInterval);
        const remaining = deadline - Math.floor(Date.now() / 1000);
        if (remaining <= 0) { setTimeLeft("Expired!"); return; }
        const days = Math.floor(remaining / 86400), hours = Math.floor((remaining % 86400) / 3600), minutes = Math.floor((remaining % 3600) / 60);
        setTimeLeft(`${days}d ${hours}h ${minutes}m`);
      };
      calculateTimeLeft();
      const timer = setInterval(calculateTimeLeft, 60000);
      return () => clearInterval(timer);
    }, [pact]);
    return <span>{timeLeft}</span>;
};

const Dashboard: FC<{ smartAccount: SmartAccount }> = ({ smartAccount }) => {
  const [beneficiary, setBeneficiary] = useState("");
  const [intervalDays, setIntervalDays] = useState("30");
  const [tokenAddress, setTokenAddress] = useState("0x1A801b8465d4a1C1E6f0322F24855D285585802b");
  const [userPacts, setUserPacts] = useState<Pact[]>([]);
  const [isLoadingPacts, setIsLoadingPacts] = useState(false);
  const [error, setError] = useState("");
  const [isTxPending, setIsTxPending] = useState(false);
  const [txHash, setTxHash] = useState("");

  useEffect(() => {
    const fetchPacts = async () => {
      if (!smartAccount.address) return;
      setIsLoadingPacts(true);
      const query = gql`
        query GetPactsByOwner($owner: String!) { Pact(where: { owner: { _eq: $owner } }) { id, beneficiary, lastCheckIn, checkInInterval, protectedToken } }
      `;
      try {
        const response = await gqlClient.request(query, { owner: smartAccount.address.toLowerCase() });
        setUserPacts((response as any).Pact);
      } catch (e) { console.error("Failed to fetch pacts:", e); setError("Could not fetch pacts from the indexer."); }
      setIsLoadingPacts(false);
    };
    fetchPacts();
  }, [smartAccount.address, txHash]);

  const handleTransaction = async (txFunction: Promise<any>) => {
    setError("");
    setTxHash("");
    setIsTxPending(true);
    try {
      const hash = await txFunction;
      setTxHash(hash);
    } catch (err: any) {
      console.error("Transaction failed:", err);
      setError(err.message || "Transaction failed or was rejected.");
    }
    setIsTxPending(false);
  };
  
  const handleCreatePact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!beneficiary || !intervalDays || !tokenAddress) { setError("Please fill in all fields."); return; }
    handleTransaction(smartAccount.writeContract({
      address: FACTORY_CONTRACT_ADDRESS,
      abi: AegisPactFactoryAbi,
      functionName: "createPact",
      args: [beneficiary, BigInt(Number(intervalDays) * 86400), tokenAddress],
    }));
  };

  const handleCheckIn = (pactAddress: `0x${string}`) => {
    handleTransaction(smartAccount.writeContract({
      address: pactAddress,
      abi: AegisPactAbi,
      functionName: "checkIn",
      args: [],
    }));
  };

  return (
    <main>
      <div className="dashboard-intro">
        <h2>Welcome to Your Aegis Dashboard</h2>
        <p>Your Smart Account is now active. Use it to create and manage your Pacts below.</p>
      </div>
      <div className="dashboard-content">
        <div className="card">
          <h2>Create a New Pact</h2>
          <form onSubmit={handleCreatePact}>
            <label>Beneficiary Address</label>
            <input type="text" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="0x..." />
            <label>Check-in Every (Days)</label>
            <input type="number" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
            <label>Token to Protect (Address)</label>
            <input type="text" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} />
            <button type="submit" disabled={isTxPending}>{isTxPending ? "Pending..." : "Create Pact"}</button>
          </form>
        </div>
        <div className="card">
          <h2>Your Pacts</h2>
          {isLoadingPacts ? <p>Loading pacts...</p> : userPacts.length > 0 ? (
            userPacts.map((pact) => (
              <div key={pact.id} className="pact-item">
                <p><strong>Pact Address:</strong> <code>{pact.id}</code></p>
                <p><strong>Beneficiary:</strong> <code>{pact.beneficiary}</code></p>
                <p><strong>Next Check-in Due:</strong> <TimeRemaining pact={pact} /></p>
                <button onClick={() => handleCheckIn(pact.id)} disabled={isTxPending}>{isTxPending ? "Pending..." : "Check In Now"}</button>
              </div>
            ))
          ) : (
            <p>You haven't created any pacts yet.</p>
          )}
        </div>
      </div>
      {error && <p className="error-message">Error: {error}</p>}
      {txHash && <p className="success-message">Transaction sent! Hash: {txHash}</p>}
    </main>
  );
};

const App: FC = () => {
  const { address: eoaAddress, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient(); // <-- 2. GET THE PUBLIC CLIENT
  const { disconnect } = useDisconnect();

  const [smartAccount, setSmartAccount] = useState<SmartAccount | null>(null);
  const [isCreatingSmartAccount, setIsCreatingSmartAccount] = useState(false);

  useEffect(() => {
    if (!isConnected) setSmartAccount(null);
  }, [isConnected]);

  const createSmartAccount = async () => {
    // 3. ADD publicClient TO THE GUARD CLAUSE
    if (!walletClient || !eoaAddress || !publicClient) return;
    setIsCreatingSmartAccount(true);
    try {
      // 4. CORRECT THE PARAMETER STRUCTURE
      const newSmartAccount = await toMetaMaskSmartAccount({
        client: publicClient as PublicClient, // Pass the PublicClient here
        signer: { walletClient: walletClient as WalletClient }, // Pass the WalletClient nested in the signer object
        implementation: Implementation.Hybrid,
        deployParams: [eoaAddress, [], [], []],
        deploySalt: "0x",
      });
      setSmartAccount(newSmartAccount);
    } catch (err) {
      console.error("Failed to create smart account:", err);
    }
    setIsCreatingSmartAccount(false);
  };

  return (
    <div className="container">
      <Header />
      {!isConnected ? (
        <LandingPage />
      ) : (
        <>
          <div className="wallet-info">
            <p>EOA Connected: <code>{eoaAddress}</code></p>
            <button onClick={() => disconnect()}>Disconnect</button>
          </div>
          {!smartAccount ? (
            <div className="card">
              <h2>Step 2: Activate Your Smart Account</h2>
              <p>Aegis uses MetaMask Smart Accounts to manage your pacts. This allows for more secure and flexible interactions. Click below to create and load your personal Smart Account.</p>
              <button onClick={createSmartAccount} disabled={isCreatingSmartAccount}>
                {isCreatingSmartAccount ? "Creating..." : "Activate Smart Account"}
              </button>
            </div>
          ) : (
            <>
              <div className="wallet-info success">
                <p>Smart Account Active: <code>{smartAccount.address}</code></p>
              </div>
              <Dashboard smartAccount={smartAccount} />
            </>
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