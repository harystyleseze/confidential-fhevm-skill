// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Import only the types you actually use.
// Available: ebool, euint8, euint16, euint32, euint64, euint128, euint256, eaddress
// External variants: externalEbool, externalEuint8, ..., externalEaddress
import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";

// DECISION: For non-upgradeable contracts, use ZamaEthereumConfig.
// For UUPS / transparent proxy contracts, use ZamaEthereumConfigUpgradeable
// and call __ZamaEthereumConfig_init() in your initializer.
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title [Your Contract Name]
/// @notice [One-line description of what this contract does]
contract MyContract is ZamaEthereumConfig {
    // --- State Variables ---
    // DECISION: Choose the smallest euint type that fits your data range.
    // ebool for flags, euint8 for 0-255, euint64 for token amounts.
    // Larger types cost more gas on the coprocessor.
    mapping(address => euint64) private _values;

    address public owner;

    // --- Events ---
    // Events CANNOT contain readable encrypted values — only handles.
    // Emit indexed addresses; users decrypt the values off-chain.
    event ValueUpdated(address indexed user);

    // --- Errors ---
    error Unauthorized();

    // --- Constructor ---
    constructor() {
        // ZamaEthereumConfig's constructor configures the coprocessor.
        owner = msg.sender;
    }

    // --- Accept encrypted input ---
    // Pattern: externalEuintNN + bytes calldata inputProof.
    // Always call FHE.fromExternal() first to validate the ZKPoK.
    function setValue(externalEuint64 encryptedValue, bytes calldata inputProof) external {
        euint64 value = FHE.fromExternal(encryptedValue, inputProof);

        _values[msg.sender] = FHE.add(_values[msg.sender], value);

        // MANDATORY: grant permissions on every new handle.
        FHE.allowThis(_values[msg.sender]);          // contract reads it next tx
        FHE.allow(_values[msg.sender], msg.sender);  // user can decrypt it

        emit ValueUpdated(msg.sender);
    }

    // --- View returning an encrypted handle ---
    // The returned euint64 is a bytes32 handle. Users decrypt off-chain via the SDK.
    function getValue(address user) external view returns (euint64) {
        return _values[user];
    }

    // --- Conditional update (FHE.select instead of if/else) ---
    function _conditionalUpdate(address user, euint64 threshold, euint64 newValue) internal {
        ebool meetsThreshold = FHE.ge(_values[user], threshold);
        // Both branches execute; coprocessor selects the correct result.
        _values[user] = FHE.select(meetsThreshold, newValue, _values[user]);

        FHE.allowThis(_values[user]);
        FHE.allow(_values[user], user);
    }
}
