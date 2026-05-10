# 08 — Deployment

> Open when deploying to local, Sepolia testnet, or mainnet.

## Contents
- Deploy script (hardhat-deploy)
- Sepolia prerequisites
- Network choice matrix
- Etherscan V2 + Sourcify
- Commands reference
- Post-deploy: update frontend ABI/address

---

## Deploy script (hardhat-deploy)

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

## Post-deploy: update frontend

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
