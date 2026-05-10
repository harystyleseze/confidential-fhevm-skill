// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";

// Should fire: AP-003 (no ZamaEthereumConfig inheritance).
contract AP003_Bad {
    euint64 internal _v;

    function setIt(externalEuint64 a, bytes calldata p) external {
        _v = FHE.fromExternal(a, p);
        FHE.allowThis(_v);
    }
}
