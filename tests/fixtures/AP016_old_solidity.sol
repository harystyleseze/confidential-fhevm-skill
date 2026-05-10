// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Should fire: AP-016 (Solidity below 0.8.24).
import {FHE} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract AP016_Bad is ZamaEthereumConfig {}
