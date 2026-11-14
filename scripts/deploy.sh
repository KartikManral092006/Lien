#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a
source "$ROOT/.env"
set +a

: "${PRIVATE_KEY:?set PRIVATE_KEY in .env}"
: "${BASE_RPC:?set BASE_RPC in .env}"
: "${UNICHAIN_RPC:?set UNICHAIN_RPC in .env}"
: "${LASNA_RPC:?set LASNA_RPC in .env}"

BASE_CHAIN_ID=84532
UNICHAIN_CHAIN_ID=1301
BASE_PROXY=0x476F44b11F5C942c58f4c8E3d0300E5710743585
UNICHAIN_PROXY=0x775c9B990ADe401060B78D0e98684eEf8d2466C1

CH_FUNDING="${CH_FUNDING:-5ether}"
CALLBACK_FUNDING="${CALLBACK_FUNDING:-0.01ether}"
INITIAL_PRICE="${INITIAL_PRICE:-200000000000}"
LIQUIDITY="${LIQUIDITY:-1000000000000}"
WETH_MINT_CAP="${WETH_MINT_CAP:-10000000000000000000}"

VERIFY_FLAGS=()
if [[ "${VERIFY:-0}" == "1" ]]; then
  VERIFY_FLAGS=(--verify --verifier sourcify)
fi

create() {
  local rpc="$1"; shift
  local out
  out="$(forge create --broadcast --rpc-url "$rpc" --private-key "$PRIVATE_KEY" ${VERIFY_FLAGS[@]+"${VERIFY_FLAGS[@]}"} "$@")"
  echo "$out" >&2
  local addr
  addr="$(echo "$out" | awk '/Deployed to:/ {print $3}')"
  if [[ -z "$addr" ]]; then
    echo "deployment failed: $*" >&2
    exit 1
  fi
  echo "$addr"
}

send() {
  local rpc="$1"; shift
  cast send --rpc-url "$rpc" --private-key "$PRIVATE_KEY" "$@" >/dev/null
}

cd "$ROOT/contracts"
forge build

DEPLOYER="$(cast wallet address --private-key "$PRIVATE_KEY")"
echo "Deployer: $DEPLOYER"

echo "1/7 ClearingHouse on Lasna (funded with $CH_FUNDING lREACT)"
CH="$(create "$LASNA_RPC" src/ClearingHouse.sol:ClearingHouse --value "$CH_FUNDING")"

echo "2/7 Test WETH on Base Sepolia"
WETH="$(create "$BASE_RPC" src/mocks/MockToken.sol:MockToken --constructor-args "Lien Test WETH" "WETH" 18 "$WETH_MINT_CAP")"

echo "3/7 Price feed on Base Sepolia"
FEED="$(create "$BASE_RPC" src/mocks/MockPriceFeed.sol:MockPriceFeed --constructor-args "$INITIAL_PRICE")"

echo "4/7 CollateralVault on Base Sepolia"
VAULT="$(create "$BASE_RPC" src/CollateralVault.sol:CollateralVault --value "$CALLBACK_FUNDING" --constructor-args "$BASE_PROXY" "$CH" "$WETH")"

echo "5/7 Test USDC on Unichain Sepolia"
USDC="$(create "$UNICHAIN_RPC" src/mocks/MockToken.sol:MockToken --constructor-args "Lien Test USDC" "USDC" 6 "$LIQUIDITY")"

echo "6/7 CreditMarket on Unichain Sepolia"
MARKET="$(create "$UNICHAIN_RPC" src/CreditMarket.sol:CreditMarket --value "$CALLBACK_FUNDING" --constructor-args "$UNICHAIN_PROXY" "$CH" "$USDC")"

echo "   seeding market with liquidity"
send "$UNICHAIN_RPC" "$USDC" "mint(address,uint256)" "$DEPLOYER" "$LIQUIDITY"
send "$UNICHAIN_RPC" "$USDC" "approve(address,uint256)" "$MARKET" "$LIQUIDITY"
send "$UNICHAIN_RPC" "$MARKET" "supply(uint256)" "$LIQUIDITY"

echo "7/7 Wiring ClearingHouse subscriptions"
send "$LASNA_RPC" "$CH" "configure(uint256,address,address,uint256,address,uint256)" \
  "$BASE_CHAIN_ID" "$VAULT" "$FEED" "$UNICHAIN_CHAIN_ID" "$MARKET" "$INITIAL_PRICE"

BASE_BLOCK="$(cast block-number --rpc-url "$BASE_RPC")"
UNICHAIN_BLOCK="$(cast block-number --rpc-url "$UNICHAIN_RPC")"
LASNA_BLOCK="$(cast block-number --rpc-url "$LASNA_RPC")"

JSON="$(cat <<JSON
{
  "deployer": "$DEPLOYER",
  "lasna": { "chainId": 5318007, "clearingHouse": "$CH", "fromBlock": $LASNA_BLOCK },
  "base": { "chainId": $BASE_CHAIN_ID, "vault": "$VAULT", "feed": "$FEED", "weth": "$WETH", "callbackProxy": "$BASE_PROXY", "fromBlock": $BASE_BLOCK },
  "unichain": { "chainId": $UNICHAIN_CHAIN_ID, "market": "$MARKET", "usdc": "$USDC", "callbackProxy": "$UNICHAIN_PROXY", "fromBlock": $UNICHAIN_BLOCK }
}
JSON
)"
echo "$JSON" > "$ROOT/deployments.json"
mkdir -p "$ROOT/dashboard/public"
echo "$JSON" > "$ROOT/dashboard/public/deployments.json"

echo
echo "Done. Addresses written to deployments.json"
echo "$JSON"
