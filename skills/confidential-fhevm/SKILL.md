---
name: confidential-fhevm
description: "Build, test, and deploy confidential smart contracts with Zama's FHEVM protocol on either the current Foundry track (forge-fhevm + @zama-fhe/sdk v3, matching the official fhevm-react-template today) or the Hardhat track (@fhevm/hardhat-plugin + @zama-fhe/sdk v2, for existing projects). Use when writing Solidity with encrypted types (ebool, euint8-256, eaddress), performing FHE operations (add, sub, mul, select, comparisons), managing ACL permissions (FHE.allow, allowThis, allowTransient), handling encrypted inputs (externalEuint + FHE.fromExternal), implementing public or user decryption, building ERC-7984 confidential tokens, testing in forge-fhevm cleartext mode or @fhevm/hardhat-plugin mock mode, deploying to local anvil/hardhat or Sepolia, integrating frontends with @zama-fhe/react-sdk v3 hooks (useEncrypt, useUserDecrypt, usePublicDecrypt, useAllow, useShield, useConfidentialBalance) or older @zama-fhe/sdk v2 patterns, or scaffolding new FHEVM projects. Pinned to @fhevm/solidity 0.11.1, forge-fhevm eba2324, @fhevm/hardhat-plugin 0.4.2, @zama-fhe/sdk 3.0.0, @zama-fhe/react-sdk 3.0.0, @zama-fhe/relayer-sdk 0.4.2 (template) / 0.4.1 (legacy), Solidity 0.8.27 (EVM cancun), Foundry forge 1.5+, Hardhat 2.28+, ethers 6, Next.js 15.2, React 19. Ships with an executable static linter (fhevm-lint) covering 20 anti-patterns across Solidity and frontend: missing FHE.allowThis, branching on ebool, missing ZamaEthereumConfig, FHE-encrypt-in-loop gas bombs, direct FHE.decrypt in production, deprecated TFHE.* namespace, deprecated SDK v2 hooks, awaited fire-and-forget mutate, missing NEXT_PUBLIC_ALCHEMY_API_KEY, and more."
---

# Confidential FHEVM Development

**Two supported toolchains, one Solidity API:**

- **Foundry track (current canonical)** — `forge-fhevm` for tests + cleartext-mode KMS proofs, `@zama-fhe/sdk` v3 + `@zama-fhe/react-sdk` v3 on the frontend. **Match this when starting from the official `fhevm-react-template` today.**
- **Hardhat track (existing projects)** — `@fhevm/hardhat-plugin` mocks, SDK v2 on the frontend. Still works; use it when integrating into a Hardhat repo.

Pinned versions: `@fhevm/solidity ^0.11.1` · `forge-fhevm eba2324` · `@fhevm/hardhat-plugin ^0.4.2` · `@zama-fhe/sdk 3.0.0` · `@zama-fhe/react-sdk 3.0.0` · `@zama-fhe/relayer-sdk 0.4.2` (template) / `^0.4.1` (legacy) · Solidity `0.8.27` (EVM `cancun`) · Foundry forge 1.5+ · Hardhat `^2.28.4` · ethers `^6.16.0` · Next.js 15.2 · React 19

> **Read this whole file once, then load referenced files on demand.** Every section ends with a link to deeper material — open it only when you need that specific topic. This file is the router; the references are the encyclopedia.

---

## 0. Quickstart

```bash
# Drop the skill in (Claude Code)
mkdir -p .claude/skills && cp -R confidential-fhevm .claude/skills/

# Drop the skill in (Cursor)
cp adapters/cursor/.cursor/rules/fhevm.mdc .cursor/rules/

# Drop the skill in (Windsurf)
cp adapters/windsurf/.windsurf/rules/fhevm.md .windsurf/rules/
```

Then prompt:
> "Write me a confidential voting contract using FHEVM. Members vote yes or no with encrypted weights, tally publicly after deadline."

You should get: `ConfidentialVoting.sol`, the matching test, deploy script, frontend hook + page — all `fhevm-lint` clean and ready to deploy.

**Pick a track before generating code.** If the project already has a `packages/foundry/foundry.toml`, target the Foundry track (see `references/13-foundry-toolchain.md`, `templates/foundry/`). If it has `hardhat.config.ts`, target the Hardhat track (see `references/02-project-setup.md`, `templates/contract.sol` / `test.ts` / `deploy.ts` / `page.tsx`).

---

## 1. Mental Model — How FHEVM Works

FHEVM lets smart contracts operate on encrypted data without ever seeing the plaintext. Five things make it fundamentally different from normal Solidity:

**Handles, not values.** On-chain, an `euint64` is a `bytes32` handle — a pointer to a ciphertext stored in Zama's off-chain coprocessor. `FHE.add(a, b)` sends both handles to the coprocessor, which performs homomorphic addition and returns a new handle `c`. Your contract only ever touches handles.

**Permissions gate decryption.** Every handle has an Access Control List (ACL) tracked on-chain. Only addresses with ACL permission can ask the Key Management System (KMS) to decrypt. **Critical consequence:** when `FHE.add(a, b)` produces handle `c`, that new handle has *zero* permissions — even if `a` and `b` had permissions for the contract. You must explicitly grant permissions on every new handle.

**No branching on encrypted conditions.** The EVM cannot evaluate an encrypted boolean. There is no way to write `if (FHE.le(amount, balance))` because the result of `FHE.le()` is an `ebool` — a ciphertext, not a Solidity `bool`. Use `FHE.select(condition, valueIfTrue, valueIfFalse)`. Both branches execute; the coprocessor selects the correct result inside the ciphertext.

**Decryption is explicit and async.** Two paths to plaintext:
- *User decryption* — the user signs an EIP-712 message authorising the KMS to decrypt handles they have ACL permission for. Off-chain, via the SDK. Contract just needs `FHE.allow(handle, user)`.
- *Public decryption* — three-step async: (1) contract calls `FHE.makePubliclyDecryptable(handle)`; (2) off-chain anyone calls `instance.publicDecrypt([handles])` to get cleartexts + KMS proof; (3) a contract function calls `FHE.checkSignatures(handles, abiEncodedCleartexts, proof)` to verify on-chain.

**Architecture flow:**
```
User browser
  └─ @zama-fhe/sdk encrypts inputs, signs EIP-712 for decryption
     └─ Smart Contract (inherits ZamaEthereumConfig)
        └─ @fhevm/solidity: FHE.add, FHE.select, FHE.allow, …
           └─ Coprocessor (off-chain) — performs FHE math
              └─ KMS — threshold decryption, validates signatures
                 └─ Relayer — coordinates SDK ↔ Coprocessor ↔ KMS
```

Deeper: [`references/01-mental-model.md`](references/01-mental-model.md), [`references/05-permission-model.md`](references/05-permission-model.md).

---

## 2. Project Setup

**Contract-only (Hardhat):**
```bash
git clone https://github.com/zama-ai/fhevm-hardhat-template.git my-project
cd my-project && npm install
npx hardhat vars set MNEMONIC          # wallet seed
npx hardhat vars set INFURA_API_KEY    # Sepolia RPC
```
Pre-configured: Solidity 0.8.27, EVM `cancun`, optimizer 800 runs, TypeChain ethers-v6.

**Full-stack — current canonical (Foundry + Next.js + SDK v3):**
```bash
git clone https://github.com/zama-ai/fhevm-react-template.git my-dapp
cd my-dapp
git submodule update --init --recursive    # (no-op on inline-contract revisions)
pnpm install
pnpm contracts:install                     # forge soldeer install — REQUIRED before `pnpm chain`
```
pnpm workspace: `packages/foundry` (forge-fhevm contracts + tests + scripts) and `packages/nextjs` (Next 15.2, React 19, wagmi 2.19, RainbowKit 2.2, Tailwind 4, DaisyUI 5, `@zama-fhe/react-sdk` v3). Local stack: `pnpm chain` brings up anvil + FHEVM cleartext host + `FHECounter` on port 8545.

**Full-stack — legacy (Hardhat + Next.js + SDK v2):** still supported for existing projects. See `references/02-project-setup.md` for the Hardhat-track scaffolding instructions.

**Adding to an existing Hardhat project:**
```bash
npm install @fhevm/solidity@^0.11.1 @fhevm/mock-utils@^0.4.2 encrypted-types@^0.0.4
npm install -D @fhevm/hardhat-plugin@^0.4.2
```
Add `import "@fhevm/hardhat-plugin";` to `hardhat.config.ts`. Set Solidity `0.8.27`, `evmVersion: "cancun"`, optimizer 800 runs, `metadata.bytecodeHash: "none"`.

Deeper: [`references/13-foundry-toolchain.md`](references/13-foundry-toolchain.md) for the current track, [`references/02-project-setup.md`](references/02-project-setup.md) for Hardhat, [`references/15-failure-modes.md`](references/15-failure-modes.md) when setup breaks.

---

## 3. Writing Contracts — Pattern Index

Every FHEVM contract inherits a network configuration:
```solidity
import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract MyContract is ZamaEthereumConfig {
    // ZamaEthereumConfig calls FHE.setCoprocessor() in its constructor.
    // Without this, every FHE.* call reverts.
}
```
Upgradeable: use `ZamaEthereumConfigUpgradeable` and call `__ZamaEthereumConfig_init()` in your initializer.

The full pattern catalogue lives at [`references/06-writing-contracts.md`](references/06-writing-contracts.md). It covers:

| Pattern | When to use |
| --- | --- |
| Accept encrypted input | User submits private data |
| Operate on encrypted values | Arithmetic, comparison, select |
| Branch on encrypted conditions | Replace `if`/`require` on `ebool` |
| Encrypted error codes | Surface failures without revealing them |
| Verifiable randomness | `FHE.randEuint*` in state-changing fns |
| Public decryption (3-step async) | Reveal final tallies / winners |
| Pass values between contracts | `FHE.allowTransient(handle, msg.sender)` |
| Emit events with handles | Frontend listens, decrypts on demand |
| Upgradeable contracts | UUPS / transparent proxy |
| Batch encrypt inputs | Multiple values share one proof |
| ERC-7984 wrapping | Wrap ERC-20 → confidential token |

For ERC-7984 specifically, see [`references/10-erc7984-confidential-tokens.md`](references/10-erc7984-confidential-tokens.md).

---

## 4. The Mandatory Rules — Post-Generation Checklist

After generating any FHEVM Solidity or frontend code, verify every rule. Each rule has a dedicated entry in [`references/11-pitfall-catalog.md`](references/11-pitfall-catalog.md) with root cause, failure mode, broken code, and fixed code. The executable linter (`scripts/fhevm-lint.js`) catches the mechanically-detectable violations across both `.sol` and `.ts`/`.tsx` files.

| # | Rule | Lint code | Scope |
| --- | --- | --- | --- |
| 1 | `FHE.allowThis(handle)` after every encrypted state write (incl. struct members) | AP-001 | Solidity |
| 2 | `FHE.allow(handle, user)` for every value the user must decrypt (auto-suppressed when the contract uses public decryption) | AP-008 | Solidity |
| 3 | Never use `if`/`else`/`require`/`revert` on encrypted values — use `FHE.select` | AP-002 | Solidity |
| 4 | Division/modulo require a plaintext divisor only | AP-005 | Solidity |
| 5 | Always call `FHE.fromExternal(externalEuintNN, proof)` on external inputs | AP-004 | Solidity |
| 6 | Every contract must inherit `ZamaEthereumConfig` (or `…Upgradeable`) | AP-003 | Solidity |
| 7 | ERC-7984 tokens use ≤6 decimals (`euint64` max ≈ 1.8e19) | — | Solidity |
| 8 | Arithmetic wraps silently on overflow — implement checks manually | — | Solidity |
| 9 | Use the smallest encrypted type that fits your data | AP-009 (info) | Solidity |
| 10 | Use scalar operands when one side is plaintext (cipher on LHS) | AP-010 | Solidity |
| 11 | Handle ordering in `checkSignatures` must match the `publicDecrypt` call | AP-007 | Solidity |
| 12 | `FHE.rand*` only works in state-changing functions | AP-011 | Solidity |
| 13 | Uninitialised encrypted variables return `ethers.ZeroHash` / `ZERO_HANDLE` | — | both |
| 14 | Returns to other contracts need `FHE.allowTransient(handle, msg.sender)` | AP-012 | Solidity |
| 15 | Only wrap standard ERC-20 (no fee-on-transfer / rebasing / deflationary) | — | Solidity |
| 16 | New ciphertexts have zero permissions — root cause for rules 1, 2, 14 | AP-001 | Solidity |
| 17 | Never call `FHE.encrypt*` / `FHE.asEuint*` inside a loop body | AP-017 | Solidity |
| 18 | Production contracts must not call `FHE.decrypt(...)` directly | AP-018 | Solidity |
| 19 | Never import SDK v2 hooks (`useFhevm`, `useFHEEncryption`, `useFHEDecrypt`) — use v3 equivalents | AP-019 | Frontend (TS/TSX) |
| 20 | Use `mutateAsync` (not `mutate`) when awaiting SDK v3 hook results | AP-020 | Frontend (TS/TSX) |
| 21 | `NEXT_PUBLIC_ALCHEMY_API_KEY` must be present (placeholder OK for localhost) | AP-021 | Frontend (config) |
| 22 | One `bytes` input proof per ciphertext on Foundry-track contracts (or single shared proof on the Hardhat track) — design for your test harness | — | Solidity |
| 23 | Use `pnpm add -w --save-dev <pkg>` in pnpm workspaces, not `npm install` | — | Tooling |

---

## 5. Testing

Tests run against a local FHEVM environment (fast, deterministic) or the real coprocessor on Sepolia (slow, requires funded wallet). The local harness differs by track:

**Foundry track (current):** `forge-fhevm`'s `FhevmTest` deploys the FHEVM host stack on anvil; helpers like `encryptUint64(value, user, contract)` produce per-ciphertext proofs, `decrypt(handle)` reads the cleartext, and `buildDecryptionProof(handles, abiEncoded)` produces a proof that `FHE.checkSignatures(...)` accepts on-chain. **This lets you unit-test the full public-decryption ceremony in cleartext mode** — see `references/13-foundry-toolchain.md` §5.

```solidity
import {FhevmTest} from "forge-fhevm/FhevmTest.sol";
import {euint64, externalEuint64, externalEbool} from "encrypted-types/EncryptedTypes.sol";

contract MyTest is FhevmTest {
    function setUp() public override { super.setUp(); /* deploy contract */ }

    function test_voteAccumulates() public {
        (externalEbool   encB, bytes memory bp) = encryptBool(true, alice, contractAddr);
        (externalEuint64 encW, bytes memory wp) = encryptUint64(100, alice, contractAddr);
        vm.prank(alice);
        contract.vote(0, encB, bp, encW, wp);                  // one proof per ciphertext
        assertEq(decrypt(contract.yesTally(0)), 100);
    }
}
```

**Hardhat track (legacy):** `@fhevm/hardhat-plugin`'s mock object batches multiple ciphertexts in a single proof via `fhevm.createEncryptedInput(...).add64(...).addBool(...).encrypt()`.

```typescript
import {expect} from "chai";
import {ethers, fhevm} from "hardhat";
import {FhevmType} from "@fhevm/hardhat-plugin";

describe("MyContract", function () {
  beforeEach(async function () { if (!fhevm.isMock) this.skip(); /* deploy */ });

  it("encrypts, calls, decrypts", async function () {
    const enc = await fhevm.createEncryptedInput(contractAddress, alice.address).add64(50_000n).encrypt();
    await contract.connect(alice).setSalary(employee, enc.handles[0], enc.inputProof);

    const handle = await contract.getBalance(alice.address);
    if (handle === ethers.ZeroHash) throw new Error("uninitialised");
    const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, alice);
    expect(clear).to.equal(50_000n);
  });
});
```

**Run:**
```bash
# Foundry track
forge test --match-contract MyTest -vv
pnpm contracts:test                # equivalent in the React template's workspace

# Hardhat track
npm run test                       # local mock — fast, no network
npm run test:sepolia               # real coprocessor — funded wallet required
```

Deeper: [`references/07-testing-guide.md`](references/07-testing-guide.md), [`references/13-foundry-toolchain.md`](references/13-foundry-toolchain.md).

---

## 6. Deployment

Local for development, Sepolia for demos/staging, mainnet for production. Etherscan V2 (May 2025+) uses a single API key — no per-network objects.

**Foundry track (current):** forge scripts + the React template's `pnpm` orchestration. The script `scripts/deploy-localhost.sh` runs the forge script AND regenerates the frontend's auto-managed `<Name>.ts` + `<Name>.local.ts` sidecars (see `references/08-deployment.md` for the auto-regeneration mechanism).

```bash
pnpm chain &                                 # terminal 1: anvil + FHEVM cleartext host
pnpm deploy:localhost                        # deploys contracts AND regenerates frontend ABIs
pnpm deploy:sepolia                          # reads .env.local for DEPLOYER_PRIVATE_KEY / SEPOLIA_RPC_URL / ETHERSCAN_API_KEY
```

**Hardhat track (legacy):**

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY
npx hardhat vars set ETHERSCAN_API_KEY       # optional, single key for V2

npx hardhat deploy --network sepolia
npx hardhat verify --network sepolia <ADDRESS>
```

Deeper: [`references/08-deployment.md`](references/08-deployment.md).

---

## 7. Frontend Integration

**Current canonical: `@zama-fhe/react-sdk` v3.** TanStack-Query-based hooks shipped with the official `fhevm-react-template`. Use these for any new project:

| Hook | Use it for |
| --- | --- |
| `useEncrypt` | encrypt one or more values for `(contractAddress, userAddress)` |
| `useUserDecrypt` + `useAllow` + `useIsAllowed` | EIP-712 user decryption |
| `usePublicDecrypt` | threshold decryption; returns `{ clearValues, decryptionProof }` ready for `FHE.checkSignatures` |
| `useShield` / `useUnshield` / `useConfidentialBalance` / `useConfidentialTransfer` | ERC-7984 confidential token flows |

```tsx
const encrypt = useEncrypt();
const enc = await encrypt.mutateAsync({
  values: [{ value: 100n, type: "euint64" }],
  contractAddress, userAddress,
});
// enc.handles[0] (bytes32) + enc.inputProof (bytes) → contract call
```

Always use `mutateAsync` (not `mutate`) when awaiting. The relayer SDK is wired up via `<ZamaProvider>` in `DappWrapperWithProviders.tsx`; no CDN `<Script>` tag in the new template.

**Legacy: `@zama-fhe/sdk` v2.** Older apps may still use the v2 `Token` class or the removed `useFhevm` / `useFHEEncryption` / `useFHEDecrypt` hooks. Both are frozen — `fhevm-lint` AP-019 flags v2 hook imports as deprecated. Migration guide in `references/14-sdk-v3-frontend.md`.

Deeper: [`references/14-sdk-v3-frontend.md`](references/14-sdk-v3-frontend.md) for the current track, [`references/09-frontend-patterns.md`](references/09-frontend-patterns.md) for the legacy track and shared production patterns (loading states, error decoding, two-phase unshield).

---

## 8. Production Edge Cases

When generating real apps, these are the gotchas not obvious from the docs alone:

- `euint64` stores integers, not decimals — `0.01` becomes `0` after `parseInt`.
- `buildParamsFromAbi` only works for encryption-only functions; for mixed signatures, pass `enc.handles[i]` and `enc.inputProof` directly.
- Decryption is async — results land asynchronously, watch with `useEffect`.
- Decode contract error selectors (`0x5d5a323c`) into human messages.
- COOP/COEP headers break CDN fonts and Coinbase Wallet — skip them; single-threaded WASM (1–3s) is fine.
- `scaffold.config.ts` network order matters — first network is the default.
- FHEVM init takes 10–30s on Sepolia; show a loading state.
- Etherscan V2: single API key, add Sourcify as fallback.

Deeper: [`references/12-production-edge-cases.md`](references/12-production-edge-cases.md).

---

## 9. Validation Hook (run before returning code)

**This is mandatory for the agent.** Before responding with any FHEVM Solidity:

```bash
# Preferred: the linter is published as a binary
npx fhevm-lint path/to/Contract.sol

# Fallback: invoke the script directly
node <skill-root>/scripts/fhevm-lint.js path/to/Contract.sol
```

The linter accepts `.sol`, `.ts`, `.tsx`, `.js`, `.jsx` paths and exits non-zero on CRITICAL or HIGH findings. The 20 rules at-a-glance:

| Severity | Codes |
| --- | --- |
| CRITICAL | AP-001 (missing allowThis — includes struct-member writes), AP-002 (if/require on ebool), AP-003 (missing ZamaEthereumConfig), AP-004 (missing fromExternal), AP-005 (encrypted div/rem) |
| HIGH | AP-006 (view returns plaintext from handle), AP-007 (checkSignatures without makePubliclyDecryptable), AP-008 (missing allow for user; auto-suppressed when contract uses public decryption), AP-017 (FHE.encrypt in loop), AP-019 (deprecated SDK v2 hook imports) |
| MEDIUM | AP-010 (scalar on LHS), AP-011 (rand in view), AP-012 (missing allowTransient on state-changing fn), AP-013 (TFHE.* namespace), AP-014 (deprecated import path), AP-018 (direct FHE.decrypt in production), AP-020 (awaited fire-and-forget mutate) |
| LOW | AP-015 (bytecodeHash), AP-016 (Solidity < 0.8.24), AP-021 (missing NEXT_PUBLIC_ALCHEMY_API_KEY env) |
| INFO | AP-009 (oversized type for domain) — opt-in only |

Heuristic boundaries: AP-001 cannot do full dataflow with the AST parser, so it heuristically requires that any function which writes an encrypted-typed identifier (or known encrypted struct field) into storage also calls `FHE.allowThis(...)` somewhere in the same body. AP-007 verifies same-contract co-presence, not argument ordering. AP-006 fires only when the function has zero `FHE.*` calls. AP-008 is auto-suppressed when the enclosing contract uses `FHE.makePubliclyDecryptable` (public-decrypt-only design).

Deeper: [`scripts/README.md`](scripts/README.md), [`references/11-pitfall-catalog.md`](references/11-pitfall-catalog.md).

---

## 10. Output Contract — what every response must include

When asked to build a contract, the response must include all five. Skip none. Adapt the paths and file extensions to the project's track.

| # | Foundry track | Hardhat track |
| --- | --- | --- |
| 1. Contract | `packages/foundry/src/<Name>.sol` | `contracts/<Name>.sol` |
| 2. Test | `packages/foundry/test/<Name>.t.sol` (inherits `FhevmTest`) | `test/<Name>.test.ts` (uses `fhevm.createEncryptedInput` mock) |
| 3. Deploy | `packages/foundry/script/Deploy<Name>.s.sol` + a line in `scripts/deploy-localhost.sh` | `deploy/01_<name>.ts` (hardhat-deploy with `func.id` + `func.tags`) |
| 4. Frontend hook | `packages/nextjs/hooks/<feature>/use<Name>.tsx` (SDK v3) | bespoke hook using SDK v2 patterns |
| 5. Frontend page | `packages/nextjs/app/<route>/page.tsx` — encrypts, submits, reads handle, decrypts on demand, three render states (form / reveal / finalised where applicable) | same |

In all cases:
- Test covers happy path + at least one branch of every `FHE.select` + a permission test (a non-permitted address fails to decrypt) + an uninitialised-handle test.
- The frontend uses `mutateAsync` (never `mutate`) when awaiting an SDK v3 hook.
- `npx fhevm-lint` over both `packages/foundry/src/` (or `contracts/`) AND `packages/nextjs/` returns 0 CRITICAL/HIGH findings.

If any step fails compile, test, or lint, fix and re-emit. Do not return half-done work.

---

## 11. Reference Index

### Deep-dive references — shared (both tracks)
- [`01-mental-model.md`](references/01-mental-model.md) — handles, ACL, async decryption (open when explaining the architecture)
- [`03-type-system.md`](references/03-type-system.md) — every encrypted type, op matrix, gas tiers (open when picking a type)
- [`04-encrypted-io.md`](references/04-encrypted-io.md) — input proofs, user/public decryption flows (open when wiring inputs/outputs)
- [`05-permission-model.md`](references/05-permission-model.md) — ACL lifecycle, allow/allowTransient/makePubliclyDecryptable (open when granting permissions)
- [`06-writing-contracts.md`](references/06-writing-contracts.md) — full pattern catalogue with worked code (open whenever writing Solidity)
- [`10-erc7984-confidential-tokens.md`](references/10-erc7984-confidential-tokens.md) — confidential token spec, wrap/unwrap (open for token work)
- [`11-pitfall-catalog.md`](references/11-pitfall-catalog.md) — pitfalls with root cause + fix (open when something breaks)
- [`12-production-edge-cases.md`](references/12-production-edge-cases.md) — non-obvious gotchas (open when polishing for prod)
- [`15-failure-modes.md`](references/15-failure-modes.md) — operational failure catalog (open when setup or build breaks)

### Foundry / SDK v3 track (current canonical)
- [`13-foundry-toolchain.md`](references/13-foundry-toolchain.md) — forge-fhevm, soldeer, cleartext-mode KMS proofs (open when on the Foundry track)
- [`14-sdk-v3-frontend.md`](references/14-sdk-v3-frontend.md) — @zama-fhe/react-sdk v3 hooks (open when building the frontend)
- [`templates/foundry/`](templates/foundry/) — real source files: `contract.sol`, `Test.t.sol`, `Deploy.s.sol`, `foundry.toml`
- [`templates/sdk-v3/`](templates/sdk-v3/) — real source files: `useFHEContract.tsx`, `page.tsx`
- [`examples/foundry/confidential-voting.md`](examples/foundry/confidential-voting.md) — full end-to-end worked example

### Hardhat / SDK v2 track (legacy, still supported)
- [`02-project-setup.md`](references/02-project-setup.md) — Hardhat config, Next.js config, TypeScript, branding
- [`07-testing-guide.md`](references/07-testing-guide.md) — @fhevm/hardhat-plugin mock-mode testing
- [`08-deployment.md`](references/08-deployment.md) — hardhat-deploy, Sepolia, Etherscan V2, Sourcify
- [`09-frontend-patterns.md`](references/09-frontend-patterns.md) — credential lifecycle, loading states, two-phase unshield (SDK v2 patterns)
- [`templates/contract.sol`](templates/contract.sol), [`test.ts`](templates/test.ts), [`deploy.ts`](templates/deploy.ts), [`page.tsx`](templates/page.tsx), [`hardhat.config.ts`](templates/hardhat.config.ts)

### Worked examples (Hardhat-track, contract patterns still apply)
- [`examples/private-dao-treasury.md`](examples/private-dao-treasury.md) — encrypted votes, threshold reveal
- [`examples/sealed-bid-marketplace.md`](examples/sealed-bid-marketplace.md) — time-locked bids, winner reveal
- [`examples/confidential-payroll.md`](examples/confidential-payroll.md) — encrypted salaries, batch distribution

### Scripts
- [`scripts/fhevm-lint.js`](scripts/fhevm-lint.js) — static linter, 20 anti-pattern rules across Solidity + frontend
- [`scripts/verify.sh`](scripts/verify.sh) — install + compile + test + lint smoke check
- [`scripts/README.md`](scripts/README.md) — invocation guide for agents
