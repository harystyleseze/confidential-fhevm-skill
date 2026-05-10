// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

// Should fire: AP-005 (FHE.div with an encrypted divisor).
contract AP005_Bad is ZamaEthereumConfig {
    euint64 internal _x;
    euint64 internal _y;

    function divide(externalEuint64 a, externalEuint64 b, bytes calldata p) external {
        _x = FHE.fromExternal(a, p);
        _y = FHE.fromExternal(b, p);
        // BUG: divisor `_y` is encrypted; only plaintext divisors are supported.
        euint64 q = FHE.div(_x, _y);
        FHE.allowThis(_x);
        FHE.allowThis(_y);
        FHE.allowThis(q);
    }
}
