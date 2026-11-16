#!/usr/bin/env bash
# Testnet diagnostic. Checks whether Lasna delivers callbacks a reactive contract sends to itself, and whether
# the requested gas limit matters (ClearingHouse's batched re-pricing depends on it). See
# contracts/src/probes/SelfCallbackProbe.sol.
#
#   ./scripts/probe-selfcallback.sh                 # deploy (funded with PROBE_FUNDING), trigger once, watch
#   ./scripts/probe-selfcallback.sh trigger <probe> # trigger again and watch
#   ./scripts/probe-selfcallback.sh watch <probe>   # only report what has arrived so far
#   ./scripts/probe-selfcallback.sh withdraw <probe># return the probe's remaining lREACT to the deployer
#
# Costs: probe deployment on Lasna, PROBE_FUNDING lREACT (default 1, recoverable with withdraw), one WETH mint
# on Base. Settings given on the command line (e.g. BASE_RPC=...) win over .env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI_BASE_RPC="${BASE_RPC:-}"
CLI_FUNDING="${PROBE_FUNDING:-}"
set -a
source "$ROOT/.env"
set +a
[[ -n "$CLI_BASE_RPC" ]] && BASE_RPC="$CLI_BASE_RPC"
PROBE_FUNDING="${CLI_FUNDING:-1ether}"

WETH="$(python3 -c "import json;print(json.load(open('$ROOT/deployments.json'))['base']['weth'])")"
BASE_CHAIN_ID=84532
WATCH_SECONDS="${WATCH_SECONDS:-180}"

send() {
  local rpc="$1"; shift
  cast send --rpc-url "$rpc" --private-key "$PRIVATE_KEY" "$@" --json | python3 -c "import json,sys;r=json.load(sys.stdin);print(r['transactionHash'], 'status', int(r['status'],16))"
}

report() {
  local probe="$1" from="$2"
  echo
  echo "Probe events on Lasna since block $from:"
  cast logs --rpc-url "$LASNA_RPC" --from-block "$from" --address "$probe" --json | node -e '
    const logs = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const sig = (s) => require("child_process").execSync(`cast keccak "${s}"`).toString().trim();
    const T = { [sig("Requested(uint256,uint256)")]: "Requested", [sig("Pinged(uint256,uint256,address,address,uint256)")]: "Pinged",
                [sig("Chained(uint256,bool,bytes)")]: "Chained" };
    const w = (d, i) => BigInt("0x" + d.slice(2 + 64 * i, 66 + 64 * i));
    const a = (d, i) => "0x" + d.slice(2 + 64 * i + 24, 66 + 64 * i);
    const asked = new Set(), got = new Set();
    for (const l of logs) {
      const name = T[l.topics[0]], round = BigInt(l.topics[1] ?? 0), blk = parseInt(l.blockNumber, 16), d = l.data;
      if (name === "Requested") { asked.add(`${round}:${w(d,0)}`); console.log(`  block ${blk}  round ${round}  requested ${w(d,0)} gas`); }
      else if (name === "Pinged") { got.add(`${round}:${w(d,0)}`); console.log(`  block ${blk}  round ${round}  DELIVERED ${w(d,0)} gas  caller ${a(d,1)}  injected ${a(d,2)}  gasleft ${w(d,3)}  tx ${l.transactionHash}`); }
      else if (name === "Chained") console.log(`  block ${blk}  round ${round}  request from a non-react tx: ${w(d,0) ? "accepted" : "REVERTED (" + d.slice(2 + 64 * 3, 2 + 64 * 3 + 8 + 0) + "…)"}`);
    }
    const missing = [...asked].filter((k) => !got.has(k));
    console.log(`\n  ${got.size} delivered, ${missing.length} of ${asked.size} requested not delivered${missing.length ? ": " + missing.map((k) => k.split(":")[1] + " gas").join(", ") : ""}`);
  '
}

trigger_and_watch() {
  local probe="$1"
  local from
  from="$(cast block-number --rpc-url "$LASNA_RPC")"
  echo "Triggering: mint 1 wei test WETH to the probe on Base"
  send "$BASE_RPC" "$WETH" "mint(address,uint256)" "$probe" 1
  echo "Watching Lasna for ${WATCH_SECONDS}s…"
  local end=$((SECONDS + WATCH_SECONDS))
  while (( SECONDS < end )); do
    local n
    n="$(cast logs --rpc-url "$LASNA_RPC" --from-block "$from" --address "$probe" --json | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")"
    printf "\r  %3ds  %s probe events" "$((end - SECONDS))" "$n"
    sleep 10
  done
  echo
  report "$probe" "$from"
}

case "${1:-deploy}" in
  deploy)
    cd "$ROOT/contracts"
    forge build >/dev/null
    from="$(cast block-number --rpc-url "$LASNA_RPC")"
    out="$(forge create --broadcast --rpc-url "$LASNA_RPC" --private-key "$PRIVATE_KEY" \
      src/probes/SelfCallbackProbe.sol:SelfCallbackProbe --value "$PROBE_FUNDING")"
    PROBE="$(echo "$out" | awk '/Deployed to:/ {print $3}')"
    [[ -n "$PROBE" ]] || { echo "$out" >&2; echo "probe deployment failed" >&2; exit 1; }
    echo "Probe: $PROBE (funded with $PROBE_FUNDING lREACT)"
    echo "Subscribing to test WETH mints to the probe on Base"
    send "$LASNA_RPC" "$PROBE" "start(uint256,address)" "$BASE_CHAIN_ID" "$WETH"
    echo "Asking whether requestCallback works outside react()"
    send "$LASNA_RPC" "$PROBE" "poke()"
    report "$PROBE" "$from"
    trigger_and_watch "$PROBE"
    echo
    echo "Re-run later:  ./scripts/probe-selfcallback.sh watch $PROBE"
    echo "Recover funds: ./scripts/probe-selfcallback.sh withdraw $PROBE"
    ;;
  trigger) trigger_and_watch "${2:?probe address}" ;;
  watch) report "${2:?probe address}" "${3:-$(( $(cast block-number --rpc-url "$LASNA_RPC") - 5000 ))}" ;;
  withdraw)
    echo "Probe balance: $(cast balance --ether "$2" --rpc-url "$LASNA_RPC") lREACT"
    send "$LASNA_RPC" "${2:?probe address}" "withdraw()"
    ;;
  *) echo "usage: $0 [deploy | trigger <probe> | watch <probe> [fromBlock] | withdraw <probe>]" >&2; exit 1 ;;
esac
