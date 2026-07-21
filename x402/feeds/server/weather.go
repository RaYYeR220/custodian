package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// realTemperature fetches the current 2-metre air temperature (°C) at lat/lon
// from Open-Meteo — a free, no-API-key weather service. Returns (temp, true) on
// success and (0, false) on any error, so the caller can fall back to the
// scripted journey (the demo never breaks when offline). This is what makes the
// x402 telemetry feed a REAL data source: `GET /telemetry?live=1` pays a
// micropayment and returns a genuine live environmental reading.
func realTemperature(lat, lon float64) (float64, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	url := fmt.Sprintf(
		"https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&current=temperature_2m",
		lat, lon,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, false
	}

	var body struct {
		Current struct {
			Temperature2m float64 `json:"temperature_2m"`
		} `json:"current"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, false
	}
	return body.Current.Temperature2m, true
}
