# Project Setup Guide

## Hardhat Project (Contract Development)

### From template (recommended)

```bash
git clone https://github.com/zama-ai/fhevm-hardhat-template.git my-fhevm-project
cd my-fhevm-project
npm install
npx hardhat vars set MNEMONIC           # wallet seed phrase for deployment
npx hardhat vars set INFURA_API_KEY     # Infura key for Sepolia RPC
npx hardhat vars set ETHERSCAN_API_KEY  # optional, for contract verification
```

### From scratch (existing project)

Install dependencies:
```bash
npm install @fhevm/solidity@^0.11.1 @fhevm/mock-utils@^0.4.2 encrypted-types@^0.0.4
npm install -D @fhevm/hardhat-plugin@^0.4.2 hardhat@^2.28.4 @nomicfoundation/hardhat-ethers@^3.1.3 hardhat-deploy@^0.11.45 @typechain/hardhat@^9.1.0 ethers@^6.16.0 typescript@^5.9.3 chai@^4.5.0 @types/chai@^4.3.20 @types/mocha@^10.0.10 @nomicfoundation/hardhat-chai-matchers@^2.1.0 @nomicfoundation/hardhat-verify@^2.1.3 solidity-coverage@^0.8.17
```

### hardhat.config.ts — every field explained

```typescript
import "@fhevm/hardhat-plugin";          // Adds fhevm object to HRE (createEncryptedInput, userDecryptEuint)
import "@nomicfoundation/hardhat-chai-matchers"; // Chai matchers for Hardhat
import "@nomicfoundation/hardhat-ethers"; // Ethers.js integration
import "@nomicfoundation/hardhat-verify"; // Contract verification on Etherscan
import "@typechain/hardhat";              // TypeScript type generation for contracts
import "hardhat-deploy";                  // Deployment management with named accounts
import "hardhat-gas-reporter";            // Gas usage reporting
import type {HardhatUserConfig} from "hardhat/config";
import {vars} from "hardhat/config";
import "solidity-coverage";               // Code coverage for Solidity

import "./tasks/accounts";                // Import custom task files
// import "./tasks/MyContract";           // Add your task files here

const MNEMONIC = vars.get("MNEMONIC", "test test test test test test test test test test test junk");
const INFURA_API_KEY = vars.get("INFURA_API_KEY", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz");

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: 0,  // First account from mnemonic is the deployer
  },
  etherscan: {
    apiKey: vars.get("ETHERSCAN_API_KEY", ""), // Single key (Etherscan V2 — per-network keys are deprecated)
  },
  sourcify: {
    enabled: true, // Backup verification via Sourcify (no API key needed)
  },
  networks: {
    hardhat: {
      accounts: {mnemonic: MNEMONIC},
      chainId: 31337,  // Local development — mock FHE, no real coprocessor
    },
    sepolia: {
      accounts: {mnemonic: MNEMONIC, path: "m/44'/60'/0'/0/", count: 10},
      chainId: 11155111, // Testnet — real FHE, free testnet ETH from faucets
      url: `https://sepolia.infura.io/v3/${INFURA_API_KEY}`,
    },
    mainnet: {
      accounts: {mnemonic: MNEMONIC, path: "m/44'/60'/0'/0/", count: 10},
      chainId: 1, // Production — real FHE, costs real ETH
      url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
    },
  },
  solidity: {
    version: "0.8.27",
    settings: {
      evmVersion: "cancun",        // Required for EIP-1153 transient storage (used by FHE.allowTransient)
      optimizer: {enabled: true, runs: 800},
      metadata: {bytecodeHash: "none"},  // Recommended for deterministic builds
    },
  },
  typechain: {
    outDir: "types",       // Generated types directory
    target: "ethers-v6",   // Must match ethers version
  },
};

export default config;
```

### Folder structure

```
my-fhevm-project/
├── contracts/          # Solidity source files
├── test/               # Test files (TypeScript)
├── deploy/             # Deployment scripts (hardhat-deploy)
├── tasks/              # Hardhat custom tasks
├── types/              # Auto-generated TypeChain types (after compile)
├── hardhat.config.ts
├── tsconfig.json
├── package.json
└── .solhint.json       # Solidity linting rules
```

### Key npm scripts

```bash
npm run compile         # Compile contracts + generate TypeChain types
npm run test            # Run tests against local mock FHE
npm run test:sepolia    # Run tests against Sepolia (real FHE)
npm run deploy:localhost # Deploy to local hardhat node
npm run deploy:sepolia  # Deploy to Sepolia testnet
npm run lint            # Lint Solidity + TypeScript + Prettier
npm run coverage        # Generate code coverage report
npm run chain           # Start local hardhat node
```

### TypeScript configuration

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "commonjs",
    "lib": ["es2022"],
    "strict": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "dist"
  },
  "include": ["src/**/*", "tasks/**/*", "test/**/*", "deploy/**/*", "types/**/*"],
  "files": ["hardhat.config.ts"]
}
```

### Solidity linting (.solhint.json)

```json
{
  "extends": "solhint:recommended",
  "rules": {
    "code-complexity": ["error", 8],
    "compiler-version": ["error", ">=0.8.4"],
    "max-line-length": ["error", 120],
    "func-visibility": ["error", {"ignoreConstructors": true}],
    "no-console": "off",
    "not-rely-on-time": "off"
  }
}
```

---

## Full-Stack Project (Hardhat + Next.js)

### From template

```bash
git clone https://github.com/zama-ai/fhevm-react-template.git my-fhevm-dapp
cd my-fhevm-dapp
pnpm install
```

### Monorepo structure

```
my-fhevm-dapp/
├── packages/
│   ├── nextjs/           # Next.js 15 frontend
│   │   ├── app/          # App Router pages
│   │   ├── components/   # React components
│   │   ├── hooks/        # Custom hooks (including FHEVM integration)
│   │   ├── services/     # Web3 config (Wagmi, RainbowKit)
│   │   ├── contracts/    # Deployed contract ABIs and addresses
│   │   └── utils/        # Helper utilities
│   └── fhevm-sdk/        # FHEVM React hooks wrapper
│       └── src/
│           ├── react/    # useFhevm, useFHEEncryption, useFHEDecrypt
│           ├── internal/ # FhevmInstance creation, public key storage
│           └── storage/  # In-memory storage for decryption signatures
├── contracts/            # Solidity contracts (shared with Hardhat)
├── deploy/               # Deployment scripts
├── test/                 # Contract tests
├── hardhat.config.ts
├── pnpm-workspace.yaml
└── package.json
```

### Key frontend dependencies (exact versions)

```
next: ~15.2.3
react: ~19.0.0
wagmi: 2.16.4
viem: 2.34.0
@rainbow-me/rainbowkit: 2.2.8
@tanstack/react-query: ~5.59.15
@zama-fhe/relayer-sdk: 0.4.1
ethers: ^6.16.0
tailwindcss: 4.1.3
daisyui: 5.0.9
```

### Next.js configuration essentials

Turbopack needs aliases for Node.js built-ins that aren't available in the browser:
```typescript
// next.config.ts
const config = {
  experimental: {
    turbo: {
      resolveAlias: {
        fs: {browser: "./empty-module.js"},
        net: {browser: "./empty-module.js"},
        tls: {browser: "./empty-module.js"},
        child_process: {browser: "./empty-module.js"},
        worker_threads: {browser: "./empty-module.js"},
      },
    },
  },
};
```

### Scaffold configuration

```typescript
// scaffold.config.ts
const scaffoldConfig = {
  targetNetworks: [chains.hardhat, chains.sepolia],
  pollingInterval: 30000,
  alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ?? "",
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID ?? "",
  onlyLocalBurnerWallet: true,
};
```

### Branding configuration

Apply brand colors via DaisyUI theme in your Tailwind config:

```typescript
// tailwind.config.ts
export default {
  plugins: [require("daisyui")],
  daisyui: {
    themes: [{
      app: {
        ...require("daisyui/src/theming/themes")["night"],
        primary: "#FFD208",          // Replace with brand color
        "primary-content": "#1a1a2e",
        secondary: "#A38025",
        accent: "#00BCD4",
      },
    }],
  },
};
```

### Responsive breakpoints (Tailwind 4 defaults)

| Breakpoint | Min width | Usage |
|-----------|-----------|-------|
| `sm:` | 640px | Small tablets |
| `md:` | 768px | Tablets |
| `lg:` | 1024px | Laptops |
| `xl:` | 1280px | Desktops |
| `2xl:` | 1536px | Large screens |

Design mobile-first: base styles for phones, then add `md:` and `lg:` modifiers for larger screens.
