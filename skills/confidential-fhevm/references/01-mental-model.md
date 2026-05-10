# 01 — FHEVM Mental Model

> Open when explaining the architecture, debugging unexpected reverts, or onboarding a developer new to FHE.

## Contents
- The four invariants
- What lives where (on-chain vs off-chain)
- Lifecycle of a single encrypted value
- The two decryption paths
- When the mock and the real network diverge

---

## The four invariants

1. **Handles, not values.** Encrypted types (`euint8`, `euint16`, …, `euint256`, `ebool`, `eaddress`) appear as `bytes32` handles on-chain. The actual ciphertext lives in the off-chain coprocessor. Solidity code only ever moves handles around.

2. **New handles have zero permissions.** Every `FHE.*` call that produces a new value (`add`, `select`, `fromExternal`, `randEuint*`, …) returns a fresh handle with an empty ACL. Permissions never propagate. After every state write, you must explicitly call `FHE.allowThis(handle)` (so the contract can read its own state next tx) and, if the user needs to see the value, `FHE.allow(handle, user)`.

3. **No branching on encrypted booleans.** `ebool` is a ciphertext, not a Solidity `bool`. The EVM cannot evaluate it. `if (eboolVar)` is a compile-time error or — worse — silently wrong (the compiler treats the handle as a non-zero integer and always takes the "true" branch). Use `FHE.select(condition, ifTrue, ifFalse)`. Both branches execute; the coprocessor picks the result inside the ciphertext.

4. **Decryption is explicit and async.** Plaintext only appears in two places: the user's browser (after EIP-712-authorised user decryption) or back in Solidity (after a three-step public decryption ceremony with KMS proofs). The contract never automatically sees plaintext.

## What lives where

| Layer | Lives | Sees |
| --- | --- | --- |
| User browser | locally | plaintext, after user decryption |
| Smart contract | on-chain | handles only |
| Coprocessor | off-chain (Zama infra) | ciphertexts, performs FHE math |
| KMS (Key Management System) | off-chain (threshold) | partial decryption shares; signs proofs |
| Relayer | off-chain | coordinates SDK ↔ Coprocessor ↔ KMS |
| ACL contract | on-chain | permission grants per handle |

## Lifecycle of a single encrypted value

1. **Encryption (browser).** SDK takes a plaintext bigint and the network's public FHE key, produces `(handle, inputProof)`. The proof is bound to `(contractAddress, userAddress)`.
2. **Submission (tx).** User calls a function passing `externalEuintNN handle, bytes proof`. Contract calls `FHE.fromExternal(handle, proof)` — the coprocessor verifies the ZKPoK and returns a usable `euintNN`.
3. **State write.** Contract assigns to a state variable, then calls `FHE.allowThis(handle)` and any `FHE.allow(handle, address)` needed.
4. **Operations.** Subsequent FHE math produces new handles. After every state-writing op: `FHE.allowThis` + relevant `FHE.allow`.
5. **Decryption.** Either:
   - User decryption — wallet signs an EIP-712 message, KMS returns the cleartext to the browser only; *or*
   - Public decryption — `makePubliclyDecryptable` → off-chain `publicDecrypt` → on-chain `checkSignatures` to get cleartext usable in Solidity.

## When the mock and the real network diverge

The `@fhevm/hardhat-plugin` mock simulates FHE math in the JS runtime so tests run fast. Differences vs. Sepolia/mainnet:

- Mock decryption is synchronous; real decryption takes seconds to minutes.
- Mock ACL is permissive — easier to forget `FHE.allow(handle, user)` and have the test still pass. **Always test on Sepolia at least once before claiming done.**
- Mock keys are deterministic; real KMS uses threshold cryptography with multiple parties.
- `fhevm.isMock` returns `true` only on the local Hardhat network. Use it to gate fast-only tests with `this.skip();`.

See also: [`03-type-system.md`](03-type-system.md), [`05-permission-model.md`](05-permission-model.md), [`07-testing-guide.md`](07-testing-guide.md).
