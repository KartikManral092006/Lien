#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a
source "$ROOT/.env"
set +a

json() { node -e "console.log(require('$ROOT/deployments.json')$1)"; }

TARGET="${1:?usage: fund.sh <clearinghouse|vault|market> <amount e.g. 1ether>}"
AMOUNT="${2:?usage: fund.sh <clearinghouse|vault|market> <amount e.g. 1ether>}"
SYSTEM=0x8888888888888888888888888888888888888888

case "$TARGET" in
  clearinghouse)
    cast send --rpc-url "$LASNA_RPC" --private-key "$PRIVATE_KEY" "$SYSTEM" "depositTo(address)" "$(json .lasna.clearingHouse)" --value "$AMOUNT" ;;
  vault)
    cast send --rpc-url "$BASE_RPC" --private-key "$PRIVATE_KEY" "$(json .base.callbackProxy)" "depositTo(address)" "$(json .base.vault)" --value "$AMOUNT" ;;
  market)
    cast send --rpc-url "$UNICHAIN_RPC" --private-key "$PRIVATE_KEY" "$(json .unichain.callbackProxy)" "depositTo(address)" "$(json .unichain.market)" --value "$AMOUNT" ;;
  *)
    echo "unknown target $TARGET" >&2; exit 1 ;;
esac
echo "funded $TARGET with $AMOUNT"
