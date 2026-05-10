# 11 — FHEVM Pitfall Catalog

Twenty-two pitfalls ordered by severity, then by toolchain. Each entry has root cause, what goes wrong, and how to fix it. The codes that `fhevm-lint` enforces mechanically (AP-001..AP-021) are referenced inline; the rest are documented for human reviewers.

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

---

## Track-aware pitfalls

These cover tooling-specific failure modes (Foundry vs. Hardhat, SDK v3 vs. v2). Each is enforced by `fhevm-lint` where mechanically detectable; the rest are documented in `references/15-failure-modes.md`.

### 17. Single shared `bytes inputProof` for multiple ciphertexts breaks Foundry tests

**Root cause**: `forge-fhevm`'s cleartext-mode helpers `encryptBool` / `encryptUint*` / `encryptAddress` each return a separate `(externalE*, bytes proof)` pair. There is no batched-input helper. If a contract function takes a single `bytes calldata inputProof` and passes it to multiple `FHE.fromExternal(...)` calls, the second call reverts with `InvalidInputHandle()` because its proof was never produced for that handle.

**What goes wrong**: The contract compiles, the Hardhat mock test passes (because the JS mock batches all ciphertexts under one proof), but the Foundry test reverts immediately. Symptoms manifest only on the Foundry track.

**Wrong:**
```solidity
function vote(
    uint256 id,
    externalEbool   isYes, externalEuint64 weight,
    bytes calldata inputProof              // ❌ one proof, two ciphertexts
) external { ... }
```

**Fixed:**
```solidity
function vote(
    uint256 id,
    externalEbool   isYes,  bytes calldata isYesProof,
    externalEuint64 weight, bytes calldata weightProof   // ✅ one proof per ciphertext
) external { ... }
```

**On the frontend (SDK v3):** call `encrypt.mutateAsync(...)` once per ciphertext; pass each result's `handles[0]` + `inputProof` independently. This is one extra round-trip per submission, in exchange for full Foundry testability. See `references/13-foundry-toolchain.md` §4.

---

### 18. Direct `FHE.decrypt(...)` call in a production contract

**Root cause**: `FHE.decrypt(handle)` is a forge-fhevm cleartext-mode test helper that reads from the local `plaintexts(bytes32)` mapping the cleartext executor maintains. **The function does not exist on Sepolia or mainnet.** Production contracts must use the async gateway (`FHE.makePubliclyDecryptable` + off-chain `publicDecrypt` + on-chain `FHE.checkSignatures`) for public reveal, or grant user-level `FHE.allow(handle, user)` for browser-side user decryption.

**What goes wrong**: Contract compiles, tests pass on the local cleartext host, deploys to Sepolia, then reverts on the first call that exercises the decrypt path. Often caught only after deployment.

**Fixed (public reveal — 3-step async):**
```solidity
function requestReveal() external { FHE.makePubliclyDecryptable(_tally); }
function finalize(uint64 tally, bytes calldata proof) external {
    bytes32[] memory h = new bytes32[](1); h[0] = FHE.toBytes32(_tally);
    FHE.checkSignatures(h, abi.encode(tally), proof);
    _tallyClear = tally;
}
```

**Fixed (user decryption):** grant `FHE.allow(handle, user)` after writing the handle; the frontend uses `useUserDecrypt`.

Lint: AP-018 fires whenever a production contract calls `FHE.decrypt(...)`.

---

### 19. Deprecated SDK v2 hooks (`useFhevm`, `useFHEEncryption`, `useFHEDecrypt`)

**Root cause**: These hooks shipped in `@zama-fhe/react-sdk` v2 (the older API used by previous `fhevm-react-template` revisions). They were removed in v3; the current API is `useEncrypt`, `useUserDecrypt` + `useAllow` + `useIsAllowed`, `usePublicDecrypt`. The `<ZamaProvider>` replaces the imperative `useFhevm` hook.

**What goes wrong**: Importing the v2 names from `@zama-fhe/react-sdk` v3 produces a "module has no exported member" TypeScript error at build time. New code that copies from a v2 tutorial without migrating hits this immediately.

**Fixed:** see `references/14-sdk-v3-frontend.md` and `templates/sdk-v3/`. The 1:1 migration map is in `14-sdk-v3-frontend.md` §1.

Lint: AP-019 catches imports of `useFhevm` / `useFHEEncryption` / `useFHEDecrypt` from `@zama-fhe/react-sdk` or `@zama-fhe/sdk`.

---

### 20. `await someHook.mutate(...)` instead of `mutateAsync`

**Root cause**: All TanStack-Query mutations expose two trigger functions: `mutate(input)` is fire-and-forget (returns void), `mutateAsync(input)` returns a `Promise` resolving to the result. Awaiting `mutate` gives `undefined`.

**What goes wrong**: Code that needs the result of `useEncrypt`, `usePublicDecrypt`, `useAllow`, etc. silently gets `undefined` and the next line throws on `undefined.handles` or similar. The error message points at the destructuring site, not the actual bug.

**Wrong:**
```typescript
const result = await encrypt.mutate({...});   // ❌ result is undefined
const handle = result.handles[0];               // throws
```

**Fixed:**
```typescript
const result = await encrypt.mutateAsync({...}); // ✅ returns the mutation result
const handle = result.handles[0];
```

Lint: AP-020 catches `await <name>.mutate(...)` in `.ts`/`.tsx`/`.js`/`.jsx`.

---

### 21. Missing `NEXT_PUBLIC_ALCHEMY_API_KEY` breaks the prod build

**Root cause**: The wagmi config in `fhevm-react-template/packages/nextjs/` has a runtime guard that throws when this env var is undefined during prod rendering. The guard fires even when the build only targets local anvil, because Next.js prerenders the page at build time.

**What goes wrong**: `pnpm next:build` (or `pnpm vercel`) fails with `Error: Environment variable NEXT_PUBLIC_ALCHEMY_API_KEY is required in production`. The dev server works fine; only the prod build breaks.

**Fixed:** Create `packages/nextjs/.env.local` with `NEXT_PUBLIC_ALCHEMY_API_KEY=local_placeholder`. A real Alchemy key is only required for actual Sepolia traffic; any non-empty string is enough to satisfy the build guard.

Lint: AP-021 fires when a file references `NEXT_PUBLIC_ALCHEMY_API_KEY` but no `.env` / `.env.local` exists in the directory tree.

---

### 22. `npm install` inside a pnpm workspace

**Root cause**: Mixing package managers in a workspace creates a `package-lock.json` next to the existing `pnpm-lock.yaml`. Pnpm subsequently refuses to link binaries from the npm-installed package into `node_modules/.bin/`.

**What goes wrong**: A package that declares `"bin": { ... }` in its `package.json` (e.g. this skill's `fhevm-lint`) installs into `node_modules/` but `npx <bin-name>` reports "command not found". The package's source is on disk; the binary just isn't symlinked.

**Fixed:** Use the same package manager as the workspace. For the React template (pnpm workspace), install dev deps from the workspace root:
```bash
pnpm add -w --save-dev github:harystyleseze/confidential-fhevm-skill
```
Or filter into a specific package: `pnpm --filter ./packages/foundry add --save-dev <pkg>`.

Lint: not detected by `fhevm-lint` (it's a tooling-layer issue, not a code issue). `references/15-failure-modes.md` §1 has the symptom and fix.
