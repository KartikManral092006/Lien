import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { baseSepolia, unichainSepolia } from "wagmi/chains";
import { RPC } from "./chain";

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

// Browser wallets need no WalletConnect project id. Mobile/QR wallets are added only when one is configured.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Wallets",
      wallets: projectId
        ? [metaMaskWallet, rabbyWallet, coinbaseWallet, walletConnectWallet]
        : [injectedWallet, rabbyWallet, coinbaseWallet],
    },
  ],
  { appName: "Lien", projectId: projectId ?? "browser-wallets-only" },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [baseSepolia, unichainSepolia],
  transports: {
    [baseSepolia.id]: http(RPC.base),
    [unichainSepolia.id]: http(RPC.unichain),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
