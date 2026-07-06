# Canonical Linux dev environment for the Odra (Rust) smart contracts.
# Native Windows can compile the contract to wasm, but casper-types' host build
# (pulled in by `cargo odra test` and the livenet deploy) uses Unix-only APIs,
# so all test/deploy work happens in this container.
FROM rust:latest

# wasm-strip comes from wabt (apt is fine — it's stable).
# wasm-opt is pinned to binaryen v130 because our nightly (>= 2025-02-17, LLVM 20)
# makes cargo-odra pass --enable-bulk-memory --llvm-memory-copy-fill-lowering,
# which older apt binaryen builds don't support.
RUN apt-get update \
 && apt-get install -y --no-install-recommends wabt curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://github.com/WebAssembly/binaryen/releases/download/version_130/binaryen-version_130-x86_64-linux.tar.gz \
      | tar -xz -C /opt \
 && ln -sf /opt/binaryen-version_130/bin/wasm-opt /usr/local/bin/wasm-opt

# Odra pins this nightly via the project's rust-toolchain file.
RUN rustup toolchain install nightly-2026-01-01 \
      --component rust-src \
      --target wasm32-unknown-unknown \
      --profile minimal

RUN cargo install cargo-odra --locked

WORKDIR /work
