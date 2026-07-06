// Command feedfetch is a PARAMETERIZED x402 client used by the Custodian MCP
// server. The original ./client hardcodes /telemetry?tick=3 and /customs?tick=6
// for the e2e demo; feedfetch instead pays for an ARBITRARY gated path supplied
// via FEEDS_PATH (e.g. "/telemetry?shipment=0&tick=3") so each MCP feed tool can
// request the data point it actually needs.
//
// It reuses the exact same proven x402 client stack (casper signer + exact
// scheme) and env config as ./client. On success it prints ONE JSON line to
// stdout that the MCP wrapper parses:
//
//   {"status":200,"tx":"<hash>","data":{...feed json...}}
//
// All human-readable progress goes to stderr so stdout stays machine-parseable.
package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"

	x402 "github.com/x402-foundation/x402/go"
	x402http "github.com/x402-foundation/x402/go/http"

	casperClientScheme "casper_x402_facilitator/x402/mechanisms/casper/exact/client"
	casperSigner "casper_x402_facilitator/x402/signers/casper"
)

var txRe = regexp.MustCompile(`[0-9a-fA-F]{64}`)

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

func fail(format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}

func main() {
	var cfg Env
	if err := cfg.Parse(); err != nil {
		fail("config error: %v", err)
	}

	path := os.Getenv("FEEDS_PATH")
	if path == "" {
		fail("FEEDS_PATH is required (e.g. /telemetry?shipment=0&tick=3)")
	}

	signer, err := casperSigner.NewClientSignerFromKeyFile(cfg.PrivateKeyPath, cfg.KeyAlgo)
	if err != nil {
		fail("failed to create signer: %v", err)
	}

	fmt.Fprintf(os.Stderr, "feedfetch: %s%s as %s\n", cfg.ServerURL, path, signer.AccountAddress())

	scheme := casperClientScheme.NewExactCasperScheme(signer)
	x402Client := x402.Newx402Client()
	x402Client.Register(x402.Network(cfg.ChainID), scheme)

	paying := x402http.WrapHTTPClientWithPayment(
		http.DefaultClient,
		x402http.Newx402HTTPClient(x402Client),
	)

	resp, err := paying.Get(cfg.ServerURL + path)
	if err != nil {
		fail("request failed: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		fail("read body failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		fail("server returned %d: %s", resp.StatusCode, string(body))
	}

	// Extract the settlement tx hash from the Payment-Response header (if any).
	// The header is base64 JSON like {"success":true,"payer":"00..","transaction":"<hash>",..}.
	// Parse the `transaction` field explicitly — a naive 64-hex regex would match
	// the `payer` account hash first and report the wrong value.
	tx := ""
	if pr := decodePaymentResponse(resp.Header.Get("Payment-Response")); pr != "" {
		var prObj struct {
			Transaction string `json:"transaction"`
		}
		if err := json.Unmarshal([]byte(pr), &prObj); err == nil && prObj.Transaction != "" {
			tx = prObj.Transaction
		} else if m := txRe.FindString(pr); m != "" {
			tx = m
		}
		fmt.Fprintf(os.Stderr, "Payment-Response: %s\n", pr)
	}

	// The feed body is itself JSON; embed it raw so the MCP gets structured data.
	var data json.RawMessage = json.RawMessage(body)
	out := map[string]any{
		"status": resp.StatusCode,
		"tx":     tx,
		"data":   data,
	}
	enc, _ := json.Marshal(out)
	fmt.Println(string(enc))
}
