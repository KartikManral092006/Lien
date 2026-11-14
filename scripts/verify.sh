#!/usr/bin/env bash
# Publishes the source of every deployed contract on Sourcify (supports Base Sepolia, Unichain Sepolia
# and Reactive Lasna), so anyone can check that on-chain bytecode matches this repository.
# Reads addresses and constructor parameters from deployments.json. Each contract is verified
# independently; one failure does not stop the others.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEP="$ROOT/deployments.json"
[[ -f "$DEP" ]] || { echo "deployments.json not found. Run scripts/deploy.sh first." >&2; exit 1; }

j() { node -e "const d=require('$DEP'); const v=$1; if (v===undefined) process.exit(2); console.log(v)"; }

CH="$(j d.lasna.clearingHouse)"
VAULT="$(j d.base.vault)"
FEED="$(j d.base.feed)"
WETH="$(j d.base.weth)"
MARKET="$(j d.unichain.market)"
USDC="$(j d.unichain.usdc)"
BASE_PROXY="$(j d.base.callbackProxy)"
UNI_PROXY="$(j d.unichain.callbackProxy)"
PRICE="$(j d.params.initialPrice 2>/dev/null || echo 200000000000)"
LIQ="$(j d.params.liquidity 2>/dev/null || echo 1000000000000)"
CAP="$(j d.params.wethMintCap 2>/dev/null || echo 10000000000000000000)"

cd "$ROOT/contracts"
failed=0

verify() {
  local chain="$1" addr="$2" contract="$3" args="${4:-}"
  echo "Verifying $contract at $addr on chain $chain"
  local extra=()
  [[ -n "$args" ]] && extra=(--constructor-args "$args")
  if ! forge verify-contract "$addr" "$contract" --chain-id "$chain" --verifier sourcify --watch ${extra[@]+"${extra[@]}"}; then
    echo "  failed: $contract" >&2
    failed=$((failed + 1))
  fi
}

verify 5318007 "$CH" src/ClearingHouse.sol:ClearingHouse
verify 84532 "$WETH" src/mocks/MockToken.sol:MockToken "$(cast abi-encode 'constructor(string,string,uint8,uint256)' 'Lien Test WETH' WETH 18 "$CAP")"
verify 84532 "$FEED" src/mocks/MockPriceFeed.sol:MockPriceFeed "$(cast abi-encode 'constructor(uint256)' "$PRICE")"
verify 84532 "$VAULT" src/CollateralVault.sol:CollateralVault "$(cast abi-encode 'constructor(address,address,address)' "$BASE_PROXY" "$CH" "$WETH")"
verify 1301 "$USDC" src/mocks/MockToken.sol:MockToken "$(cast abi-encode 'constructor(string,string,uint8,uint256)' 'Lien Test USDC' USDC 6 "$LIQ")"
verify 1301 "$MARKET" src/CreditMarket.sol:CreditMarket "$(cast abi-encode 'constructor(address,address,address)' "$UNI_PROXY" "$CH" "$USDC")"

if [[ $failed -gt 0 ]]; then
  echo "$failed contract(s) failed to verify." >&2
  exit 1
fi
echo "All contracts verified on Sourcify."
