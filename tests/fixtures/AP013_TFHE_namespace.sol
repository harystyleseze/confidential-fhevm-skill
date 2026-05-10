// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Should fire: AP-013 (deprecated TFHE.* namespace) and AP-014 (deprecated import path).
import "fhevm/lib/TFHE.sol";

contract AP013_Bad {
    function bad(uint64 a, uint64 b) external pure returns (uint64) {
        return TFHE.add(a, b);   // deprecated namespace
    }
}
