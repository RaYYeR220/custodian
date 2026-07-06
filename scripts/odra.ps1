# Runs any command inside the casper-odra:dev Linux container with the project
# mounted and cargo/target caches on named volumes (fast iterative builds).
# Usage:  ./scripts/odra.ps1 cargo odra build
#         ./scripts/odra.ps1 cargo odra test
#         ./scripts/odra.ps1 sh -c "cargo run --bin custodian_deploy --features livenet"
param([Parameter(ValueFromRemainingArguments = $true)] $CmdArgs)

$proj = (Resolve-Path "$PSScriptRoot\..").Path

docker run --rm `
  -v "${proj}:/work" `
  -v casper-cargo:/cargo `
  -v casper-target:/target `
  -e CARGO_HOME=/cargo `
  -e CARGO_TARGET_DIR=/target `
  -w /work/custodian-contracts `
  casper-odra:dev `
  @CmdArgs
