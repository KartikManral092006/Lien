#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a
source "$ROOT/.env"
set +a

AMOUNT="${1:?usage: faucet.sh <amount of Sepolia ETH, e.g. 0.5ether> [sepolia|base]}"
SOURCE="${2:-sepolia}"
WALLET="$(cast wallet address --private-key "$PRIVATE_KEY")"

case "$SOURCE" in
  sepolia) RPC="${SEPOLIA_RPC:?set SEPOLIA_RPC}"; FAUCET=0x9b9BB25f1A81078C544C829c5EB7822d747Cf434 ;;
  base)    RPC="$BASE_RPC"; FAUCET=0x2afaFD298b23b62760711756088F75B7409f5967 ;;
  *) echo "source must be sepolia or base" >&2; exit 1 ;;
esac

echo "Sending $AMOUNT to the Reactive faucet on $SOURCE for $WALLET (1 ETH = 100 lREACT, max 5 ETH per tx)"
cast send --rpc-url "$RPC" --private-key "$PRIVATE_KEY" "$FAUCET" "request(address)" "$WALLET" --value "$AMOUNT"
