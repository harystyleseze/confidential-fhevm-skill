# scripts/ — executable validation for AI agents

This folder ships two scripts that an AI coding agent must run before claiming a generated FHEVM project is complete.

## Installation

The linter is published with a `bin` entry in `package.json`, so installing the skill as a dev dependency registers `fhevm-lint` in `node_modules/.bin/`. Use the right package manager for your project:

```bash
# pnpm workspace (the official fhevm-react-template) — install from the WORKSPACE ROOT
pnpm add -w --save-dev github:harystyleseze/confidential-fhevm-skill

# standalone npm project (Hardhat-only template, etc.)
npm install --save-dev github:harystyleseze/confidential-fhevm-skill

# standalone yarn project
yarn add --dev github:harystyleseze/confidential-fhevm-skill
```

**Do not mix package managers.** Running `npm install` inside a pnpm workspace creates a stray `package-lock.json` that prevents pnpm from linking the binary; `npx fhevm-lint` will then report "command not found" even though the package is installed. See `references/15-failure-modes.md` §1.

If you can't or don't want to install the skill as a dep, invoke the script directly:
```bash
node path/to/confidential-fhevm/scripts/fhevm-lint.js <target>
```

## `fhevm-lint.js`

A static linter for FHEVM Solidity AND frontend (TS/TSX/JS/JSX) code. Twenty rules across both layers. Runs on a single file or a directory.

```bash
# Solidity (contract dir or single file)
npx fhevm-lint contracts/MyContract.sol
npx fhevm-lint packages/foundry/src/

# Frontend (Next.js app dir / hooks dir / single TSX)
npx fhevm-lint packages/nextjs/hooks/ packages/nextjs/app/

# Mixed
npx fhevm-lint packages/foundry/src/ packages/nextjs/

# Include INFO-level heuristic suggestions (oversized types, etc.)
npx fhevm-lint --info contracts/

# Machine-readable output (for CI / agent post-processing)
npx fhevm-lint --json contracts/ > findings.json
```

**Exit codes**

| Code | Meaning |
| --- | --- |
| 0 | No CRITICAL or HIGH findings (LOW / MEDIUM may still be reported) |
| 1 | At least one CRITICAL or HIGH finding |
| 2 | Usage error (file not found, parse error, missing dep) |

**The 20 rules at a glance**

Solidity (`.sol` AST + regex):

| Code | Severity | Detects |
| --- | --- | --- |
| AP-001 | CRITICAL | Encrypted state write (incl. struct-member writes) without `FHE.allowThis` |
| AP-002 | CRITICAL | `if`/`require` on an `ebool` |
| AP-003 | CRITICAL | Contract uses FHE without `ZamaEthereumConfig` inheritance |
| AP-004 | CRITICAL | `externalEuint*` parameter without `FHE.fromExternal` call |
| AP-005 | CRITICAL | `FHE.div` / `FHE.rem` with encrypted divisor |
| AP-006 | HIGH | View/pure with encrypted input + plaintext return + zero `FHE.*` calls |
| AP-007 | HIGH | `FHE.checkSignatures` without `FHE.makePubliclyDecryptable` in same contract |
| AP-008 | HIGH | Encrypted state write with `allowThis` but no `FHE.allow(handle, user)`; auto-suppressed when the contract uses `FHE.makePubliclyDecryptable` |
| AP-017 | HIGH | `FHE.encrypt*` / `FHE.asEuint*` inside a loop body (gas bomb) |
| AP-010 | MEDIUM | Numeric literal on LHS of an FHE op (use scalar path with cipher on LHS) |
| AP-011 | MEDIUM | `FHE.rand*` called from a `view` / `pure` function |
| AP-012 | MEDIUM | State-changing function returns encrypted handle without `FHE.allowTransient` (skipped for view/pure) |
| AP-013 | MEDIUM | Deprecated `TFHE.*` namespace |
| AP-014 | MEDIUM | Deprecated import `fhevm/lib/TFHE.sol` |
| AP-018 | MEDIUM | Direct `FHE.decrypt(...)` call site in a production contract |
| AP-015 | LOW | `metadata.bytecodeHash != "none"` in `hardhat.config.*` |
| AP-016 | LOW | Solidity pragma below 0.8.24 |
| AP-009 | INFO (opt-in) | Encrypted type oversized for likely domain (`euint256`) |

Frontend / config (`.ts` / `.tsx` / `.js` / `.jsx` regex):

| Code | Severity | Detects |
| --- | --- | --- |
| AP-019 | HIGH | Deprecated SDK v2 hook imports (`useFhevm`, `useFHEEncryption`, `useFHEDecrypt`) from `@zama-fhe/react-sdk` or `@zama-fhe/sdk` |
| AP-020 | MEDIUM | `await <name>.mutate(...)` — fire-and-forget mutate produces undefined |
| AP-021 | LOW | Code references `NEXT_PUBLIC_ALCHEMY_API_KEY` but no `.env`/`.env.local` exists up the tree |

**Heuristic boundaries**

- AP-001 confirms that any function which writes an encrypted-typed identifier *or struct field* into storage also calls `FHE.allowThis(...)` somewhere in its body. Multi-step code paths and helper-call delegation are **not modelled** — the rule will miss bugs that span helper functions. Each finding includes a `note:` line flagging this. Struct-field detection is name-based: if two unrelated structs in the same contract both have a field literally called `value` and only one is encrypted, AP-001 may flag a write to the non-encrypted field. Suppress with a code comment when intentional.
- AP-007 verifies same-contract co-presence of `FHE.checkSignatures` and `FHE.makePubliclyDecryptable`, **not** argument ordering. Full handle-order verification requires control-flow analysis and is a documented `TODO`.
- AP-006 fires only when the function has zero `FHE.*` calls — this avoids penalising legitimate views that return plaintext via the gateway.
- AP-008 is auto-suppressed when the enclosing contract uses `FHE.makePubliclyDecryptable` (signals public-decrypt-only design — no user decryption needed).
- AP-019 catches the exact import name. Re-exports through barrel files may slip through.
- AP-021 fires only when no `.env` or `.env.local` exists in the file's ancestor directories up to 6 levels deep.

The linter prefers false negatives over false positives.

## `verify.sh`

End-to-end build check: install → compile → test → lint. Auto-detects npm vs pnpm vs yarn from the lockfile.

```bash
bash skills/confidential-fhevm/scripts/verify.sh path/to/project
# or, from inside a project:
bash <skill-root>/scripts/verify.sh
```

Exits non-zero if any step fails. AI agents should run this before claiming "the contract is ready to deploy".
