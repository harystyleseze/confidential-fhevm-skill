# FHEVM Pitfall Catalog

16 pitfalls ordered by severity. Each includes the root cause, what goes wrong, and how to fix it.

---

## Critical Severity

### 1. Missing FHE.allowThis() after state mutation

**Root cause**: Every FHE operation returns a new handle with an empty ACL entry. The previous handle's permissions do not carry over.

**What goes wrong**: The contract writes an encrypted state variable, but doesn't grant itself permission on the new handle. The next transaction that reads this variable gets `bytes32(0)` (null handle) instead of the encrypted value. No revert occurs — the contract silently operates on invalid data. This typically corrupts all downstream state.

**Wrong:**
```solidity
function deposit(externalEuint64 amount, bytes calldata proof) external {
    euint64 val = FHE.fromExternal(amount, proof);
    _balance[msg.sender] = FHE.add(_balance[msg.sender], val);
    // Missing: FHE.allowThis(_balance[msg.sender]);
}
```

**Fixed:**
```solidity
function deposit(externalEuint64 amount, bytes calldata proof) external {
    euint64 val = FHE.fromExternal(amount, proof);
    _balance[msg.sender] = FHE.add(_balance[msg.sender], val);
    FHE.allowThis(_balance[msg.sender]);
    FHE.allow(_balance[msg.sender], msg.sender);
}
```

---

### 2. Using if/else with encrypted values

**Root cause**: `ebool` is an encrypted ciphertext handle (`bytes32`), not a Solidity `bool`. The EVM cannot evaluate it in a conditional statement.

**What goes wrong**: Either the code fails to compile (type mismatch), or it compiles but treats the `bytes32` handle as a non-zero integer — meaning the `if` branch always executes regardless of the encrypted value. The contract logic becomes deterministic and wrong.

**Wrong:**
```solidity
ebool hasFunds = FHE.ge(_balance[from], amount);
if (hasFunds) { // BROKEN: always true because handle is non-zero bytes32
    _balance[to] = FHE.add(_balance[to], amount);
}
```

**Fixed:**
```solidity
ebool hasFunds = FHE.ge(_balance[from], amount);
euint64 transfer = FHE.select(hasFunds, amount, FHE.asEuint64(0));
_balance[to] = FHE.add(_balance[to], transfer);
_balance[from] = FHE.sub(_balance[from], transfer);
```

---

### 3. Using require/revert with encrypted conditions

**Root cause**: `require` expects a `bool`. Even if you could evaluate an `ebool`, reverting on an encrypted condition would reveal information about the encrypted value (e.g., "the balance was insufficient").

**What goes wrong**: Compilation error (type mismatch) or, if cast to bool, always passes because the handle is non-zero. Either way, no actual validation occurs.

**Wrong:**
```solidity
require(FHE.le(amount, _balance[msg.sender]), "Insufficient funds");
```

**Fixed:**
```solidity
ebool sufficient = FHE.le(amount, _balance[msg.sender]);
euint64 safeAmount = FHE.select(sufficient, amount, FHE.asEuint64(0));
// Optionally record encrypted error code for the user to check
_lastError[msg.sender] = FHE.select(sufficient, NO_ERROR, INSUFFICIENT_FUNDS);
FHE.allowThis(_lastError[msg.sender]);
FHE.allow(_lastError[msg.sender], msg.sender);
```

---

### 4. Division with encrypted divisor

**Root cause**: The coprocessor does not support FHE division where both operands are encrypted. The mathematical complexity is prohibitive.

**What goes wrong**: Runtime panic (transaction fails with an opaque error).

**Wrong:**
```solidity
euint64 share = FHE.div(totalReward, encryptedParticipantCount);
```

**Fixed:**
```solidity
// Use a plaintext divisor
euint64 share = FHE.div(totalReward, 10); // divide by known count
// If the count is dynamic but public, use a uint:
euint64 share = FHE.div(totalReward, participantCount); // participantCount is uint, not euint
```

---

### 5. Not calling FHE.fromExternal on input parameters

**Root cause**: `externalEuint64` is a handle index into the input proof, not a usable encrypted value. Without `fromExternal`, the ZKPoK is not validated and the ciphertext is not registered with the coprocessor.

**What goes wrong**: Compilation error — `externalEuint64` cannot be used as `euint64` in FHE operations.

**Wrong:**
```solidity
function process(externalEuint64 input, bytes calldata proof) external {
    _value = FHE.add(_value, input); // Won't compile
}
```

**Fixed:**
```solidity
function process(externalEuint64 input, bytes calldata proof) external {
    euint64 val = FHE.fromExternal(input, proof);
    _value = FHE.add(_value, val);
    FHE.allowThis(_value);
}
```

---

## High Severity

### 6. Missing ZamaEthereumConfig inheritance

**Root cause**: `ZamaEthereumConfig` calls `FHE.setCoprocessor()` in its constructor, configuring the FHE library with network-specific coprocessor addresses.

**What goes wrong**: All `FHE.*` calls revert because the library doesn't know which coprocessor to communicate with.

**Wrong:**
```solidity
contract MyToken {
    euint64 _supply;
    function mint() external {
        _supply = FHE.asEuint64(1000); // Reverts
    }
}
```

**Fixed:**
```solidity
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract MyToken is ZamaEthereumConfig {
    euint64 _supply;
    function mint() external {
        _supply = FHE.asEuint64(1000); // Works
        FHE.allowThis(_supply);
    }
}
```

---

### 7. Silent arithmetic overflow

**Root cause**: FHE arithmetic wraps on overflow without reverting. Reverting would reveal information about the encrypted operands.

**What goes wrong**: Addition of two large values silently wraps to a small value. A token contract could create tokens out of thin air if overflow is not checked.

**Wrong:**
```solidity
_totalSupply = FHE.add(_totalSupply, mintAmount);
// If _totalSupply + mintAmount > 2^64, wraps to a small number
```

**Fixed:**
```solidity
euint64 newSupply = FHE.add(_totalSupply, mintAmount);
ebool overflowed = FHE.lt(newSupply, _totalSupply);
_totalSupply = FHE.select(overflowed, _totalSupply, newSupply);
// If overflow: supply unchanged (mint silently fails)
FHE.allowThis(_totalSupply);
```

---

### 8. Handle ordering mismatch in public decryption

**Root cause**: `FHE.checkSignatures` verifies a decryption proof that is cryptographically bound to a specific ordered sequence of handles. Reordering the handles invalidates the proof.

**What goes wrong**: `checkSignatures` reverts even though the cleartexts are correct. The error message is opaque.

**Wrong:**
```solidity
// publicDecrypt was called with [handleA, handleB]
// But checkSignatures uses reversed order:
handles[0] = FHE.toBytes32(_valueB);  // swapped
handles[1] = FHE.toBytes32(_valueA);  // swapped
FHE.checkSignatures(handles, encoded, proof); // REVERTS
```

**Fixed:**
```solidity
// Match the order used in publicDecrypt([handleA, handleB])
handles[0] = FHE.toBytes32(_valueA);
handles[1] = FHE.toBytes32(_valueB);
FHE.checkSignatures(handles, encoded, proof); // OK
```

---

### 9. Missing FHE.allow for user decryption

**Root cause**: The KMS checks the ACL before decrypting. Without `FHE.allow(handle, user)`, the user's decryption request is rejected.

**What goes wrong**: The user calls `token.balanceOf()` or `fhevm.userDecryptEuint()` and gets an "unauthorized" error. The encrypted value exists on-chain but the user cannot see it.

**Wrong:**
```solidity
_balance[user] = FHE.add(_balance[user], deposit);
FHE.allowThis(_balance[user]);
// Missing: FHE.allow(_balance[user], user);
```

**Fixed:**
```solidity
_balance[user] = FHE.add(_balance[user], deposit);
FHE.allowThis(_balance[user]);
FHE.allow(_balance[user], user);
```

---

## Medium Severity

### 10. Oversized encrypted types

**Root cause**: Larger types cost proportionally more gas on the coprocessor. Using `euint64` for a boolean flag wastes resources.

**What goes wrong**: Transactions are more expensive than necessary. No functional error, but unnecessary cost.

**Wrong:**
```solidity
euint64 isActive = FHE.asEuint64(1); // Using 64 bits for a boolean
```

**Fixed:**
```solidity
ebool isActive = FHE.asEbool(true); // 2 bits
```

---

### 11. Inefficient scalar operands

**Root cause**: `FHE.add(x, FHE.asEuint64(42))` first creates an encrypted ciphertext of 42, then adds two ciphertexts. `FHE.add(x, 42)` adds a plaintext scalar directly — one fewer coprocessor operation.

**What goes wrong**: Higher gas costs, no functional error.

**Wrong:**
```solidity
_count = FHE.add(_count, FHE.asEuint64(1));
```

**Fixed:**
```solidity
_count = FHE.add(_count, 1);
```

---

### 12. Calling FHE.rand* in view functions

**Root cause**: Random number generation updates the on-chain PRNG state. `view` functions run via `eth_call` which doesn't persist state changes.

**What goes wrong**: The function reverts or returns zero/invalid random values.

**Wrong:**
```solidity
function getRandomScore() external view returns (euint8) {
    return FHE.randEuint8(100); // Fails in view context
}
```

**Fixed:**
```solidity
function generateScore() external returns (euint8) {
    euint8 score = FHE.randEuint8(100);
    FHE.allowThis(score);
    FHE.allow(score, msg.sender);
    return score;
}
```

---

### 13. Not handling uninitialized encrypted values

**Root cause**: Solidity mappings return the zero value for unset keys. For `euint64`, this is `bytes32(0)` — a null handle, not an encryption of zero.

**What goes wrong**: Attempting to decrypt `ethers.ZeroHash` returns incorrect results or errors. FHE operations on a null handle may produce unexpected results.

**Wrong (test):**
```typescript
const enc = await contract.getBalance(newUser.address);
const clear = await fhevm.userDecryptEuint(FhevmType.euint64, enc, addr, newUser);
// Undefined behavior — enc is ZeroHash
```

**Fixed (test):**
```typescript
const enc = await contract.getBalance(newUser.address);
if (enc === ethers.ZeroHash) {
  // Balance was never set — treat as zero
} else {
  const clear = await fhevm.userDecryptEuint(FhevmType.euint64, enc, addr, newUser);
}
```

---

### 14. Missing FHE.allowTransient for returned values

**Root cause**: When a function returns an encrypted handle to a calling contract, that caller needs permission to use it within the same transaction.

**What goes wrong**: The calling contract receives a handle it cannot use — operations on it fail silently or revert.

**Wrong:**
```solidity
function computeReward() external returns (euint64) {
    euint64 reward = FHE.mul(_base, 2);
    return reward; // Caller cannot use this handle
}
```

**Fixed:**
```solidity
function computeReward() external returns (euint64) {
    euint64 reward = FHE.mul(_base, 2);
    FHE.allowTransient(reward, msg.sender);
    return reward;
}
```

---

### 15. Wrapping non-standard ERC-20 tokens

**Root cause**: The ERC-7984 wrapper assumes `transferFrom(from, to, amount)` moves exactly `amount` tokens. Fee-on-transfer tokens deliver less; rebasing tokens change balances independently.

**What goes wrong**: The wrapper's accounting becomes inconsistent. More confidential tokens may be created than the wrapper holds in ERC-20 backing — users cannot fully unshield.

**Prevention**: Only wrap standard ERC-20 tokens. Verify the token contract does not have transfer fees, rebasing mechanisms, or deflationary burns.

---

### 16. ERC-7984 tokens exceeding 6 decimals

**Root cause**: `euint64` has a max of ~1.8e19. With 7 decimals, max supply is ~1.84 billion tokens. With 18 decimals, max supply is ~18.4 tokens. Six decimals is the practical maximum.

**What goes wrong**: Token amounts overflow in basic arithmetic (transfers, minting), silently wrapping to incorrect values.

**Prevention**: Always set `decimals()` to return 6 or fewer. When wrapping an 18-decimal ERC-20, the wrapper uses a conversion rate of 10^12.
