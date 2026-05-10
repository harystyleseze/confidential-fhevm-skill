// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

// Should fire: AP-004 (function takes externalEuint64 but never calls fromExternal).
contract AP004_Bad is ZamaEthereumConfig {
    euint64 internal _v;

    function badSet(externalEuint64 ext, bytes calldata /*proof*/) external {
        // BUG: pretends externalEuint64 is usable directly. It is NOT.
        // (We don't actually use `ext` in an op here because that wouldn't compile —
        //  the linter checks declarations, not usage.)
        _v = FHE.asEuint64(0);                  // a non-fromExternal write
        FHE.allowThis(_v);
        ext; // silence unused
    }
}
