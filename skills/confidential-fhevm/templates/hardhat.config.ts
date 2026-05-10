import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import type {HardhatUserConfig} from "hardhat/config";
import {vars} from "hardhat/config";
import "solidity-coverage";

// Run `npx hardhat vars setup` to see required variables.
const MNEMONIC: string =
  vars.get("MNEMONIC", "test test test test test test test test test test test junk");
const INFURA_API_KEY: string =
  vars.get("INFURA_API_KEY", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz");

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  namedAccounts: {deployer: 0},

  // Etherscan V2 (since May 2025): single API key for all networks.
  // Per-network keys are deprecated.
  etherscan: {
    apiKey: vars.get("ETHERSCAN_API_KEY", ""),
  },
  // Sourcify is a no-API-key fallback verifier. Recommended.
  sourcify: {enabled: true},

  gasReporter: {
    currency: "USD",
    enabled: !!process.env.REPORT_GAS,
  },

  networks: {
    hardhat: {
      accounts: {mnemonic: MNEMONIC},
      chainId: 31337,
    },
    anvil: {
      accounts: {mnemonic: MNEMONIC, path: "m/44'/60'/0'/0/", count: 10},
      chainId: 31337,
      url: "http://localhost:8545",
    },
    sepolia: {
      accounts: {mnemonic: MNEMONIC, path: "m/44'/60'/0'/0/", count: 10},
      chainId: 11155111,
      url: `https://sepolia.infura.io/v3/${INFURA_API_KEY}`,
    },
  },

  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },

  solidity: {
    version: "0.8.27",
    settings: {
      metadata: {bytecodeHash: "none"},
      optimizer: {enabled: true, runs: 800},
      evmVersion: "cancun",
    },
  },

  typechain: {outDir: "types", target: "ethers-v6"},
};

export default config;
