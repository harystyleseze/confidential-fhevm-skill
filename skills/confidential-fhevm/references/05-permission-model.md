# FHEVM Permission Model (ACL)

## Why Permissions Exist

Encrypted handles are stored on a public blockchain — anyone can see them. But a handle alone is useless without the ability to decrypt it. The ACL (Access Control List) contract tracks which addresses are authorized to request decryption of each handle from the KMS.

The critical design decision: **every new handle starts with zero permissions.** When `FHE.add(a, b)` returns handle `c`, neither the contract, the caller, nor anyone else has permission on `c` — even if they had permission on `a` and `b`. This is because `c` is a completely new ciphertext in the coprocessor, unrelated to the ACL entries of its operands.

## Permission Functions

### FHE.allowThis(handle)

Grants the **current contract** permanent access to this handle.

```solidity
_balance = FHE.add(_balance, deposit);
FHE.allowThis(_balance);
// Without this, the contract cannot read _balance in the next transaction.
```

**When to call**: After every encrypted state variable write. No exceptions.

**What happens without it**: The next transaction that reads `_balance` gets `bytes32(0)` (null handle) instead of the actual encrypted value. This is a silent failure — no revert, no error.

Equivalent to `FHE.allow(handle, address(this))`.

### FHE.allow(handle, address)

Grants a specific address permanent access to this handle. The address can then request decryption through the KMS.

```solidity
FHE.allow(_salary[employee], employee);
// Now the employee can decrypt their salary off-chain via the SDK.

FHE.allow(_salary[employee], manager);
// The manager can also decrypt this employee's salary.
```

**When to call**: Whenever a user or external contract needs to decrypt or operate on this handle.

### FHE.allowTransient(handle, address)

Grants temporary access for the **current transaction only**. Uses EIP-1153 transient storage — cheaper than permanent `allow` because the storage is automatically cleared at the end of the transaction.

```solidity
function computeBonus(address employee) external returns (euint64) {
    euint64 bonus = FHE.mul(_salary[employee], 10); // 10x salary as bonus
    FHE.allowTransient(bonus, msg.sender);
    // The caller can use this handle within this transaction,
    // but the permission disappears after the transaction ends.
    return bonus;
}
```

**When to call**: When returning encrypted values to a calling contract, or when a value only needs to be accessible within the current transaction (e.g., intermediate computation passed between internal functions in different contracts).

### FHE.makePubliclyDecryptable(handle)

Permanently marks a handle as decryptable by anyone. This is a one-way action — once public, it cannot be made private again.

```solidity
function revealWinner() external {
    require(block.timestamp >= auctionEnd, "Too early");
    FHE.makePubliclyDecryptable(_highestBid);
    FHE.makePubliclyDecryptable(_highestBidder);
}
```

**When to call**: When a value needs to be revealed to everyone (election results, auction winners, game outcomes).

### Permission checks

```solidity
bool hasAccess = FHE.isAllowed(handle, someAddress);
bool callerAllowed = FHE.isSenderAllowed(handle);
```

### Method chaining

All permission functions support chaining via `using FHE for *`:

```solidity
using FHE for *;

_balance.allowThis().allow(msg.sender);
result.allowTransient(msg.sender).allowTransient(otherContract);
_winner.makePubliclyDecryptable();
```

## Lifecycle of a Ciphertext's Permissions

```
1. User encrypts value client-side
   → externalEuint64 handle arrives in contract function

2. FHE.fromExternal(handle, proof) validates and registers ciphertext
   → Returns internal euint64 with ZERO permissions

3. Contract stores: _data[key] = value
   → Must call FHE.allowThis(_data[key]) or contract loses access

4. Contract grants user access: FHE.allow(_data[key], user)
   → User can now request decryption via SDK

5. FHE operation: _data[key] = FHE.add(_data[key], increment)
   → Result is a NEW handle with ZERO permissions
   → Must repeat steps 3-4 for the new handle

6. User decryption: SDK sends EIP-712 signed request to KMS
   → KMS checks ACL: is this user allowed for this handle?
   → If yes: threshold decryption returns plaintext
   → If no: request rejected
```

## Common Permission Patterns

### Single-owner value (e.g., a user's encrypted balance)
```solidity
FHE.allowThis(handle);           // contract keeps access
FHE.allow(handle, owner);        // owner can decrypt
```

### Multi-party value (e.g., salary visible to employee and HR)
```solidity
FHE.allowThis(handle);
FHE.allow(handle, employee);
FHE.allow(handle, hrManager);
FHE.allow(handle, cfo);
```

### Intermediate computation result (returned to caller)
```solidity
FHE.allowTransient(handle, msg.sender); // caller uses it in same tx
// No FHE.allowThis needed if the contract doesn't store it
```

### Value about to be publicly revealed
```solidity
FHE.makePubliclyDecryptable(handle);
// No need for individual allow — anyone can decrypt now
```
