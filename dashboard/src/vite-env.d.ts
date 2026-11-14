/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASE_RPC?: string;
  readonly VITE_UNICHAIN_RPC?: string;
  readonly VITE_LASNA_RPC?: string;
  /** Optional. Enables WalletConnect (mobile wallets, QR). Browser wallets work without it. */
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}
