// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

// Should fire: AP-018 (direct FHE.decrypt in production contract).
contract AP018_Bad is ZamaEthereumConfig {
    euint64 internal _v;

    function setIt(externalEuint64 a, bytes calldata p) external {
        _v = FHE.fromExternal(a, p);
        FHE.allowThis(_v);
    }

    function badReveal() external view returns (uint64) {
        // BUG: production contracts must use the async gateway / public-decrypt 3-step.
        return FHE.decrypt(_v);
    }
}
