#!/usr/bin/env bash
# Testnet only. Deploys PriceController on Base Sepolia, hands it the demo oracle, and records it in
# deployments.json, so anyone (not just the deployer) can move the test price within bounds and watch
# the shield or a liquidation settle across chains. The ClearingHouse is untouched: price events still
# come from the same feed. Costs only Base gas.
#
#   ./scripts/deploy-controller.sh            # defaults below
#   VERIFY=1 ./scripts/deploy-controller.sh   # also publish the source on Sourcify
#
# Undo at any time: cast send <controller> "returnFeed(address)" <your address> ...
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Settings given on the command line win over .env.
OVERRIDES=()
for v in VERIFY PC_MIN_PRICE PC_MAX_PRICE PC_MAX_MOVE_BPS PC_COOLDOWN PC_MOVES_PER_DAY BASE_RPC; do
  if [[ -n "${!v+x}" ]]; then OVERRIDES+=("$v=${!v}"); fi
done
set -a
source "$ROOT/.env"
set +a
for kv in ${OVERRIDES[@]+"${OVERRIDES[@]}"}; do export "$kv"; done

: "${PRIVATE_KEY:?set PRIVATE_KEY in .env}"
: "${BASE_RPC:?set BASE_RPC in .env}"

# Prices use the feed's 8 decimals. Each public move costs the ClearingHouse one reaction on Lasna
# (about 0.05 lREACT, measured on testnet), so the cooldown and daily cap bound that spend.
PC_MIN_PRICE="${PC_MIN_PRICE:-50000000000}"    # $500
PC_MAX_PRICE="${PC_MAX_PRICE:-500000000000}"   # $5,000
PC_MAX_MOVE_BPS="${PC_MAX_MOVE_BPS:-3000}"     # 30% per move
PC_COOLDOWN="${PC_COOLDOWN:-60}"               # seconds between public moves
PC_MOVES_PER_DAY="${PC_MOVES_PER_DAY:-10}"     # public moves per UTC day

DEP="$ROOT/deployments.json"
[[ -f "$DEP" ]] || { echo "deployments.json not found. Run scripts/deploy.sh first." >&2; exit 1; }
j() { node -e "const d=require('$DEP'); const v=$1; if (v===undefined) process.exit(2); console.log(v)"; }

FEED="$(j d.base.feed)"
DEFAULT_PRICE="$(j d.params.initialPrice 2>/dev/null || echo 200000000000)"
DEPLOYER="$(cast wallet address --private-key "$PRIVATE_KEY")"
OWNER="$(cast call "$FEED" 'owner()(address)' --rpc-url "$BASE_RPC")"

if [[ "$(echo "$OWNER" | tr A-F a-f)" != "$(echo "$DEPLOYER" | tr A-F a-f)" ]]; then
  echo "The feed $FEED is owned by $OWNER, not by $DEPLOYER." >&2
  echo "If that is an earlier PriceController, call its returnFeed(address) first." >&2
  exit 1
fi

cd "$ROOT/contracts"
forge build >/dev/null

echo "1/3 PriceController on Base Sepolia"
ARGS=("$FEED" "$DEFAULT_PRICE" "$PC_MIN_PRICE" "$PC_MAX_PRICE" "$PC_MAX_MOVE_BPS" "$PC_COOLDOWN" "$PC_MOVES_PER_DAY")
OUT="$(forge create --broadcast --rpc-url "$BASE_RPC" --private-key "$PRIVATE_KEY" src/mocks/PriceController.sol:PriceController --constructor-args "${ARGS[@]}")"
echo "$OUT" >&2
PC="$(echo "$OUT" | awk '/Deployed to:/ {print $3}')"
[[ -n "$PC" ]] || { echo "PriceController deployment failed" >&2; exit 1; }

echo "2/3 Handing the oracle to $PC"
cast send --rpc-url "$BASE_RPC" --private-key "$PRIVATE_KEY" "$FEED" "transferOwnership(address)" "$PC" >/dev/null
NOW_OWNER="$(cast call "$FEED" 'owner()(address)' --rpc-url "$BASE_RPC")"
[[ "$(echo "$NOW_OWNER" | tr A-F a-f)" == "$(echo "$PC" | tr A-F a-f)" ]] || { echo "Ownership transfer did not land (owner is $NOW_OWNER)" >&2; exit 1; }

echo "3/3 Recording it in deployments.json"
node -e "
const fs = require('fs');
for (const f of ['$DEP', '$ROOT/dashboard/public/deployments.json']) {
  if (!fs.existsSync(f)) continue;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  d.base.priceController = '$PC';
  d.params = { ...(d.params || {}), priceController: { minPrice: '$PC_MIN_PRICE', maxPrice: '$PC_MAX_PRICE', maxMoveBps: $PC_MAX_MOVE_BPS, cooldown: $PC_COOLDOWN, maxMovesPerDay: $PC_MOVES_PER_DAY } };
  fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n');
}"

echo
echo "Done. Anyone can now move the test price through $PC:"
echo "  at most ${PC_MAX_MOVE_BPS} bps per move, between \$$((PC_MIN_PRICE / 100000000)) and \$$((PC_MAX_PRICE / 100000000)), every ${PC_COOLDOWN} s, ${PC_MOVES_PER_DAY} moves per day."

if [[ "${VERIFY:-0}" == "1" ]]; then
  echo
  ENC="$(cast abi-encode 'constructor(address,uint256,uint256,uint256,uint256,uint256,uint256)' "${ARGS[@]}")"
  forge verify-contract "$PC" src/mocks/PriceController.sol:PriceController --chain-id 84532 --verifier sourcify --watch --constructor-args "$ENC" \
    || echo "Verification did not finish; the controller works. Re-run scripts/verify.sh later."
fi
