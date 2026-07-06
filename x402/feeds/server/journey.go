package main

import "time"

// journey models a deterministic ~8-tick voyage of a coffee container
// from Santos (BR) to Rotterdam (NL). The demo agent walks ticks 0..7 and
// reacts to the events baked in here (cold-chain breach at tick 3, customs
// at tick 5, clearance at tick 6, delivery at tick 7).
//
// Everything is hardcoded so the demo is reproducible and vivid.

// baseTime is a fixed anchor so timestamps are deterministic across runs.
// Each tick advances 6 hours.
var baseTime = time.Date(2026, 6, 10, 8, 0, 0, 0, time.UTC)

func tickTime(tick int) string {
	return baseTime.Add(time.Duration(tick) * 6 * time.Hour).Format(time.RFC3339)
}

// telemetryRow is one tick of cold-chain + GPS telemetry.
type telemetryRow struct {
	TempC    float64 `json:"temp_c"`
	Humidity int     `json:"humidity"`
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Note     string  `json:"note,omitempty"` // human-readable event marker for the demo
}

// customsRow is one tick of customs status.
type customsRow struct {
	AtCustoms bool   `json:"at_customs"`
	Cleared   bool   `json:"cleared"`
	Location  string `json:"location"`
}

// telemetryJourney: index = tick. Santos -> Atlantic crossing -> Rotterdam.
//   ticks 0-2: normal, ~18C, moving across the Atlantic.
//   tick 3:    COLD-CHAIN BREACH (~31C) — the agent revalues the cargo down here.
//   ticks 4-5: temp recovers but cargo is degraded; nearing the European coast.
//   tick 6:    arrived Rotterdam (customs cleared elsewhere).
//   tick 7:    delivered at the Rotterdam terminal.
var telemetryJourney = []telemetryRow{
	{TempC: 18.2, Humidity: 60, Lat: -23.96, Lon: -46.30, Note: "departed Santos"},          // 0
	{TempC: 18.0, Humidity: 61, Lat: -15.50, Lon: -30.10, Note: "mid-Atlantic, nominal"},    // 1
	{TempC: 17.8, Humidity: 62, Lat: 5.20, Lon: -22.40, Note: "crossing equator, nominal"},  // 2
	{TempC: 31.4, Humidity: 78, Lat: 20.10, Lon: -18.70, Note: "COLD-CHAIN BREACH"},         // 3
	{TempC: 18.5, Humidity: 65, Lat: 35.30, Lon: -12.10, Note: "temp recovered, degraded"},  // 4
	{TempC: 18.1, Humidity: 63, Lat: 48.20, Lon: -5.40, Note: "approaching port"},           // 5
	{TempC: 17.9, Humidity: 61, Lat: 51.95, Lon: 4.13, Note: "arrived Rotterdam"},           // 6
	{TempC: 17.9, Humidity: 60, Lat: 51.9496, Lon: 4.1453, Note: "delivered at terminal"},   // 7
}

// customsJourney: index = tick.
//   tick 5: at customs, not yet cleared.
//   tick 6: cleared.
//   tick 7: cleared (delivered).
var customsJourney = []customsRow{
	{AtCustoms: false, Cleared: false, Location: "at sea"},          // 0
	{AtCustoms: false, Cleared: false, Location: "at sea"},          // 1
	{AtCustoms: false, Cleared: false, Location: "at sea"},          // 2
	{AtCustoms: false, Cleared: false, Location: "at sea"},          // 3
	{AtCustoms: false, Cleared: false, Location: "at sea"},          // 4
	{AtCustoms: true, Cleared: false, Location: "Rotterdam customs"},  // 5
	{AtCustoms: true, Cleared: true, Location: "Rotterdam customs"},   // 6
	{AtCustoms: false, Cleared: true, Location: "Rotterdam terminal"}, // 7
}

// priceJourney: unit price (USD micro-units / integer) per tick for the commodity.
// Coffee stays stable; the agent's revaluation comes from the breach telemetry,
// not from the market price. Kept as an int per the feed contract.
var priceJourney = []int{
	5_000_000, // 0
	5_000_000, // 1
	5_010_000, // 2
	5_000_000, // 3
	4_990_000, // 4
	5_000_000, // 5
	5_005_000, // 6
	5_000_000, // 7
}

// clampTick keeps an out-of-range tick within the journey bounds so the demo
// never panics; ticks past the end pin to the final delivered state.
func clampTick(tick, n int) int {
	if tick < 0 {
		return 0
	}
	if tick >= n {
		return n - 1
	}
	return tick
}
