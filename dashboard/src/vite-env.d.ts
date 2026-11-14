/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BASE_RPC?: string;
  readonly VITE_UNICHAIN_RPC?: string;
  readonly VITE_LASNA_RPC?: string;
}

interface Window {
  ethereum?: import("viem").EIP1193Provider;
}
