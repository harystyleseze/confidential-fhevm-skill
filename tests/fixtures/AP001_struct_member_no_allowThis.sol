// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

// Should fire: AP-001 (writes encrypted struct member but never calls FHE.allowThis).
// This regression covers the case where assignments target a struct field
// (`bag.balance = …` or `bags[id].balance = …`) rather than a top-level state var.
contract AP001_StructBad is ZamaEthereumConfig {
    struct Bag {
        euint64 balance;
        uint64 metadata;
    }

    mapping(uint256 => Bag) internal _bags;

    function deposit(uint256 id, externalEuint64 amount, bytes calldata proof) external {
        euint64 v = FHE.fromExternal(amount, proof);
        _bags[id].balance = FHE.add(_bags[id].balance, v);
        // BUG: missing FHE.allowThis(_bags[id].balance);
    }
}
