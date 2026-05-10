// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Foundry-track contract template. Same `@fhevm/solidity 0.11.1` API as the
// Hardhat track — only the surrounding tooling (forge-fhevm, foundry.toml,
// soldeer) differs.
import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title [Your Contract Name]
/// @notice [One-line description]
/// @dev forge-fhevm's cleartext-mode tests validate input proofs per-ciphertext,
///      so functions that accept multiple encrypted inputs should expose one
///      `bytes calldata proof` per ciphertext, not a single shared proof.
contract MyContract is ZamaEthereumConfig {
    mapping(address => euint64) private _values;
    address public owner;

    event ValueUpdated(address indexed user);
    error Unauthorized();

    constructor() {
        owner = msg.sender;
    }

    /// @notice Accept an encrypted value. Each ciphertext has its own proof so
    /// the function works both in forge-fhevm cleartext mode (one ciphertext per
    /// proof) and in the relayer SDK's batched-input mode (just call the SDK twice).
    function setValue(externalEuint64 encryptedValue, bytes calldata inputProof) external {
        euint64 value = FHE.fromExternal(encryptedValue, inputProof);
        _values[msg.sender] = FHE.add(_values[msg.sender], value);

        // MANDATORY: grant permissions on every new handle.
        FHE.allowThis(_values[msg.sender]);
        FHE.allow(_values[msg.sender], msg.sender);
        emit ValueUpdated(msg.sender);
    }

    /// @notice Returns the encrypted handle (decrypt off-chain via the SDK).
    function getValue(address user) external view returns (euint64) {
        return _values[user];
    }
}
