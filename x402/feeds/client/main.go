// Command feeds-client validates the Custodian feed server's x402 paywall.
//
// It performs the full pay->data flow against our feed server:
//   1. GET /health           (free, no payment) — sanity probe
//   2. GET /telemetry?tick=3 (paid) — the COLD-CHAIN BREACH tick (~31C)
//   3. GET /customs?tick=6   (paid) — customs CLEARED
//
// For each paid call the x402 client receives a 402, signs an EIP-712
// authorization, the facilitator settles on Casper testnet, and the data
// comes back. The settled tx hash is printed from the Payment-Response header.
package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"

	x402 "github.com/x402-foundation/x402/go"
	x402http "github.com/x402-foundation/x402/go/http"

	casperClientScheme "casper_x402_facilitator/x402/mechanisms/casper/exact/client"
	casperSigner "casper_x402_facilitator/x402/signers/casper"
)

func decodePaymentResponse(s string) string {
	if s == "" {
		return ""
	}
	decoded, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return s
	}
	return string(decoded)
}

func main() {
	var cfg Env
	if err := cfg.Parse(); err != nil {
		log.Fatalf("Error parsing configuration: %v", err)
	}

	signer, err := casperSigner.NewClientSignerFromKeyFile(cfg.PrivateKeyPath, cfg.KeyAlgo)
	if err != nil {
		log.Fatalf("failed to create signer: %v", err)
	}

	fmt.Printf("Client address: %s\n", signer.AccountAddress())
	fmt.Printf("Network:        %s\n", cfg.ChainID)
	fmt.Printf("Server:         %s\n", cfg.ServerURL)

	scheme := casperClientScheme.NewExactCasperScheme(signer)
	x402Client := x402.Newx402Client()
	x402Client.Register(x402.Network(cfg.ChainID), scheme)

	// Free, unpaid client for /health (no x402 wrapping needed).
	plain := http.DefaultClient
	// Paying client for the gated endpoints.
	paying := x402http.WrapHTTPClientWithPayment(
		http.DefaultClient,
		x402http.Newx402HTTPClient(x402Client),
	)

	// 1) Free health probe.
	fmt.Println("\n=== GET /health (free) ===")
	if resp, err := plain.Get(cfg.ServerURL + "/health"); err != nil {
		log.Fatalf("health request failed: %v", err)
	} else {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		fmt.Printf("Status: %d  Body: %s\n", resp.StatusCode, string(body))
	}

	// 2) Paid telemetry at the breach tick.
	getPaid(paying, "GET /telemetry?shipment=0&tick=3  (COLD-CHAIN BREACH)",
		cfg.ServerURL+"/telemetry?shipment=0&tick=3")

	// 3) Paid customs at the cleared tick.
	getPaid(paying, "GET /customs?shipment=0&tick=6  (CLEARED)",
		cfg.ServerURL+"/customs?shipment=0&tick=6")
}

func getPaid(client *http.Client, label, url string) {
	fmt.Printf("\n=== %s ===\n", label)
	resp, err := client.Get(url)
	if err != nil {
		log.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Fatalf("failed to read body: %v", err)
	}

	fmt.Printf("Status: %d\n", resp.StatusCode)
	if pr := decodePaymentResponse(resp.Header.Get("Payment-Response")); pr != "" {
		fmt.Printf("Payment-Response: %s\n", pr)
	}
	fmt.Printf("Data: %s\n", string(body))
}
