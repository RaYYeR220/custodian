// Command feeds-server is the Custodian project's mock data-feed server.
//
// It exposes three x402-gated JSON endpoints describing a scripted shipment
// journey (a coffee container Santos -> Rotterdam) plus a free /health probe.
// Each paid call settles a small micropayment in the deployed Cep18 X402 token
// via the casper-x402 facilitator, reusing the reference SDK's Gin middleware.
//
// Endpoints:
//
//	GET /telemetry?shipment=<id>&tick=<n>  (paid) cold-chain + GPS telemetry
//	GET /price?commodity=<sym>&tick=<n>    (paid) commodity unit price
//	GET /customs?shipment=<id>&tick=<n>    (paid) customs clearance status
//	GET /health                            (free) liveness probe
//
// A shipment=loss (or ?scenario=loss) variant makes telemetry go silent so the
// agent can trigger an insurance claim.
//
// Configuration is via environment variables — see config.go. The env-var setup
// is identical to the reference examples/server (see x402/run-x402-spike.sh),
// except the port var is FEEDS_PORT (default 4023) to avoid colliding with the
// facilitator/server PORT default.
package main

import (
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	ginfw "github.com/gin-gonic/gin"
	x402 "github.com/x402-foundation/x402/go"
	x402http "github.com/x402-foundation/x402/go/http"
	ginmwx402 "github.com/x402-foundation/x402/go/http/gin"

	casperServer "casper_x402_facilitator/x402/mechanisms/casper/exact/server"
)

// isLoss reports whether the request asks for the silent/lost-shipment variant.
func isLoss(c *ginfw.Context) bool {
	return c.Query("scenario") == "loss" || c.Query("shipment") == "loss"
}

// queryTick parses ?tick=<n>, defaulting to 0 on missing/invalid input.
func queryTick(c *ginfw.Context) int {
	n, err := strconv.Atoi(c.DefaultQuery("tick", "0"))
	if err != nil {
		return 0
	}
	return n
}

func main() {
	var cfg Env
	if err := cfg.Parse(); err != nil {
		panic(fmt.Sprintf("Error parsing configuration: %v", err))
	}

	assetName := cfg.AssetName
	assetPackage := strings.Replace(cfg.AssetPackage, "hash-", "", -1)
	x402Network := x402.Network(cfg.ChainID)

	log.Printf("feeds server starting: asset_package=%s payee=%s network=%s facilitator=%s price_amount=%d port=%d",
		assetPackage, cfg.PayeeAddress, x402Network, cfg.FacilitatorURL, cfg.PriceAmount, cfg.Port)

	r := ginfw.New()
	r.Use(ginfw.Logger())
	r.Use(ginfw.Recovery())
	r.Use(cors.New(cors.Config{
		AllowAllOrigins: true,
		AllowMethods:    []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowHeaders:    []string{"Accept", "Authorization", "Content-Type", "Origin", "Payment-Signature"},
		ExposeHeaders:   []string{"PAYMENT-REQUIRED", "PAYMENT-RESPONSE"},
		MaxAge:          24 * time.Hour,
	}))

	// Self-hosted facilitator needs no API key (see the spike). Keep it simple.
	facilitatorClient := x402http.NewHTTPFacilitatorClient(&x402http.FacilitatorConfig{URL: cfg.FacilitatorURL})

	// All three paid endpoints charge the same small fixed micropayment.
	paid := func(desc string) x402http.RouteConfig {
		return x402http.RouteConfig{
			Accepts: x402http.PaymentOptions{
				{
					Scheme:  "exact",
					Price:   "$0.001",
					Network: x402Network,
					PayTo:   cfg.PayeeAddress,
				},
			},
			Description: desc,
			MimeType:    "application/json",
		}
	}

	routes := x402http.RoutesConfig{
		"GET /telemetry": paid("Cold-chain + GPS telemetry for a shipment tick"),
		"GET /price":     paid("Commodity unit price for a tick"),
		"GET /customs":   paid("Customs clearance status for a shipment tick"),
	}

	// The MoneyParser ignores the $ amount and returns our fixed on-chain price,
	// mirroring the reference examples/server. Charge cfg.PriceAmount per call.
	casperScheme := casperServer.NewExactCasperScheme().
		RegisterMoneyParser(func(_ float64, _ x402.Network) (*x402.AssetAmount, error) {
			return &x402.AssetAmount{
				Amount: fmt.Sprintf("%d", cfg.PriceAmount),
				Asset:  assetPackage,
				Extra:  map[string]interface{}{"name": assetName, "version": "1", "decimals": "9"},
			}, nil
		}).
		RegisterAsset(cfg.ChainID, assetPackage, 2)

	server := x402.Newx402ResourceServer(
		x402.WithFacilitatorClient(facilitatorClient),
	).
		Register(x402Network, casperScheme).
		OnAfterSettle(func(ctx x402.SettleResultContext) error {
			log.Printf("settle complete: success=%v tx=%s", ctx.Result.Success, ctx.Result.Transaction)
			return nil
		}).
		OnSettleFailure(func(ctx x402.SettleFailureContext) (*x402.SettleFailureHookResult, error) {
			log.Printf("settle failure: %v", ctx.Error)
			return nil, nil
		})

	r.Use(ginmwx402.PaymentMiddleware(routes, server))

	// --- GET /telemetry (paid) ---
	r.GET("/telemetry", func(c *ginfw.Context) {
		shipment := c.DefaultQuery("shipment", "0")
		tick := queryTick(c)

		if isLoss(c) {
			// Silent shipment: GPS/telemetry lost. Agent triggers insurance.
			c.JSON(http.StatusOK, ginfw.H{
				"shipment": shipment,
				"tick":     tick,
				"lost":     true,
				"temp_c":   0.0,
				"humidity": 0,
				"lat":      0.0,
				"lon":      0.0,
				"ts":       tickTime(tick),
			})
			return
		}

		row := telemetryJourney[clampTick(tick, len(telemetryJourney))]

		// ?live=1 makes this a REAL data feed: pay the x402 micropayment and get
		// the genuine current temperature at the cargo's coordinates from
		// Open-Meteo (free, no key). Falls back to the scripted journey if the
		// upstream is unreachable, so the demo stays deterministic and offline-safe.
		tempC := row.TempC
		note := row.Note
		source := "scripted"
		if c.Query("live") == "1" {
			if t, ok := realTemperature(row.Lat, row.Lon); ok {
				tempC = t
				note = row.Note + " (live temp via open-meteo)"
				source = "open-meteo"
			}
		}

		c.JSON(http.StatusOK, ginfw.H{
			"shipment": shipment,
			"tick":     tick,
			"lost":     false,
			"temp_c":   tempC,
			"humidity": row.Humidity,
			"lat":      row.Lat,
			"lon":      row.Lon,
			"note":     note,
			"source":   source,
			"ts":       tickTime(tick),
		})
	})

	// --- GET /price (paid) ---
	r.GET("/price", func(c *ginfw.Context) {
		commodity := c.DefaultQuery("commodity", "COFFEE")
		tick := queryTick(c)
		price := priceJourney[clampTick(tick, len(priceJourney))]
		c.JSON(http.StatusOK, ginfw.H{
			"commodity":  commodity,
			"tick":       tick,
			"unit_price": price,
			"currency":   "USD",
			"ts":         tickTime(tick),
		})
	})

	// --- GET /customs (paid) ---
	r.GET("/customs", func(c *ginfw.Context) {
		shipment := c.DefaultQuery("shipment", "0")
		tick := queryTick(c)
		row := customsJourney[clampTick(tick, len(customsJourney))]
		c.JSON(http.StatusOK, ginfw.H{
			"shipment":   shipment,
			"tick":       tick,
			"at_customs": row.AtCustoms,
			"cleared":    row.Cleared,
			"location":   row.Location,
			"ts":         tickTime(tick),
		})
	})

	// --- GET /health (free) ---
	r.GET("/health", func(c *ginfw.Context) {
		c.JSON(http.StatusOK, ginfw.H{"status": "ok"})
	})

	if err := r.Run(fmt.Sprintf(":%d", cfg.Port)); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
