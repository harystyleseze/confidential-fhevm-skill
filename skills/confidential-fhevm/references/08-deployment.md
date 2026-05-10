# 08 — Deployment

> Open when deploying to local, Sepolia testnet, or mainnet. For the **complete agent workflow** (env-file pre-flight, post-deploy doc updates, Vercel push), open [`16-deployment-workflow.md`](16-deployment-workflow.md) — this file covers the mechanics, that one covers the agent's responsibilities end-to-end.

This document covers both tracks. The Foundry track is dominant for full-stack projects today (see §1); the Hardhat track (§2 onward) is documented for contract-only / legacy projects.

## Contents
1. **Foundry track** — `pnpm deploy:localhost` / `pnpm deploy:sepolia`, auto-regenerated frontend ABIs
2. Hardhat track — `hardhat-deploy` pattern
3. Sepolia prerequisites
4. Network choice matrix
5. Etherscan V2 + Sourcify
6. Commands reference
7. Post-deploy: frontend ABI auto-sync

---

## 1. Foundry track — `pnpm deploy:localhost`

The official `fhevm-react-template` orchestrates Foundry deploys via shell scripts that (a) invoke `forge script`, then (b) regenerate the frontend's auto-managed sidecar files. The end-to-end flow looks like:

```bash
pnpm chain &                                 # terminal 1: anvil + FHEVM cleartext host stack
pnpm deploy:localhost                        # terminal 2: deploy + regenerate frontend ABIs
```

Inside `scripts/deploy-localhost.sh`, each contract gets one forge-script call:

```bash
forge script script/DeployFHECounter.s.sol:DeployFHECounter \
    --rpc-url "$RPC_URL" --private-key "$ANVIL_PK" --broadcast

# To add ConfidentialVoting (or any new contract), append a second call:
forge script script/DeployConfidentialVoting.s.sol:DeployConfidentialVoting \
    --rpc-url "$RPC_URL" --private-key "$ANVIL_PK" --broadcast

# Then regenerate the frontend sidecars (one-shot for all contracts in broadcast/):
pnpm generate
```

`pnpm generate` walks `packages/foundry/broadcast/*/31337/run-latest.json` and emits one `<Name>.ts` + one `<Name>.local.ts` per deployed contract under `packages/nextjs/contracts/`. The frontend's `deploymentFor(Contract, chainId)` helper reads these.

For Sepolia (`pnpm deploy:sepolia`), the same shell pattern reads `.env.local`:

```bash
DEPLOYER_PRIVATE_KEY=0x...                   # funded with Sepolia ETH
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
ETHERSCAN_API_KEY=...                        # optional, enables --verify
```

Add `--verify` to the forge-script call if you want Etherscan verification in the same step.

---

## 2. Hardhat track — `hardhat-deploy`

```typescript
import {DeployFunction} from "hardhat-deploy/types";
import {HardhatRuntimeEnvironment} from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployer} = await hre.getNamedAccounts();
  const {deploy}   = hre.deployments;

  const result = await deploy("MyContract", {
    from: deployer,
    args: [/* constructor arguments */],
    log: true,
  });
  console.log("Deployed to:", result.address);
};

func.id   = "deploy_my_contract";  // prevents re-deployment on subsequent runs
func.tags = ["MyContract"];        // enables selective deploy with --tags
export default func;
```

## Sepolia prerequisites

```bash
# 1. Wallet seed phrase (deployer = first derived account)
npx hardhat vars set MNEMONIC

# 2. Infura key (free at https://app.infura.io/register)
npx hardhat vars set INFURA_API_KEY

# 3. Optional: Etherscan key for verification (free at https://etherscan.io/myapikey)
npx hardhat vars set ETHERSCAN_API_KEY
```

The deployer wallet needs Sepolia ETH for gas. Faucets:
- https://www.alchemy.com/faucets/ethereum-sepolia
- https://cloud.google.com/application/web3/faucet/ethereum/sepolia

Find your deployer address: `npx hardhat accounts --network sepolia`.

## Network choice

| Network | When | Cost | FHE infra |
| --- | --- | --- | --- |
| `localhost` (31337) | development & tests | free | mock |
| `sepolia` (11155111) | hackathons, demos, staging | faucet ETH | real coprocessor + KMS |
| `mainnet` (1) | production | real ETH | real coprocessor + KMS |

For hackathons and demos, **always use Sepolia**. Same real FHE infra as mainnet, free testnet ETH.

## Etherscan V2 + Sourcify

Etherscan migrated to API V2 in May 2025. Use a single API key, not per-network keys:

```typescript
// hardhat.config.ts
etherscan: {
  apiKey: vars.get("ETHERSCAN_API_KEY", ""),   // single key for all networks
},
sourcify: {
  enabled: true,                               // backup verifier, no API key needed
},
```

If Etherscan verification fails but Sourcify succeeds, the contract is still verified — Sourcify is an accepted alternative.

## Commands

```bash
# Local
npx hardhat node                                 # start local chain
npx hardhat deploy --network localhost           # deploy to local chain

# Sepolia (recommended for demos)
npx hardhat deploy --network sepolia
npx hardhat verify --network sepolia <ADDRESS>

# Mainnet (production — costs real ETH)
npx hardhat deploy --network mainnet
npx hardhat verify --network mainnet <ADDRESS>
```

## 7. Post-deploy frontend sync (auto-regenerated)

**Foundry track:** Nothing to do manually. `pnpm deploy:localhost` and `pnpm deploy:sepolia` both run `pnpm generate` as their last step, which walks `packages/foundry/broadcast/` and `packages/foundry/out/` and emits one tracked file (`<Name>.ts`) plus one gitignored overlay (`<Name>.local.ts`) per contract. Consumer code uses `deploymentFor(Contract, chainId)` and the two files merge at module load. If the sidecars drift, just rerun `pnpm generate`.

**Hardhat track:** Manual sync.

Frontend looks up contracts in `deployedContracts.ts` by chain ID:
```typescript
const deployedContracts = {
  31337: {
    MyContract: { address: "0x...local...", abi: [...] },
  },
  11155111: {
    MyContract: { address: "0x...sepolia...", abi: [...] },
  },
};
```

The ABI lives in `artifacts/contracts/MyContract.sol/MyContract.json` after `npx hardhat compile`. Copy the `abi` array into `deployedContracts.ts`. After each deploy, paste the new `address`.

For local development, the frontend's `useFhevm` hook detects chain 31337 via `initialMockChains: { 31337: "http://localhost:8545" }` and uses mock FHE automatically.

See also: [`02-project-setup.md`](02-project-setup.md), [`09-frontend-patterns.md`](09-frontend-patterns.md).
