#!/usr/bin/env bash
# Validate the Custodian x402-gated feed server end to end, in ONE container:
#   1. start the casper-x402 facilitator (self-hosted, from the .reference clone)
#   2. start OUR feed server (custodian/feeds, gates /telemetry /price /customs)
#   3. run OUR client: /health (free) -> /telemetry?tick=3 (breach, paid)
#      -> /customs?tick=6 (cleared, paid)
#
# All env-configured against Casper testnet (no .env files). The funded account
# .keys/secret_key.pem is both the x402 payer (client) and the facilitator gas
# payer — same as the proven spike.
#
# Run from the container as: bash /work/x402/feeds/run-feeds.sh
# (the whole project is mounted at /work so the feeds module's replace directive
#  `replace casper_x402_facilitator => ../../.reference/casper-x402` resolves.)
set -uo pipefail

REF=/work/.reference/casper-x402   # facilitator lives here (has go.mod)
FEEDS=/work/x402/feeds             # our module

# --- facilitator ---
export CASPER_NETWORKS="casper:casper-test"
export SECRET_KEY_PEM_CASPER_CASPER_TEST="$(cat /keys/secret_key.pem)"
export SECRET_KEY_ALGO_CASPER_CASPER_TEST="ed25519"
export RPCURL_CASPER_CASPER_TEST="https://node.testnet.casper.network/rpc"
export TRANSACTION_PAYMENT_MOTES="7000000000"
export LOG_LEVEL="info"

# --- feed server (x402-gated) ---
export PAYEE_ADDRESS="00eb46ac01d8757f8e09b9fc454aa90ffeb9fc54a267b9775bc4bfa81ee09a4c67"
export FACILITATOR_URL="http://localhost:4022"
export CAIP2_CHAIN_ID="casper:casper-test"
export ASSET_PACKAGE="265ee18c6883e72c6a4ad5ea5a9486f727b57c741f7cd6203c29cbe72b0f59bd"
export ASSET_NAME="Casper X402 Token"
export FEEDS_PORT="4023"
export FEEDS_PRICE_AMOUNT="100000000"   # 0.1 X402 token (9 decimals) per paid call
# NOTE: do NOT export PORT — facilitator (4022) reads PORT; our server uses FEEDS_PORT.

# --- client ---
export CLIENT_PRIVATE_KEY_PATH="/keys/secret_key.pem"
export CLIENT_KEY_ALGO="ed25519"
export FEEDS_SERVER_URL="http://localhost:4023"

wait_port() {
  for _ in $(seq 1 90); do
    (echo > "/dev/tcp/localhost/$1") >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

echo "=== starting facilitator (:4022) ==="
( cd "$REF" && go run ./apps/facilitator ) >/tmp/facilitator.log 2>&1 &
FAC=$!
echo "waiting for facilitator..."; wait_port 4022 && echo "  facilitator up" || echo "  facilitator DID NOT bind"
sleep 2

echo "=== starting feed server (:4023) ==="
( cd "$FEEDS" && go run ./server ) >/tmp/feeds.log 2>&1 &
SRV=$!
echo "waiting for feed server..."; wait_port 4023 && echo "  feed server up" || echo "  feed server DID NOT bind"
sleep 3

echo
echo "=== running client (auto-pays via x402) ==="
( cd "$FEEDS" && go run ./client )
CLIENT_RC=$?
echo "client exit: $CLIENT_RC"

echo
echo "=== facilitator settle lines ==="
grep -i "settle" /tmp/facilitator.log | tail -n 20 || tail -n 30 /tmp/facilitator.log
echo
echo "=== feed server log (tail) ==="
tail -n 20 /tmp/feeds.log

kill "$FAC" "$SRV" >/dev/null 2>&1 || true
