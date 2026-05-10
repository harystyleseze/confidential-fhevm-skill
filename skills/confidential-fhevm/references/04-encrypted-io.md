# Encrypted I/O: Inputs and Decryption

## Input Flow: Client to Contract

When a user wants to send an encrypted value to a contract, three things must happen:

1. **Client-side encryption**: The SDK encrypts the plaintext using the network's public FHE key and generates a Zero-Knowledge Proof of Knowledge (ZKPoK) binding the ciphertext to a specific `(contractAddress, userAddress)` pair.

2. **On-chain validation**: The contract calls `FHE.fromExternal(externalHandle, inputProof)`. The InputVerifier contract on-chain validates the ZKPoK, confirming the ciphertext was correctly formed and is bound to this contract and caller.

3. **Coprocessor registration**: After validation, the ciphertext is registered with the coprocessor and a usable internal handle is returned.

### Why input proofs are bound to (contract, user)

This binding prevents replay attacks. Without it, an attacker could intercept your encrypted bid in a sealed-bid auction and submit it as their own bid from a different address. The ZKPoK proves: "I know the plaintext, I encrypted it specifically for this contract, and I am the specified sender." If any of these conditions change, `FHE.fromExternal` reverts.

### Contract-side: receiving encrypted inputs

```solidity
function deposit(
    externalEuint64 encryptedAmount,
    bytes calldata inputProof
) external {
    // Validates ZKPoK, registers ciphertext, returns usable handle
    euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
    // amount is now a euint64 handle usable in FHE operations
}
```

Multiple encrypted inputs share one proof:
```solidity
function complexAction(
    externalEuint64 encryptedA,
    externalEbool encryptedB,
    externalEuint8 encryptedC,
    bytes calldata inputProof  // single proof covers all three
) external {
    euint64 a = FHE.fromExternal(encryptedA, inputProof);
    ebool b = FHE.fromExternal(encryptedB, inputProof);
    euint8 c = FHE.fromExternal(encryptedC, inputProof);
}
```

### Client-side: creating encrypted inputs (Hardhat tests)

```typescript
import {fhevm} from "hardhat";

const encrypted = await fhevm
  .createEncryptedInput(contractAddress, signerAddress)
  .add64(depositAmount)    // handles[0] — euint64
  .addBool(isUrgent)       // handles[1] — ebool
  .add8(priority)          // handles[2] — euint8
  .encrypt();

await contract.connect(signer).complexAction(
  encrypted.handles[0],
  encrypted.handles[1],
  encrypted.handles[2],
  encrypted.inputProof,
);
```

The order of `.addNN()` calls determines the handle indices. The order does NOT need to match the function parameter order — you just need to pass the right handle to the right parameter.

### Client-side: creating encrypted inputs (@zama-fhe/sdk)

```typescript
const encrypted = await sdk.relayer.encrypt({
  values: [
    {value: depositAmount, type: "euint64"},
    {value: isUrgent, type: "ebool"},
  ],
  contractAddress,
  userAddress,
});
// encrypted.handles[0], encrypted.handles[1], encrypted.inputProof
```

---

## Output Flow: Decryption

### Path 1: User Decryption (private — only the user sees the result)

This is the most common decryption path. The user wants to see their own encrypted balance, salary, score, etc.

**Prerequisites**: The contract must have called `FHE.allow(handle, userAddress)` for this handle and user.

**How it works under the hood:**
1. The SDK generates an FHE keypair (public + private key) and caches it locally (encrypted with AES-GCM, key derived from the user's wallet signature via PBKDF2 with 600K iterations).
2. The SDK creates an EIP-712 typed message: "I authorize decryption of handles from these contracts, valid for N days."
3. The user signs the EIP-712 message with their wallet (one popup per session, cached for the TTL).
4. The SDK sends the signed request + handle(s) to the relayer.
5. The relayer forwards to the KMS, which validates: (a) the signature is valid, (b) the user has ACL permission, (c) the authorization hasn't expired.
6. The KMS performs threshold decryption and returns the plaintext.
7. The SDK returns the decrypted value to the application.

**In Hardhat tests:**
```typescript
import {FhevmType} from "@fhevm/hardhat-plugin";

const encHandle = await contract.getBalance(alice.address);
if (encHandle === ethers.ZeroHash) {
  // Never written — balance is zero
} else {
  const clearValue = await fhevm.userDecryptEuint(
    FhevmType.euint64,  // must match the on-chain type exactly
    encHandle,
    contractAddress,
    alice,               // must have FHE.allow permission
  );
}
```

**With @zama-fhe/sdk:**
```typescript
const token = sdk.createReadonlyToken(tokenAddress);
const balance = await token.balanceOf(); // auto-handles EIP-712
```

### Path 2: Public Decryption (everyone can see the result)

Used when the contract itself needs the plaintext for on-chain logic — revealing auction winners, election results, game outcomes.

**Step 1 — On-chain: mark handles as publicly decryptable**
```solidity
function requestReveal() external {
    FHE.makePubliclyDecryptable(_encryptedResult);
    emit RevealRequested(_encryptedResult);
}
```

**Step 2 — Off-chain: decrypt via relayer**
```typescript
const results = await instance.publicDecrypt([resultHandle]);
// results.clearValues[resultHandle] — the decrypted value
// results.decryptionProof — KMS signatures proving legitimate decryption
// results.abiEncodedClearValues — ABI-encoded cleartexts in handle order
```

**Step 3 — On-chain: verify and use**
```solidity
function finalizeReveal(
    uint64 clearResult,
    bytes calldata decryptionProof
) external {
    bytes32[] memory handles = new bytes32[](1);
    handles[0] = FHE.toBytes32(_encryptedResult);
    bytes memory encoded = abi.encode(clearResult);

    // Reverts if proof is invalid
    FHE.checkSignatures(handles, encoded, decryptionProof);

    // Now use clearResult in normal Solidity logic
    _publicResult = clearResult;
}
```

**Handle ordering is critical**: The `handles` array passed to `checkSignatures` must be in the exact same order as the handles passed to `publicDecrypt`. The proof is cryptographically bound to this ordering. Swapping two handles produces a valid-looking but cryptographically different proof, causing `checkSignatures` to revert.

### EIP-712 Message Structure (for reference)

The user decrypt authorization message:
```
Domain: { name: "Decryption", version: "1", chainId, verifyingContract: kmsVerifierAddress }
Type: UserDecryptRequestVerification {
  publicKey: bytes,
  contractAddresses: address[],
  startTimestamp: uint256,
  durationDays: uint256,
  extraData: bytes
}
```

The SDK manages this entirely — developers typically don't construct EIP-712 messages manually.
