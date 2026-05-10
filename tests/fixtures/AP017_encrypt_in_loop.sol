// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

// Should fire: AP-017 (FHE.asEuint64 inside loop body).
contract AP017_Bad is ZamaEthereumConfig {
    euint64[] internal _items;

    function loadMany() external {
        for (uint256 i = 0; i < 10; i++) {
            // BUG: re-encrypting on every iteration is a gas bomb.
            _items.push(FHE.asEuint64(uint64(i)));
        }
    }
}
