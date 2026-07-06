package main

import (
	"fmt"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

const EnvFile = ".env"

// Env mirrors the reference examples/server config so the same run-script
// env-var setup works unchanged.
type Env struct {
	Port              int    `env:"FEEDS_PORT" envDefault:"4023"`
	PayeeAddress      string `env:"PAYEE_ADDRESS,required"`
	FacilitatorURL    string `env:"FACILITATOR_URL,required"`
	FacilitatorAPIKey string `env:"FACILITATOR_API_KEY"`
	ChainID           string `env:"CAIP2_CHAIN_ID,required"`
	AssetPackage      string `env:"ASSET_PACKAGE,required"`
	AssetName         string `env:"ASSET_NAME,required"`
	// PriceAmount is the fixed on-chain X402 amount charged per paid call
	// (in the token's smallest unit; 9 decimals). 100000000 = 0.1 token.
	PriceAmount int64 `env:"FEEDS_PRICE_AMOUNT" envDefault:"100000000"`
}

func (e *Env) Parse() error {
	if err := godotenv.Load(EnvFile); err != nil {
		// rely only on env vars
		fmt.Println("Could not load .env file")
	}
	return env.Parse(e)
}
