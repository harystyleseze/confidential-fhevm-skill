---
name: confidential-fhevm
description: "Build, test, and deploy confidential smart contracts with Zama's FHEVM protocol. Use when writing Solidity with encrypted types (ebool, euint8-256, eaddress), performing FHE operations (add, sub, mul, select, comparisons), managing ACL permissions (FHE.allow, allowThis, allowTransient), handling encrypted inputs (externalEuint + FHE.fromExternal), implementing public or user decryption, building ERC-7984 confidential tokens, testing with @fhevm/hardhat-plugin (createEncryptedInput, userDecryptEuint), deploying to local or Sepolia, integrating frontends with @zama-fhe/sdk or fhevm-react-template, or scaffolding new FHEVM projects. Pinned to @fhevm/solidity 0.11.1, @fhevm/hardhat-plugin 0.4.2, @zama-fhe/sdk 2.3.0, Solidity 0.8.27, Hardhat 2.28+, ethers 6, Next.js 15, React 19. Ships with an executable static linter (fhevm-lint) covering 17 anti-patterns including missing FHE.allowThis, branching on ebool, missing ZamaEthereumConfig, and FHE-encrypt-in-loop gas bombs."
---

# Confidential FHEVM Development

Pinned versions: `@fhevm/solidity ^0.11.1` · `@fhevm/hardhat-plugin ^0.4.2` · `@zama-fhe/sdk 2.3.0` · `@zama-fhe/relayer-sdk ^0.4.1` · Solidity `0.8.27` (EVM `cancun`) · Hardhat `^2.28.4` · ethers `^6.16.0` · Next.js 15 · React 19

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

You should get: `Vote.sol`, `Vote.test.ts`, `01_vote.ts` deploy, `Vote.tsx` frontend page — all `fhevm-lint` clean and ready to deploy to Sepolia.

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

**Full-stack (Hardhat + Next.js):**
```bash
git clone https://github.com/zama-ai/fhevm-react-template.git my-dapp
cd my-dapp && pnpm install
```
pnpm monorepo: `packages/nextjs` (Next 15.2, React 19, Wagmi 2.16, RainbowKit 2.2, Tailwind 4, DaisyUI 5) and `packages/fhevm-sdk` (React hooks). Relayer SDK loaded from CDN in `layout.tsx` with `<Script strategy="beforeInteractive">`.

**Adding to an existing Hardhat project:**
```bash
npm install @fhevm/solidity@^0.11.1 @fhevm/mock-utils@^0.4.2 encrypted-types@^0.0.4
npm install -D @fhevm/hardhat-plugin@^0.4.2
```
Add `import "@fhevm/hardhat-plugin";` to `hardhat.config.ts`. Set Solidity `0.8.27`, `evmVersion: "cancun"`, optimizer 800 runs, `metadata.bytecodeHash: "none"`.

Deeper: [`references/02-project-setup.md`](references/02-project-setup.md).

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

After generating any Solidity that uses `FHE.*`, verify every rule. Each rule has a dedicated entry in [`references/11-pitfall-catalog.md`](references/11-pitfall-catalog.md) with root cause, failure mode, broken code, and fixed code. The executable linter (`scripts/fhevm-lint.js`) catches violations of rules 1, 3–6, 9–14 mechanically.

| # | Rule | Lint code |
| --- | --- | --- |
| 1 | `FHE.allowThis(handle)` after every encrypted state write | AP-001 |
| 2 | `FHE.allow(handle, user)` for every value the user must decrypt | AP-008 |
| 3 | Never use `if`/`else`/`require`/`revert` on encrypted values — use `FHE.select` | AP-002 |
| 4 | Division/modulo require a plaintext divisor only | AP-005 |
| 5 | Always call `FHE.fromExternal(externalEuintNN, proof)` on external inputs | AP-004 |
| 6 | Every contract must inherit `ZamaEthereumConfig` (or `…Upgradeable`) | AP-003 |
| 7 | ERC-7984 tokens use ≤6 decimals (`euint64` max ≈ 1.8e19) | — |
| 8 | Arithmetic wraps silently on overflow — implement checks manually | — |
| 9 | Use the smallest encrypted type that fits your data | AP-009 (info) |
| 10 | Use scalar operands when one side is plaintext (cipher on LHS) | AP-010 |
| 11 | Handle ordering in `checkSignatures` must match the `publicDecrypt` call | AP-007 |
| 12 | `FHE.rand*` only works in state-changing functions | AP-011 |
| 13 | Uninitialised encrypted variables return `ethers.ZeroHash` | — |
| 14 | Returns to other contracts need `FHE.allowTransient(handle, msg.sender)` | AP-012 |
| 15 | Only wrap standard ERC-20 (no fee-on-transfer / rebasing / deflationary) | — |
| 16 | New ciphertexts have zero permissions — root cause for rules 1, 2, 14 | AP-001 |
| 17 | Never call `FHE.encrypt*` / `FHE.asEuint*` inside a loop body | AP-017 |
| 18 | Production contracts must not call `FHE.decrypt(...)` directly | AP-018 |

---

## 5. Testing

Tests run against a mock FHE environment locally (fast, deterministic) or the real coprocessor on Sepolia (slow, requires funded wallet).

**Skeleton:**
```typescript
import {expect} from "chai";
import {ethers, fhevm} from "hardhat";
import {FhevmType} from "@fhevm/hardhat-plugin";

describe("MyContract", function () {
  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();   // mock-only suite
    // ... deploy ...
  });

  it("encrypts, calls, decrypts", async function () {
    const enc = await fhevm
      .createEncryptedInput(contractAddress, alice.address)
      .add64(50_000n).encrypt();
    await contract.connect(alice).setSalary(employee, enc.handles[0], enc.inputProof);

    const handle = await contract.getBalance(alice.address);
    if (handle === ethers.ZeroHash) throw new Error("uninitialised");
    const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, alice);
    expect(clear).to.equal(50_000n);
  });
});
```

`createEncryptedInput` chain methods: `addBool`, `add8`, `add16`, `add32`, `add64`, `add128`, `add256`, `addAddress`. `FhevmType` values mirror the encrypted types.

**Run:**
```bash
npm run test           # local mock — fast, no network
npm run test:sepolia   # real coprocessor — funded wallet required
```

Deeper: [`references/07-testing-guide.md`](references/07-testing-guide.md).

---

## 6. Deployment

`hardhat-deploy` pattern; deploy to local for development, Sepolia for demos/staging, mainnet for production. Use a single Etherscan API key (V2, since May 2025).

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY
npx hardhat vars set ETHERSCAN_API_KEY    # optional, single key for V2

npx hardhat deploy --network sepolia
npx hardhat verify --network sepolia <ADDRESS>
```

Deeper: [`references/08-deployment.md`](references/08-deployment.md).

---

## 7. Frontend Integration

Two stable approaches:

1. **`@zama-fhe/sdk` v2.3.0** — high-level `Token` class: `shield()`, `confidentialTransfer()`, `balanceOf()`, two-phase `unshield()` with persistence. Recommended for production.
2. **fhevm-react-template hooks** (`useFhevm`, `useFHEEncryption`, `useFHEDecrypt`) — lower-level, more control over the encryption/decryption pipeline.

Both require loading the relayer SDK from Zama's CDN in `layout.tsx`:
```tsx
<Script src="https://cdn.zama.org/relayer-sdk-js/v0.4.1/relayer-sdk-js.umd.cjs"
        strategy="beforeInteractive" />
```

Deeper: [`references/09-frontend-patterns.md`](references/09-frontend-patterns.md).

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

The linter exits non-zero on CRITICAL or HIGH findings. If anything fires, fix it and re-run before returning. The 17 rules:

| Severity | Codes |
| --- | --- |
| CRITICAL | AP-001 (missing allowThis), AP-002 (if/require on ebool), AP-003 (missing ZamaEthereumConfig), AP-004 (missing fromExternal), AP-005 (encrypted div/rem) |
| HIGH | AP-006 (view returns plaintext from handle), AP-007 (checkSignatures without makePubliclyDecryptable), AP-008 (missing allow for user), AP-017 (FHE.encrypt in loop) |
| MEDIUM | AP-010 (scalar on LHS), AP-011 (rand in view), AP-012 (missing allowTransient), AP-013 (TFHE.* namespace), AP-014 (deprecated import path), AP-018 (direct FHE.decrypt in production) |
| LOW | AP-015 (bytecodeHash), AP-016 (Solidity < 0.8.24) |
| INFO | AP-009 (oversized type for domain) — opt-in only |

Heuristic boundaries: AP-001 cannot do full dataflow with the AST parser, so it heuristically requires that any function which writes an encrypted-typed identifier into storage also calls `FHE.allowThis(...)` somewhere in the same body. AP-007 verifies same-contract co-presence, not argument ordering. AP-006 fires only when the function has zero `FHE.*` calls.

Deeper: [`scripts/README.md`](scripts/README.md), [`references/11-pitfall-catalog.md`](references/11-pitfall-catalog.md).

---

## 10. Output Contract — what every response must include

When asked to build a contract, the response must include all five of these. Skip none.

1. **Contract** (`contracts/<Name>.sol`) — clean, compiles, lint-clean.
2. **Test** (`test/<Name>.test.ts`) — happy path + at least one branch of every `FHE.select`, plus a permission test (a non-permitted address fails to decrypt).
3. **Deploy script** (`deploy/01_<name>.ts`) — `hardhat-deploy` style, sets `func.id` and `func.tags`.
4. **Frontend page** (`packages/nextjs/app/<route>/page.tsx`) — encrypts input, submits tx, reads handle, displays loading state, decrypts on demand.
5. **Lint clean** — show the user the `npx fhevm-lint <files>` output. Zero findings = ship-ready.

If any step fails compile, test, or lint, fix and re-emit. Do not return half-done work.

---

## 11. Reference Index

### Deep-dive references

- [`01-mental-model.md`](references/01-mental-model.md) — handles, ACL, async decryption (open when explaining the architecture)
- [`02-project-setup.md`](references/02-project-setup.md) — Hardhat config, Next.js config, TypeScript, branding (open when scaffolding)
- [`03-type-system.md`](references/03-type-system.md) — every encrypted type, op matrix, gas tiers (open when picking a type)
- [`04-encrypted-io.md`](references/04-encrypted-io.md) — input proofs, user/public decryption flows (open when wiring inputs/outputs)
- [`05-permission-model.md`](references/05-permission-model.md) — ACL lifecycle, allow/allowTransient/makePubliclyDecryptable (open when granting permissions)
- [`06-writing-contracts.md`](references/06-writing-contracts.md) — full pattern catalogue with worked code (open whenever writing Solidity)
- [`07-testing-guide.md`](references/07-testing-guide.md) — what to test, mock vs real, coverage (open when writing tests)
- [`08-deployment.md`](references/08-deployment.md) — hardhat-deploy, Sepolia, Etherscan V2, Sourcify (open when deploying)
- [`09-frontend-patterns.md`](references/09-frontend-patterns.md) — credential lifecycle, loading states, two-phase unshield (open when building UI)
- [`10-erc7984-confidential-tokens.md`](references/10-erc7984-confidential-tokens.md) — confidential token spec, wrap/unwrap (open for token work)
- [`11-pitfall-catalog.md`](references/11-pitfall-catalog.md) — 18 pitfalls with root cause + fix (open when something breaks)
- [`12-production-edge-cases.md`](references/12-production-edge-cases.md) — non-obvious gotchas (open when polishing for prod)

### Templates (real source files, not markdown)
- [`templates/contract.sol`](templates/contract.sol) — annotated FHEVM contract starter
- [`templates/test.ts`](templates/test.ts) — Hardhat + fhevm mock test starter
- [`templates/deploy.ts`](templates/deploy.ts) — hardhat-deploy starter
- [`templates/page.tsx`](templates/page.tsx) — Next.js page with encrypt/decrypt
- [`templates/hardhat.config.ts`](templates/hardhat.config.ts) — canonical Hardhat config

### Worked examples
- [`examples/private-dao-treasury.md`](examples/private-dao-treasury.md) — encrypted votes, threshold reveal
- [`examples/sealed-bid-marketplace.md`](examples/sealed-bid-marketplace.md) — time-locked bids, winner reveal
- [`examples/confidential-payroll.md`](examples/confidential-payroll.md) — encrypted salaries, batch distribution

### Scripts
- [`scripts/fhevm-lint.js`](scripts/fhevm-lint.js) — static linter, 17 anti-pattern rules
- [`scripts/verify.sh`](scripts/verify.sh) — install + compile + test + lint smoke check
- [`scripts/README.md`](scripts/README.md) — invocation guide for agents
