package main

import (
	"fmt"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

const EnvFile = ".env"

// Env mirrors ./client/config.go so the same run-script env setup works here.
type Env struct {
	PrivateKeyPath string `env:"CLIENT_PRIVATE_KEY_PATH,required"`
	KeyAlgo        string `env:"CLIENT_KEY_ALGO" envDefault:"ed25519"`
	ServerURL      string `env:"FEEDS_SERVER_URL" envDefault:"http://localhost:4023"`
	ChainID        string `env:"CAIP2_CHAIN_ID,required"`
}

func (e *Env) Parse() error {
	if err := godotenv.Load(EnvFile); err != nil {
		// rely only on env vars (run-script exports them)
		fmt.Println("Could not load .env file")
	}
	return env.Parse(e)
}
