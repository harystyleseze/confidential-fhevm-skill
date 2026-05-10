# Foundry-track templates

Use these when working from Zama's official `fhevm-react-template` (the canonical full-stack scaffold today). All files are real source files, not markdown wrappers — drop them straight into a freshly-cloned template.

| File | Drop into |
| --- | --- |
| [`contract.sol`](contract.sol) | `packages/foundry/src/MyContract.sol` |
| [`Test.t.sol`](Test.t.sol) | `packages/foundry/test/MyContractTest.t.sol` |
| [`Deploy.s.sol`](Deploy.s.sol) | `packages/foundry/script/DeployMyContract.s.sol` |
| [`foundry.toml`](foundry.toml) | `packages/foundry/foundry.toml` *(reference; template already ships an equivalent)* |
| [`deploy-sepolia.sh`](deploy-sepolia.sh) | `scripts/deploy-sepolia.sh` *(replace template default — adds `run_forge` helper for multi-contract deploys; rename `<Name>` placeholders)* |
| [`.env.example`](.env.example) | `<repo-root>/.env.example` *(consumed by `deploy-sepolia.sh`)* |

## Quick start (zero-to-deployed in ≈3 minutes)

```bash
git clone https://github.com/zama-ai/fhevm-react-template.git my-dapp
cd my-dapp
git submodule update --init --recursive    # pulls in the Foundry submodule if present
pnpm install
pnpm contracts:install                     # forge soldeer install (forge-fhevm + deps)

# 1. Drop in your contract + test + deploy script (mirror the three template files)

# 2. Build + test (forge-fhevm cleartext mode — no relayer/KMS needed)
pnpm contracts:build
pnpm contracts:test

# 3. Lint
npx fhevm-lint packages/foundry/src/       # 0 findings = ship-ready

# 4. Run end-to-end locally
pnpm chain                                 # terminal 1: anvil + FHEVM host
pnpm deploy:localhost                      # terminal 2: deploys + regenerates frontend ABIs
pnpm start                                 # terminal 3: Next.js on :3000
```

## Wiring a new contract into `pnpm deploy:localhost`

The shell script `scripts/deploy-localhost.sh` only deploys `FHECounter` by default. To also deploy your contract and regenerate its frontend ABI, add a second forge-script call **before** the `pnpm generate` step. See `references/08-deployment.md` for the exact diff.

## forge-fhevm cleartext-mode specifics

- **One ciphertext per `bytes` proof.** `encryptBool` and `encryptUint64` each create independent proofs in cleartext mode. Design contract functions to take one `bytes calldata proof` per ciphertext.
- **`buildDecryptionProof(handles, abiEncoded)`** lets you test the full public-decrypt → `FHE.checkSignatures` happy path without spinning up a real KMS. See `references/07-testing-guide.md`.
- **`decrypt(handle)`** is a test-only helper that reads the cleartext from the `plaintexts(bytes32)` mapping the cleartext executor maintains. Never call this from production contracts (it does not exist on Sepolia/mainnet) — `fhevm-lint` AP-018 flags direct `FHE.decrypt(...)` calls.

## When to use this track vs. the Hardhat track

- **Use Foundry** when starting from `fhevm-react-template` today. This is Zama's recommended full-stack scaffold and the React side ships SDK v3.
- **Use Hardhat** when integrating into an existing Hardhat project, when you want `hardhat-deploy`-style migrations, or when the team is already invested in TypeChain-typed tests.

The Solidity contracts themselves are **identical** between tracks — only tests, deploy scripts, and surrounding tooling differ.
