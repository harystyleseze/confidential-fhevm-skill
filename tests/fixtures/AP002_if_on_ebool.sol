// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

// Should fire: AP-002 (require/if on an ebool).
contract AP002_Bad is ZamaEthereumConfig {
    euint64 internal _v;

    function compare(externalEuint64 a, bytes calldata p) external {
        euint64 x = FHE.fromExternal(a, p);
        ebool isHigher = FHE.gt(x, _v);
        require(isHigher, "must be higher");          // BUG: require on ebool
        if (FHE.lt(x, _v)) {                          // BUG: if on ebool
            _v = x;
        }
        FHE.allowThis(_v);
    }
}
