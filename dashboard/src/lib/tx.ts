import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { maxUint256, type Abi, type Address, type Hex } from "viem";
import { useAccount, useSwitchChain } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { chains, explainError, explorer, pub, short, tokenAbi, CHAIN_META, type Deployments, type TxChain } from "./chain";
import { snapshotHeads, trackLoop } from "./loop";
import { wagmiConfig } from "./wallet";

export type Step = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] };

/**
 * Runs one user action: switches network, simulates each step before the wallet opens (so reverts are
 * explained up front), sends, waits for the receipt, and optionally follows the cross-chain loop.
 */
export function useTx(d: Deployments | undefined) {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  // The label of the action that just confirmed, for about two seconds, so its button can show a check.
  const [done, setDone] = useState<string | null>(null);

  async function approvalFor(chain: TxChain, token: Address, spender: Address, amount: bigint): Promise<Step[]> {
    if (!address) return [];
    const allowance = (await pub[chain].readContract({ address: token, abi: tokenAbi, functionName: "allowance", args: [address, spender] })) as bigint;
    return allowance >= amount ? [] : [{ address: token, abi: tokenAbi as Abi, functionName: "approve", args: [spender, maxUint256] }];
  }

  async function run(label: string, chain: TxChain, steps: Step[] | (() => Promise<Step[]>), opts: { track?: boolean; done?: string } = {}) {
    if (!d) return;
    if (!address) {
      openConnectModal?.();
      return;
    }
    const target = chains[chain];
    const id = toast.loading(`${label}: preparing`, { description: CHAIN_META[chain].name });
    setBusy(label);
    try {
      if (chainId !== target.id) {
        toast.loading(`${label}: switch to ${CHAIN_META[chain].name} in your wallet`, { id });
        await switchChainAsync({ chainId: target.id });
      }
      const wallet = await getWalletClient(wagmiConfig, { chainId: target.id });
      // The wallet may have switched to an account this site was never given; say so before it refuses to sign.
      const offered = await wallet.getAddresses();
      if (!offered.some((a) => a.toLowerCase() === address.toLowerCase())) {
        throw new Error(
          offered.length === 0
            ? "Your wallet is not sharing any account with this site. Use the account button at the top right to disconnect, then connect again."
            : `This page is connected as ${short(address)}, but your wallet is offering ${short(offered[0])}. Disconnect at the top right and connect again with the account you want to use.`,
        );
      }
      const list = typeof steps === "function" ? await steps() : steps;
      const heads = opts.track ? await snapshotHeads() : undefined;
      const startedAt = Date.now();
      let last: Hex | undefined;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        // Simulating first surfaces the contract's own error before the wallet asks for a signature.
        const { request } = await pub[chain].simulateContract({ ...s, account: address } as any);
        toast.loading(list.length > 1 ? `${label}: confirm step ${i + 1} of ${list.length} in your wallet` : `${label}: confirm in your wallet`, { id });
        const hash = await wallet.writeContract({ ...(request as any), account: address, chain: target });
        toast.loading(`${label}: waiting for ${CHAIN_META[chain].name}`, {
          id,
          action: { label: "View", onClick: () => window.open(explorer.tx[chain] + hash, "_blank", "noopener") },
        });
        const receipt = await pub[chain].waitForTransactionReceipt({ hash, pollingInterval: 500, retryCount: 10 });
        if (receipt.status !== "success") throw new Error(`The transaction reverted on ${CHAIN_META[chain].name}.`);
        last = hash;
      }
      setDone(label);
      setTimeout(() => setDone((cur) => (cur === label ? null : cur)), 2200);
      toast.success(opts.done ?? `${label} confirmed`, {
        id,
        description: opts.track ? "Settling across chains. Watch the loop below." : CHAIN_META[chain].name,
        action: last ? { label: "View", onClick: () => window.open(explorer.tx[chain] + last, "_blank", "noopener") } : undefined,
      });
      if (opts.track && last && heads) trackLoop(d, label, { chain, tx: last, user: address }, heads, startedAt);
      qc.invalidateQueries({ queryKey: ["position"] });
    } catch (e) {
      const { message, cancelled } = explainError(e);
      if (cancelled) toast.info(`${label} cancelled`, { id, description: message });
      else toast.error(`${label} failed`, { id, description: message });
    } finally {
      setBusy(null);
    }
  }

  return { run, approvalFor, busy, done, address };
}
