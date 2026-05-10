---
trigger: model_decision
description: Build, test, and deploy confidential smart contracts on Zama's FHEVM (encrypted types, ACL permissions, public/user decryption, ERC-7984, hardhat tests, @zama-fhe/sdk frontends). Pinned to @fhevm/solidity 0.11.1.
---

# FHEVM Development (Windsurf Rule)

Companion rule for the SKILL.md package at `skills/confidential-fhevm/`. The full skill, references, and worked examples are the canonical source — open them on demand.

## Pinned versions
- `@fhevm/solidity ^0.11.1`
- `@fhevm/hardhat-plugin ^0.4.2`
- `@zama-fhe/sdk 2.3.0` (or `@zama-fhe/relayer-sdk ^0.4.1`)
- Solidity `0.8.27`, EVM `cancun`, optimizer 800 runs, `metadata.bytecodeHash: "none"`
- ethers `^6.16.0`

## Always-apply fundamentals
- Encrypted types are `bytes32` handles. The coprocessor holds the ciphertext.
- Every new handle has zero ACL. After every state write call `FHE.allowThis(handle)` and, when a user must decrypt, `FHE.allow(handle, user)`.
- Never branch on `ebool` — use `FHE.select(cond, ifTrue, ifFalse)`. Both branches execute; coprocessor picks the result inside the ciphertext.
- Decryption is async: user-decrypt (EIP-712 + KMS, browser) or public-decrypt (3 steps: `makePubliclyDecryptable` → off-chain `publicDecrypt` → on-chain `checkSignatures`).

## Mandatory rules
- Inherit `ZamaEthereumConfig` (or `ZamaEthereumConfigUpgradeable`) on every contract using `FHE.*`.
- Validate every `externalEuint*` with `FHE.fromExternal(handle, inputProof)` before use.
- Never `if` / `else` / `require` / `revert` on an `ebool`.
- Use scalar literals on the right side of FHE ops (`FHE.add(cipher, 42)`).
- `FHE.div` / `FHE.rem` only accept plaintext divisors.
- `FHE.rand*` only inside state-changing functions.
- Uninitialised handles read as `ethers.ZeroHash` — check before decrypting.
- Returns to other contracts need `FHE.allowTransient(handle, msg.sender)`.
- Never call `FHE.encrypt*` / `FHE.asEuint*` inside a loop body (gas bomb).
- Production contracts must not call `FHE.decrypt(...)` directly.

## Output contract
For every "build me a confidential X" prompt, produce ALL of:
1. `contracts/<Name>.sol` (compiles)
2. `test/<Name>.test.ts` (mock; cover both branches of every `FHE.select`)
3. `deploy/01_<name>.ts` (hardhat-deploy)
4. `packages/nextjs/app/<route>/page.tsx` (encrypt → submit → decrypt with loading state)
5. Lint-clean: `npx fhevm-lint contracts/`

## Validation hook
Before responding with code:
```bash
npx fhevm-lint <path>
```
Fix every CRITICAL and HIGH finding before returning.

## Deeper references
- `skills/confidential-fhevm/SKILL.md`
- `skills/confidential-fhevm/references/06-writing-contracts.md`
- `skills/confidential-fhevm/references/05-permission-model.md`
- `skills/confidential-fhevm/references/11-pitfall-catalog.md`
- `skills/confidential-fhevm/references/10-erc7984-confidential-tokens.md`
- `skills/confidential-fhevm/scripts/fhevm-lint.js`
- `skills/confidential-fhevm/examples/`
