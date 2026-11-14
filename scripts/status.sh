#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a
source "$ROOT/.env"
set +a

json() { node -e "console.log(require('$ROOT/deployments.json')$1)"; }

CH="$(json .lasna.clearingHouse)"
VAULT="$(json .base.vault)"
MARKET="$(json .unichain.market)"
BASE_PROXY="$(json .base.callbackProxy)"
UNI_PROXY="$(json .unichain.callbackProxy)"
SYSTEM=0x8888888888888888888888888888888888888888

echo "ClearingHouse $CH (Lasna)"
echo "  balance:  $(cast balance --ether --rpc-url "$LASNA_RPC" "$CH") lREACT"
echo "  debt:     $(cast call --rpc-url "$LASNA_RPC" "$SYSTEM" "debt(address)(uint256)" "$CH")"
echo "  price:    $(cast call --rpc-url "$LASNA_RPC" "$CH" "price()(uint256)")"
echo "  users:    $(cast call --rpc-url "$LASNA_RPC" "$CH" "usersCount()(uint256)")"
echo "CollateralVault $VAULT (Base Sepolia)"
echo "  balance:  $(cast balance --ether --rpc-url "$BASE_RPC" "$VAULT") ETH"
echo "  debt:     $(cast call --rpc-url "$BASE_RPC" "$BASE_PROXY" "debt(address)(uint256)" "$VAULT")"
echo "CreditMarket $MARKET (Unichain Sepolia)"
echo "  balance:  $(cast balance --ether --rpc-url "$UNICHAIN_RPC" "$MARKET") ETH"
echo "  debt:     $(cast call --rpc-url "$UNICHAIN_RPC" "$UNI_PROXY" "debt(address)(uint256)" "$MARKET")"
echo
echo "Any debt above 0 pauses that contract. Top up with scripts/fund.sh"
