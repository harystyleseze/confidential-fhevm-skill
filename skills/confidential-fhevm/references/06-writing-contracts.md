# 06 — Writing FHEVM Contracts: Pattern Catalogue

> Open whenever generating or reviewing Solidity that uses `FHE.*`. The contract patterns here are **track-agnostic** — they apply identically on Foundry (`forge-fhevm`) and Hardhat (`@fhevm/hardhat-plugin`). The Solidity API is unchanged between tracks.

Every snippet below assumes:
```solidity
import {FHE, euint8, euint64, externalEuint64, ebool, eaddress} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
```
…and that the contract inherits `ZamaEthereumConfig` (or the upgradeable variant). Without this inheritance, every `FHE.*` call reverts.

**One-vs-many input proofs.** Foundry's `forge-fhevm` cleartext-mode test helpers validate one ciphertext per proof. Hardhat's `fhevm.createEncryptedInput(...).addBool(...).add64(...).encrypt()` batches multiple ciphertexts into one proof. **For new code, prefer one proof per ciphertext** (one `bytes calldata <name>Proof` parameter per `externalEuintNN` parameter) — this design works in both tracks and is the only design that's fully testable in `forge-fhevm` cleartext mode. See [`13-foundry-toolchain.md`](13-foundry-toolchain.md) §4 for the rationale.

## Contents

1. Accept encrypted input from a user
2. Operate on encrypted values
3. Branch on encrypted conditions (FHE.select)
4. Handle errors without reverting
5. Generate verifiable randomness
6. Reveal encrypted data publicly (3-step async)
7. Pass encrypted values between contracts
8. Emit events with encrypted handles
9. Upgradeable contract with FHEVM
10. Batch-encrypt multiple values in one proof

---

## 1. Accept encrypted input from a user

Users encrypt values client-side using the network's public FHE key. The encrypted blob arrives as two parameters: an `externalEuintNN` (handle index within the proof) and `bytes calldata inputProof` (the ciphertext + a ZKPoK binding it to this contract and caller).

```solidity
function setSalary(
    address employee,
    externalEuint64 encryptedSalary,
    bytes calldata inputProof
) external onlyOwner {
    // fromExternal validates the ZKPoK, registers the ciphertext with the
    // coprocessor, and returns a usable euint64 handle.
    euint64 salary = FHE.fromExternal(encryptedSalary, inputProof);

    _salaries[employee] = salary;

    // The handle returned by fromExternal is brand new — zero permissions.
    FHE.allowThis(_salaries[employee]);            // contract can read it next tx
    FHE.allow(_salaries[employee], employee);      // employee can decrypt it
}
```

The proof is cryptographically bound to `(contractAddress, userAddress)`. Replaying it against a different contract or from a different address makes `FHE.fromExternal` revert.

## 2. Operate on encrypted values

FHE arithmetic works on handles. **Use the smallest type that fits your data range** — bigger types cost more gas on the coprocessor.

```solidity
function computeCompensation(address employee) internal returns (euint64) {
    euint64 base = _salaries[employee];
    // Scalar operand: cheaper than encrypting a constant (avoids extra ciphertext).
    // RHS may be a literal; the LHS must be the ciphertext.
    euint64 withBonus = FHE.add(base, 500);                 // base + 500 bonus
    euint64 capped    = FHE.min(withBonus, FHE.asEuint64(100_000));

    FHE.allowThis(capped);
    FHE.allow(capped, employee);
    return capped;
}
```

Supported arithmetic: `add`, `sub`, `mul`, `div` (plaintext divisor only), `rem` (plaintext divisor only), `neg`, `min`, `max`. **All arithmetic wraps silently on overflow** — there is no revert, because revealing overflow would leak information about the encrypted values.

Overflow-safe pattern:
```solidity
euint64 sum        = FHE.add(a, b);
ebool   overflowed = FHE.lt(sum, a);             // sum < a ⇒ overflow occurred
euint64 safeSum    = FHE.select(overflowed, a, sum);  // keep original if overflow
```

## 3. Branch on encrypted conditions (FHE.select)

You cannot use `if`/`else`/`require` on encrypted values. Use `FHE.select`:

```solidity
function distributePayment(address employee, euint64 available) internal {
    euint64 salary  = _salaries[employee];
    ebool   canPay  = FHE.le(salary, available);
    // If yes, pay the salary; if no, pay zero.
    euint64 payment = FHE.select(canPay, salary, FHE.asEuint64(0));

    _balances[employee] = FHE.add(_balances[employee], payment);
    _treasury           = FHE.sub(_treasury, payment);

    // Every operation above created new handles. Refresh all permissions.
    FHE.allowThis(_balances[employee]);
    FHE.allow(_balances[employee], employee);
    FHE.allowThis(_treasury);
}
```

## 4. Handle errors without reverting

`require(encryptedCondition)` is impossible. Use encrypted error codes the user can decrypt:

```solidity
euint8 internal NO_ERROR;
euint8 internal INSUFFICIENT_FUNDS;
euint8 internal UNAUTHORIZED;

mapping(address => euint8) private _lastStatus;
event StatusUpdated(address indexed user);

constructor() {
    NO_ERROR            = FHE.asEuint8(0);
    INSUFFICIENT_FUNDS  = FHE.asEuint8(1);
    UNAUTHORIZED        = FHE.asEuint8(2);
    FHE.allowThis(NO_ERROR);
    FHE.allowThis(INSUFFICIENT_FUNDS);
    FHE.allowThis(UNAUTHORIZED);
}

function _recordStatus(euint8 code, address user) private {
    _lastStatus[user] = code;
    FHE.allowThis(code);
    FHE.allow(code, user);
    emit StatusUpdated(user);
}
```

## 5. Generate verifiable randomness

```solidity
function assignRandomScore(address player) external {
    // MUST be in a state-changing function — the PRNG state updates on-chain.
    // Calling from a view function fails because eth_call doesn't persist state.
    euint8 score = FHE.randEuint8(100);   // random value in [0, 99]
    _scores[player] = score;
    FHE.allowThis(score);
    FHE.allow(score, player);
}
```

Bounded random requires the upper bound to be a power of 2. Available: `randEbool`, `randEuint8`–`randEuint256`.

## 6. Reveal encrypted data publicly (3-step async)

When a contract needs to use a *decrypted* value in on-chain logic (not just show it to a user), use public decryption.

```solidity
// Step 1: Mark handles as publicly decryptable
function requestResultReveal() external {
    require(block.timestamp >= deadline, "Not yet");
    FHE.makePubliclyDecryptable(_encryptedWinner);
    FHE.makePubliclyDecryptable(_encryptedHighScore);
    emit RevealRequested(_encryptedWinner, _encryptedHighScore);
}

// Step 3: Verify decryption proof and use cleartexts
function finalizeResult(
    address winner,
    uint64 highScore,
    bytes calldata decryptionProof
) external {
    require(!finalized, "Already done");

    // Handle ordering MUST match the off-chain publicDecrypt call.
    // The proof is cryptographically bound to this exact ordering.
    bytes32[] memory handles = new bytes32[](2);
    handles[0] = FHE.toBytes32(_encryptedWinner);
    handles[1] = FHE.toBytes32(_encryptedHighScore);

    bytes memory encoded = abi.encode(winner, highScore);
    FHE.checkSignatures(handles, encoded, decryptionProof);
    // If the proof is invalid, this reverts.

    finalized = true;
    _winner = winner;
    _highScore = highScore;
}
```

Step 2 happens off-chain via the SDK:
```typescript
const results = await instance.publicDecrypt([winnerHandle, highScoreHandle]);
// results.clearValues, results.decryptionProof, results.abiEncodedClearValues
```

## 7. Pass encrypted values between contracts

When a function returns an encrypted handle to a calling contract, grant transient permission so the caller can use it within the same transaction:

```solidity
function computeReward(address employee) external returns (euint64) {
    euint64 reward = FHE.mul(_salaries[employee], 2);
    FHE.allowTransient(reward, msg.sender);   // caller can use this handle this tx
    return reward;
}
```

`FHE.allowTransient` uses EIP-1153 transient storage — cheaper than `FHE.allow`, auto-cleared after the transaction.

## 8. Emit events with encrypted handles

Events cannot contain readable encrypted values — they are bytes32 handles. Emit the handle so the frontend can listen and decrypt:

```solidity
event BalanceUpdated(address indexed user, euint64 newBalance);

function deposit(externalEuint64 amount, bytes calldata proof) external {
    euint64 val = FHE.fromExternal(amount, proof);
    _balances[msg.sender] = FHE.add(_balances[msg.sender], val);
    FHE.allowThis(_balances[msg.sender]);
    FHE.allow(_balances[msg.sender], msg.sender);
    emit BalanceUpdated(msg.sender, _balances[msg.sender]);  // handle, not cleartext
}
```

## 9. Upgradeable contract with FHEVM

```solidity
import {ZamaEthereumConfigUpgradeable} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Initializable}                  from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable}                from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract MyUpgradeable is Initializable, ZamaEthereumConfigUpgradeable, UUPSUpgradeable {
    function initialize(address admin) public initializer {
        __ZamaEthereumConfig_init();   // configures the coprocessor
        __UUPSUpgradeable_init();
    }
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
```

## 10. Batch-encrypt multiple values in one proof

```typescript
const encrypted = await fhevm
    .createEncryptedInput(contractAddress, signerAddress)
    .add64(salary)         // handles[0]
    .add8(department)      // handles[1]
    .addBool(isActive)     // handles[2]
    .encrypt();

// All three values share one inputProof
await contract.setEmployee(
    encrypted.handles[0],   // externalEuint64
    encrypted.handles[1],   // externalEuint8
    encrypted.handles[2],   // externalEbool
    encrypted.inputProof,   // single proof for all
);
```

For ERC-7984 specifically, see [`10-erc7984-confidential-tokens.md`](10-erc7984-confidential-tokens.md).
