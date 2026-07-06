//! odra-cli entry: deploy the Custodian contract + a demo tokenize scenario.
//! Run (in the casper-odra:dev container, reads the natively-built wasm/Custodian.wasm):
//!   cargo run -q --bin custodian_contracts_cli -- deploy
//!   cargo run -q --bin custodian_contracts_cli -- scenario tokenize-demo
//!   cargo run -q --bin custodian_contracts_cli -- contract Custodian get_shipment 0

use custodian_contracts::custodian::{Custodian, CustodianInitArgs};
use odra::casper_types::U512;
use odra::host::{HostEnv, HostRef};
use odra_cli::{
    deploy::DeployScript,
    scenario::{Args, Error, Scenario, ScenarioMetadata},
    CommandArg, ContractProvider, DeployedContractsContainer, DeployerExt, OdraCli,
};

/// Deploys `Custodian` with the deployer as both owner and operator.
/// (The off-chain agent's account becomes operator later via `set_operator`.)
pub struct CustodianDeployScript;

impl DeployScript for CustodianDeployScript {
    fn deploy(
        &self,
        env: &HostEnv,
        container: &mut DeployedContractsContainer,
    ) -> Result<(), odra_cli::deploy::Error> {
        let me = env.get_account(0);
        let _custodian = Custodian::load_or_deploy(
            env,
            CustodianInitArgs { owner: me, operator: me },
            container,
            350_000_000_000,
        )?;
        Ok(())
    }
}

/// Tokenizes a demo shipment: attaches 5 CSPR escrow, deployer as sole holder.
/// Proves `tokenize_shipment` (payable) works on the real Casper VM.
pub struct TokenizeDemoScenario;

impl Scenario for TokenizeDemoScenario {
    fn args(&self) -> Vec<CommandArg> {
        vec![]
    }

    fn run(
        &self,
        env: &HostEnv,
        container: &DeployedContractsContainer,
        _args: Args,
    ) -> Result<(), Error> {
        let me = env.get_account(0);
        let mut custodian = container.contract_ref::<Custodian>(env)?;
        env.set_gas(10_000_000_000);
        custodian
            .with_tokens(U512::from(5_000_000_000u64)) // 5 CSPR escrow
            .try_tokenize_shipment(
                "DEMO Coffee Santos->Rotterdam".to_string(),
                U512::from(1000u64),       // quantity
                U512::from(5_000_000u64),  // unit_price -> qty*price = 5 CSPR
                U512::from(4_000_000_000u64), // insurance 4 CSPR
                vec![me],
                vec![U512::from(100u64)],
            )?;
        Ok(())
    }
}

impl ScenarioMetadata for TokenizeDemoScenario {
    const NAME: &'static str = "tokenize-demo";
    const DESCRIPTION: &'static str =
        "Tokenize a demo shipment (5 CSPR escrow, deployer as sole holder)";
}

pub fn main() {
    OdraCli::new()
        .about("Custodian deploy + scenarios")
        .deploy(CustodianDeployScript)
        .contract::<Custodian>()
        .scenario(TokenizeDemoScenario)
        .build()
        .run();
}
