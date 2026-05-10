---
trigger: model_decision
description: Build, test, and deploy confidential smart contracts on Zama's FHEVM. Foundry track (forge-fhevm + SDK v3, current canonical) and Hardhat track (legacy). Encrypted types, ACL permissions, public/user decryption, ERC-7984 tokens, @zama-fhe/react-sdk v3 frontends. Pinned to @fhevm/solidity 0.11.1.
---

# FHEVM Development (Windsurf Rule)

Companion rule for the SKILL.md package at `skills/confidential-fhevm/`.

## Pick a track first
- **Foundry track (current canonical)** — `packages/foundry/` with forge-fhevm, `@zama-fhe/react-sdk` v3. See `references/13-foundry-toolchain.md` + `references/14-sdk-v3-frontend.md`.
- **Hardhat track (legacy)** — existing Hardhat repos, `@fhevm/hardhat-plugin`, SDK v2. See `references/02-project-setup.md` + `references/09-frontend-patterns.md`.

Contract Solidity API is identical between tracks; only tests, deploys, frontend hooks differ.

## Pinned versions
- `@fhevm/solidity ^0.11.1`
- `forge-fhevm eba2324` (Foundry track)
- `@fhevm/hardhat-plugin ^0.4.2` (Hardhat track)
- `@zama-fhe/sdk 3.0.0` / `@zama-fhe/react-sdk 3.0.0` (current frontend)
- Solidity 0.8.27, EVM cancun, optimizer 800 runs, `metadata.bytecodeHash: "none"` / `bytecode_hash = "none"`

## Always-apply fundamentals
- Encrypted types are `bytes32` handles. The coprocessor holds the ciphertext.
- Every new handle has zero ACL. After every state write call `FHE.allowThis(handle)` and, when a user must decrypt, `FHE.allow(handle, user)`.
- Never branch on `ebool` — use `FHE.select(cond, ifTrue, ifFalse)`.
- Decryption is async: user-decrypt (EIP-712 + KMS) or public-decrypt (3 steps: `makePubliclyDecryptable` → off-chain `publicDecrypt` → on-chain `checkSignatures`).

## Mandatory contract rules
- Inherit `ZamaEthereumConfig` on every contract using `FHE.*`.
- Validate every `externalEuint*` with `FHE.fromExternal(handle, inputProof)` before use.
- Never `if` / `else` / `require` / `revert` on an `ebool`.
- Scalar literals on the right side of FHE ops.
- `FHE.div` / `FHE.rem` only accept plaintext divisors.
- `FHE.rand*` only inside state-changing functions.
- Returns to other contracts need `FHE.allowTransient(handle, msg.sender)`.
- Never call `FHE.encrypt*` / `FHE.asEuint*` inside a loop body.
- Production contracts must not call `FHE.decrypt(...)` directly.
- **Prefer one `bytes` proof per ciphertext** — works in both tracks, required for full Foundry-cleartext testability.

## Mandatory frontend rules (SDK v3)
- Do not import the v2 hooks `useFhevm`, `useFHEEncryption`, `useFHEDecrypt`. Use `useEncrypt`, `useUserDecrypt` + `useAllow` + `useIsAllowed`, `usePublicDecrypt`.
- Always `await hook.mutateAsync({...})`. `mutate(...)` is fire-and-forget.
- Cap `gas` on FHE write calls (`gas: 15_000_000n` for Sepolia).
- Gate `useUserDecrypt` on `handle !== ZERO_HANDLE`.
- For ERC-7984: use `useShield` / `useUnshield` / `useConfidentialBalance` / `useConfidentialTransfer`.

## Output contract
Every "build me a confidential X" prompt produces all eight:
1. Contract — `packages/foundry/src/<Name>.sol` (Foundry) or `contracts/<Name>.sol` (Hardhat)
2. Test — `packages/foundry/test/<Name>.t.sol` (FhevmTest) or `test/<Name>.test.ts` (mock)
3. Deploy script — `Deploy<Name>.s.sol` + `run_forge` lines in BOTH `scripts/deploy-localhost.sh` AND `scripts/deploy-sepolia.sh` (Foundry); or `deploy/01_<name>.ts` (Hardhat)
4. Frontend hook + page — `packages/nextjs/hooks/<feature>/use<Name>.tsx` + `packages/nextjs/app/page.tsx` (the new dApp IS the home route — replace `app/page.tsx`)
5. Home-route wiring — visiting `localhost:3000` must show the new dApp, not the default counter; bare sub-routes are a contract violation
6. Deploy artifacts — `.env.example` (`SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, optional `ETHERSCAN_API_KEY`) + `## Live demo` placeholder in README + `next.config.ts` mitigations from `templates/sdk-v3/next.config.ts`
7. UX baseline — built from `templates/sdk-v3/page.tsx`: hero on disconnect, `LifecycleStepper`, `RoleBanner` (incl. spectator + local-dev onboarding on chain 31337), one primary CTA per state, `CopyableCode` chips for handles, `HowItWorks` collapsible. Disabled buttons are NOT a substitute for role-aware empty states.
8. Lint clean — `npx fhevm-lint packages/foundry/src/ packages/nextjs/` returns 0 CRITICAL/HIGH

Never invent secrets. When env vars are missing, ask the user to fill `.env.local`, then proceed.

## Validation hook
Before responding with code:
```bash
npx fhevm-lint <path>
```
Fix every CRITICAL and HIGH finding before returning.

## Deeper references
- `skills/confidential-fhevm/SKILL.md`
- `skills/confidential-fhevm/references/13-foundry-toolchain.md`
- `skills/confidential-fhevm/references/14-sdk-v3-frontend.md`
- `skills/confidential-fhevm/references/15-failure-modes.md`
- `skills/confidential-fhevm/references/16-deployment-workflow.md`
- `skills/confidential-fhevm/references/17-ux-patterns.md`
- `skills/confidential-fhevm/references/06-writing-contracts.md`
- `skills/confidential-fhevm/references/05-permission-model.md`
- `skills/confidential-fhevm/references/11-pitfall-catalog.md`
- `skills/confidential-fhevm/references/10-erc7984-confidential-tokens.md`
- `skills/confidential-fhevm/templates/foundry/`
- `skills/confidential-fhevm/templates/sdk-v3/`
- `skills/confidential-fhevm/examples/foundry/confidential-voting.md`
- `skills/confidential-fhevm/scripts/fhevm-lint.js`
