#!/usr/bin/env bash
# Testnet only. Returns the gas balance of retired Lien contracts (and the self-callback probe) to the
# deployer, so a redeploy can reuse it. Only the owner can do this; contracts left empty stop reacting
# and stop receiving callbacks, so pass only contracts you are retiring.
#
#   ./scripts/recover-funds.sh lasna:0xCH... base:0xVault... unichain:0xMarket...
#
# lasna: ClearingHouse (withdrawFunds) or SelfCallbackProbe (withdraw). base/unichain: vault or market
# (withdrawGas). Settings given on the command line (e.g. BASE_RPC=...) win over .env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OVERRIDES=()
for v in BASE_RPC UNICHAIN_RPC LASNA_RPC; do
  if [[ -n "${!v+x}" ]]; then OVERRIDES+=("$v=${!v}"); fi
done
set -a
source "$ROOT/.env"
set +a
for kv in ${OVERRIDES[@]+"${OVERRIDES[@]}"}; do export "$kv"; done

[[ $# -gt 0 ]] || { echo "usage: $0 <lasna|base|unichain>:<address> ..." >&2; exit 1; }
ME="$(cast wallet address --private-key "$PRIVATE_KEY")"

for arg in "$@"; do
  chain="${arg%%:*}"; addr="${arg#*:}"
  case "$chain" in
    lasna) rpc="$LASNA_RPC"; unit="lREACT" ;;
    base) rpc="$BASE_RPC"; unit="ETH" ;;
    unichain) rpc="$UNICHAIN_RPC"; unit="ETH" ;;
    *) echo "unknown chain '$chain' in $arg" >&2; exit 1 ;;
  esac
  owner="$(cast call "$addr" 'owner()(address)' --rpc-url "$rpc")"
  if [[ "$(echo "$owner" | tr 'A-F' 'a-f')" != "$(echo "$ME" | tr 'A-F' 'a-f')" ]]; then echo "skip $arg: owned by $owner, not $ME"; continue; fi
  bal="$(cast balance "$addr" --rpc-url "$rpc")"
  if [[ "$bal" == "0" ]]; then echo "skip $arg: empty"; continue; fi
  if [[ "$chain" == "lasna" ]]; then
    if cast call "$addr" 'rounds()(uint256)' --rpc-url "$rpc" >/dev/null 2>&1; then
      sig=("withdraw()")
    else
      sig=("withdrawFunds(address,uint256)" "$ME" "$bal")
    fi
  else
    sig=("withdrawGas(address,uint256)" "$ME" "$bal")
  fi
  printf "%-9s %s  %s %s -> " "$chain" "$addr" "$(cast from-wei "$bal")" "$unit"
  cast send --rpc-url "$rpc" --private-key "$PRIVATE_KEY" "$addr" "${sig[@]}" --json \
    | python3 -c "import json,sys;r=json.load(sys.stdin);print('status', int(r['status'],16), r['transactionHash'])"
done

echo
echo "Deployer now: Lasna $(cast balance --ether "$ME" --rpc-url "$LASNA_RPC") lREACT," \
  "Base $(cast balance --ether "$ME" --rpc-url "$BASE_RPC") ETH, Unichain $(cast balance --ether "$ME" --rpc-url "$UNICHAIN_RPC") ETH"
