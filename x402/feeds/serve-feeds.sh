#!/usr/bin/env bash
# Long-lived variant of run-feeds.sh: start the self-hosted casper-x402
# facilitator (:4022) and OUR x402-gated feed server (:4023) and KEEP THEM
# RUNNING (no client, no teardown). Used as the live backend for the agent:
# the MCP server's feed tools shell a golang client that pays these endpoints.
#
# Run detached, publishing the ports to the host so the MCP's client container
# can reach them via host.docker.internal:
#   docker run -d --name custodian-feeds -p 4022:4022 -p 4023:4023 \
#     -v <repo>:/work -v <repo>/.keys:/keys:ro \
#     -v go-mod-cache:/go/pkg/mod -v go-build-cache:/root/.cache/go-build \
#     -w /work golang:1.25 bash /work/x402/feeds/serve-feeds.sh
set -uo pipefail

REF=/work/.reference/casper-x402
FEEDS=/work/x402/feeds

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
export FEEDS_PRICE_AMOUNT="100000000"
# NOTE: bind on 0.0.0.0 implicitly (gin default) so published ports work.

wait_port() {
  for _ in $(seq 1 120); do
    (echo > "/dev/tcp/localhost/$1") >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

echo "=== starting facilitator (:4022) ==="
( cd "$REF" && go run ./apps/facilitator ) >/tmp/facilitator.log 2>&1 &
echo "waiting for facilitator..."; wait_port 4022 && echo "  facilitator up" || { echo "  facilitator DID NOT bind"; tail -n 40 /tmp/facilitator.log; }
sleep 2

echo "=== starting feed server (:4023) ==="
( cd "$FEEDS" && go run ./server ) >/tmp/feeds.log 2>&1 &
echo "waiting for feed server..."; wait_port 4023 && echo "  feed server up" || { echo "  feed server DID NOT bind"; tail -n 40 /tmp/feeds.log; }

echo
echo "=== services up — facilitator :4022, feed server :4023 (following logs) ==="
# Keep the container alive and stream both logs.
tail -n +1 -f /tmp/facilitator.log /tmp/feeds.log
