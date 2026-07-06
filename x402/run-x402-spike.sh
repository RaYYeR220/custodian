#!/usr/bin/env bash
# Spike: fire one real x402 micropayment, settled on Casper testnet.
# Runs the casper-x402 facilitator + resource server + client (all env-configured,
# no .env file). Facilitator and client are the same funded account (0147fedb):
# it holds the X402 token supply (client/payer) and pays settlement gas (facilitator).
set -uo pipefail
cd /src   # mounted casper-x402 repo (has go.mod)

# --- facilitator ---
export CASPER_NETWORKS="casper:casper-test"
export SECRET_KEY_PEM_CASPER_CASPER_TEST="$(cat /keys/secret_key.pem)"
export SECRET_KEY_ALGO_CASPER_CASPER_TEST="ed25519"
export RPCURL_CASPER_CASPER_TEST="https://node.testnet.casper.network/rpc"
export TRANSACTION_PAYMENT_MOTES="7000000000"
export LOG_LEVEL="info"

# --- resource server (x402-gated GET /weather) ---
export PAYEE_ADDRESS="00eb46ac01d8757f8e09b9fc454aa90ffeb9fc54a267b9775bc4bfa81ee09a4c67"
export FACILITATOR_URL="http://localhost:4022"
export CAIP2_CHAIN_ID="casper:casper-test"
export ASSET_PACKAGE="265ee18c6883e72c6a4ad5ea5a9486f727b57c741f7cd6203c29cbe72b0f59bd"
export ASSET_NAME="Casper X402 Token"
# NOTE: do NOT export PORT — both facilitator (default 4022) and server (default 4021)
# read the same PORT var; setting it collides them. Rely on their defaults.

# --- client (signs EIP-712 authorization; same key holds the token supply) ---
export CLIENT_PRIVATE_KEY_PATH="/keys/secret_key.pem"
export CLIENT_KEY_ALGO="ed25519"
export SERVER_URL="http://localhost:4021"

wait_port() {
  for _ in $(seq 1 90); do
    (echo > "/dev/tcp/localhost/$1") >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

echo "=== starting facilitator (:4022) ==="
go run ./apps/facilitator >/tmp/facilitator.log 2>&1 &
FAC=$!
echo "waiting for facilitator..."; wait_port 4022 && echo "  facilitator up" || echo "  facilitator DID NOT bind"
sleep 2

echo "=== starting resource server (:4021) ==="
go run ./examples/server >/tmp/server.log 2>&1 &
SRV=$!
echo "waiting for server...";      wait_port 4021 && echo "  server up"      || echo "  server DID NOT bind"
sleep 3

echo
echo "=== running client (auto-pays via x402) ==="
go run ./examples/client
CLIENT_RC=$?
echo "client exit: $CLIENT_RC"

echo
echo "=== facilitator log ==="
tail -n 60 /tmp/facilitator.log
echo
echo "=== server log ==="
tail -n 40 /tmp/server.log

kill "$FAC" "$SRV" >/dev/null 2>&1 || true
