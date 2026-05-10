// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

// Should fire: AP-001 (writes encrypted state but never calls FHE.allowThis).
contract AP001_Bad is ZamaEthereumConfig {
    mapping(address => euint64) private _balances;

    function deposit(externalEuint64 amount, bytes calldata proof) external {
        euint64 v = FHE.fromExternal(amount, proof);
        _balances[msg.sender] = FHE.add(_balances[msg.sender], v);
        // BUG: missing FHE.allowThis(_balances[msg.sender]);
    }
}
