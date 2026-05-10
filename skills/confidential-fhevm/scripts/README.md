# scripts/ — executable validation for AI agents

This folder ships two scripts that an AI coding agent must run before claiming a generated FHEVM project is complete.

## `fhevm-lint.js`

A static linter that catches the seventeen most common FHEVM anti-patterns. Runs on a single `.sol` file or a directory.

```bash
# from the project root
npx fhevm-lint contracts/MyContract.sol
npx fhevm-lint contracts/

# direct invocation (no install)
node skills/confidential-fhevm/scripts/fhevm-lint.js contracts/

# include INFO-level heuristic suggestions (oversized types, etc.)
npx fhevm-lint --info contracts/

# machine-readable output (for CI / agent post-processing)
npx fhevm-lint --json contracts/ > findings.json
```

**Exit codes**

| Code | Meaning |
| --- | --- |
| 0 | No CRITICAL or HIGH findings (LOW / MEDIUM may still be reported) |
| 1 | At least one CRITICAL or HIGH finding |
| 2 | Usage error (file not found, parse error, missing dep) |

**The 17 rules at a glance**

| Code | Severity | Detects |
| --- | --- | --- |
| AP-001 | CRITICAL | Encrypted state write without `FHE.allowThis` (heuristic) |
| AP-002 | CRITICAL | `if`/`require` on an `ebool` |
| AP-003 | CRITICAL | Contract uses FHE without `ZamaEthereumConfig` inheritance |
| AP-004 | CRITICAL | `externalEuint*` parameter without `FHE.fromExternal` call |
| AP-005 | CRITICAL | `FHE.div` / `FHE.rem` with encrypted divisor |
| AP-006 | HIGH | View/pure with encrypted input + plaintext return + zero `FHE.*` calls |
| AP-007 | HIGH | `FHE.checkSignatures` without `FHE.makePubliclyDecryptable` in same contract |
| AP-008 | HIGH | Encrypted state write with `allowThis` but no `FHE.allow(handle, user)` |
| AP-010 | MEDIUM | Numeric literal on LHS of an FHE op (use scalar path with cipher on LHS) |
| AP-011 | MEDIUM | `FHE.rand*` called from a `view` / `pure` function |
| AP-012 | MEDIUM | State-changing function returns encrypted handle without `FHE.allowTransient` |
| AP-013 | MEDIUM | Deprecated `TFHE.*` namespace |
| AP-014 | MEDIUM | Deprecated import `fhevm/lib/TFHE.sol` |
| AP-015 | LOW | `metadata.bytecodeHash != "none"` in `hardhat.config.*` |
| AP-016 | LOW | Solidity pragma below 0.8.24 |
| AP-017 | HIGH | `FHE.encrypt*` / `FHE.asEuint*` inside a loop body (gas bomb) |
| AP-018 | MEDIUM | Direct `FHE.decrypt(...)` call site in a production contract |
| AP-009 | INFO (opt-in) | Encrypted type oversized for likely domain (`euint256`) |

**Heuristic boundaries**

- AP-001 confirms that any function which writes an encrypted-typed identifier into storage also calls `FHE.allowThis(...)` somewhere in its body. Multi-step code paths and helper-call delegation are **not modelled** — the rule will miss bugs that span helper functions. Each finding includes a `note:` line flagging this.
- AP-007 verifies same-contract co-presence of `FHE.checkSignatures` and `FHE.makePubliclyDecryptable`, **not** argument ordering. Full handle-order verification requires control-flow analysis and is a documented `TODO`.
- AP-006 fires only when the function has zero `FHE.*` calls — this avoids penalising legitimate views that return plaintext via the gateway.
- AP-008 may false-positive on contracts that intentionally only expose data via public decryption. Suppress with a code comment if intentional.

The linter prefers false negatives over false positives.

## `verify.sh`

End-to-end build check: install → compile → test → lint. Auto-detects npm vs pnpm vs yarn from the lockfile.

```bash
bash skills/confidential-fhevm/scripts/verify.sh path/to/project
# or, from inside a project:
bash <skill-root>/scripts/verify.sh
```

Exits non-zero if any step fails. AI agents should run this before claiming "the contract is ready to deploy".
