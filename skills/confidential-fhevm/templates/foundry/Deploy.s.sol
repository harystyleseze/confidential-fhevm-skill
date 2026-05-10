// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Foundry deploy script template. Used by both `pnpm deploy:localhost` (anvil)
// and `pnpm deploy:sepolia`.
//
// The `fhevm-react-template` ships `scripts/deploy-localhost.sh` and
// `scripts/deploy-sepolia.sh` that invoke forge scripts and then regenerate
// `packages/nextjs/contracts/<Name>.ts` + `<Name>.local.ts` from broadcast
// receipts. To wire a new contract in, add a forge-script call to the shell
// scripts after the existing FHECounter line — see
// references/08-deployment.md for the canonical pattern.

import {Script, console} from "forge-std/Script.sol";
import {MyContract} from "../src/MyContract.sol";

contract DeployMyContract is Script {
    function run() external returns (MyContract instance) {
        vm.startBroadcast();
        instance = new MyContract();
        console.log("MyContract deployed at:", address(instance));
        console.log("Owner:", msg.sender);
        vm.stopBroadcast();
    }
}
