# confidential-fhevm-skill

> An AI agent skill for [Zama's FHEVM Protocol](https://docs.zama.org/protocol). Drop it into Claude Code, Cursor, or Windsurf, prompt *"build me a confidential dao contract"*, and ship a working dApp to Sepolia in twelve minutes.

[![Skill format](https://img.shields.io/badge/SKILL.md-Anthropic%20Agent%20Skills-blue)](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
[![FHEVM](https://img.shields.io/badge/%40fhevm%2Fsolidity-0.11.1-FFD208)](https://docs.zama.org/protocol)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Submitted to the **Zama Developer Program — Mainnet Season 2 — Bounty Track**.

---

## What's inside

| Asset | Count | Path |
| --- | --- | --- |
| Router `SKILL.md` | 1 file, **320 lines** (well under Anthropic's 500-line ceiling) | [`skills/confidential-fhevm/SKILL.md`](skills/confidential-fhevm/SKILL.md) |
| Reference docs | **12 files** covering every required topic | [`skills/confidential-fhevm/references/`](skills/confidential-fhevm/references/) |
| Worked examples | **3 full builds** with contract + tests + deploy + frontend | [`skills/confidential-fhevm/examples/`](skills/confidential-fhevm/examples/) |
| Templates (real source files) | **5** — `.sol`, `.ts`, `.tsx`, `hardhat.config.ts` | [`skills/confidential-fhevm/templates/`](skills/confidential-fhevm/templates/) |
| Static linter | **17 anti-pattern rules**, machine-checkable | [`skills/confidential-fhevm/scripts/fhevm-lint.js`](skills/confidential-fhevm/scripts/fhevm-lint.js) |
| Cross-tool adapters | Cursor `.mdc` + Windsurf `.md` | [`adapters/`](adapters/) |


All pinned to current Zama versions: `@fhevm/solidity 0.11.1`, `@fhevm/hardhat-plugin 0.4.2`, `@zama-fhe/sdk 2.3.0`, `@zama-fhe/relayer-sdk 0.4.1`, Solidity 0.8.27 (EVM `cancun`).

---

## Try it

### Claude Code
```bash
git clone https://github.com/harystyleseze/confidential-fhevm-skill.git
mkdir -p .claude/skills
cp -R confidential-fhevm-skill/skills/confidential-fhevm .claude/skills/
# now prompt Claude Code: "Write me a confidential dao contract using FHEVM"
```

### Cursor
```bash
mkdir -p .cursor/rules
cp confidential-fhevm-skill/adapters/cursor/.cursor/rules/fhevm.mdc .cursor/rules/
```

### Windsurf
```bash
mkdir -p .windsurf/rules
cp confidential-fhevm-skill/adapters/windsurf/.windsurf/rules/fhevm.md .windsurf/rules/
```

---

## The validator

Documentation tells an agent *what to do*. The validator stops it from shipping when it doesn't.

```bash
$ npx fhevm-lint contracts/Vote.sol
contracts/Vote.sol
  contracts/Vote.sol:42:9  [CRITICAL/AP-001]   function 'castVote' writes an encrypted handle to state but never calls FHE.allowThis(...)
      fix: Add `FHE.allowThis(stateVar);` after each encrypted state write so the contract can read its own state in subsequent transactions.
      note: Single-function scope; cross-function helper calls are not modelled.

Summary: 1 finding(s) — 1 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW
$ echo "exit: $?"
exit: 1
```

The 17 rules:

| Code | Severity | Detects |
| --- | --- | --- |
| AP-001 | CRITICAL | Encrypted state write without `FHE.allowThis` (heuristic) |
| AP-002 | CRITICAL | `if` / `require` on an `ebool` |
| AP-003 | CRITICAL | Contract uses FHE without `ZamaEthereumConfig` inheritance |
| AP-004 | CRITICAL | `externalEuint*` parameter without `FHE.fromExternal` call |
| AP-005 | CRITICAL | `FHE.div` / `FHE.rem` with encrypted divisor |
| AP-006 | HIGH | View/pure with encrypted input + plaintext return + zero `FHE.*` calls |
| AP-007 | HIGH | `FHE.checkSignatures` without `FHE.makePubliclyDecryptable` in same contract |
| AP-008 | HIGH | Encrypted state write with `allowThis` but no `FHE.allow(handle, user)` |
| AP-010 | MEDIUM | Numeric literal on LHS of an FHE op (use the cheaper scalar path) |
| AP-011 | MEDIUM | `FHE.rand*` called from `view` / `pure` |
| AP-012 | MEDIUM | State-changing fn returns encrypted handle without `FHE.allowTransient` |
| AP-013 | MEDIUM | Deprecated `TFHE.*` namespace |
| AP-014 | MEDIUM | Deprecated import `fhevm/lib/TFHE.sol` |
| AP-015 | LOW | `metadata.bytecodeHash != "none"` in `hardhat.config.*` |
| AP-016 | LOW | Solidity pragma below 0.8.24 |
| AP-017 | HIGH | `FHE.encrypt*` / `FHE.asEuint*` inside a loop body (gas bomb) |
| AP-018 | MEDIUM | Direct `FHE.decrypt(...)` in production contract |
| AP-009 | INFO (opt-in) | Encrypted type oversized for likely domain |

**Validation results** (live run, cleaned templates and broken fixtures):
- Clean templates → `0 findings ✓` (exit 0)
- Broken fixtures (one rule violation each, 9 files) → 16 findings — 5 CRITICAL · 6 HIGH · 4 MEDIUM · 1 LOW (exit 1)
- Heuristic boundaries documented inline; every approximate rule emits a `note:` line.

The validation hook is wired into the SKILL.md "output contract": the agent must run `npx fhevm-lint` on every generated contract before responding. See [`skills/confidential-fhevm/scripts/README.md`](skills/confidential-fhevm/scripts/README.md).

---

## Coverage matrix (bounty topics)

The bounty (`challenge.md`) lists twelve required topics. Every one has a dedicated reference file:

| Required topic | Coverage |
| --- | --- |
| FHEVM architecture and how FHE works on-chain | [`SKILL.md` §1](skills/confidential-fhevm/SKILL.md), [`references/01-mental-model.md`](skills/confidential-fhevm/references/01-mental-model.md) |
| Setting up the dev environment using the Hardhat template | [`references/02-project-setup.md`](skills/confidential-fhevm/references/02-project-setup.md), [`templates/hardhat.config.ts`](skills/confidential-fhevm/templates/hardhat.config.ts) |
| Encrypted types (`euint8`–`euint256`, `ebool`, `eaddress`) | [`references/03-type-system.md`](skills/confidential-fhevm/references/03-type-system.md) |
| FHE operations (arithmetic, comparison, conditional logic) | [`references/06-writing-contracts.md`](skills/confidential-fhevm/references/06-writing-contracts.md) §§ 2–3 |
| Access control (`FHE.allow`, `FHE.allowTransient`) | [`references/05-permission-model.md`](skills/confidential-fhevm/references/05-permission-model.md) |
| Input proofs — what / why / how | [`references/04-encrypted-io.md`](skills/confidential-fhevm/references/04-encrypted-io.md), [`references/06-writing-contracts.md`](skills/confidential-fhevm/references/06-writing-contracts.md) §1 |
| User decryption (EIP-712 signing flow) | [`references/04-encrypted-io.md`](skills/confidential-fhevm/references/04-encrypted-io.md), [`references/09-frontend-patterns.md`](skills/confidential-fhevm/references/09-frontend-patterns.md) |
| Public decryption patterns | [`references/06-writing-contracts.md`](skills/confidential-fhevm/references/06-writing-contracts.md) §6, [`examples/private-dao-treasury.md`](skills/confidential-fhevm/examples/private-dao-treasury.md) |
| Frontend integration with fhevmjs / Relayer SDK | [`references/09-frontend-patterns.md`](skills/confidential-fhevm/references/09-frontend-patterns.md), [`templates/page.tsx`](skills/confidential-fhevm/templates/page.tsx) |
| Testing FHEVM contracts | [`references/07-testing-guide.md`](skills/confidential-fhevm/references/07-testing-guide.md), [`templates/test.ts`](skills/confidential-fhevm/templates/test.ts) |
| Common anti-patterns and mistakes | [`references/11-pitfall-catalog.md`](skills/confidential-fhevm/references/11-pitfall-catalog.md), [`scripts/fhevm-lint.js`](skills/confidential-fhevm/scripts/fhevm-lint.js) |
| OpenZeppelin Confidential Contracts / ERC-7984 | [`references/10-erc7984-confidential-tokens.md`](skills/confidential-fhevm/references/10-erc7984-confidential-tokens.md) |

---

## Repository layout

```
confidential-fhevm-skill/
├── README.md                                    ← you are here
├── LICENSE                                      ← MIT
├── package.json                                 ← installs @solidity-parser/parser; declares fhevm-lint bin
├── skills/
│   └── confidential-fhevm/
│       ├── SKILL.md                              ← 320-line router (Anthropic format)
│       ├── references/                           ← 12 numbered deep-dive docs
│       ├── examples/                             ← 3 worked dApps
│       ├── templates/                            ← 5 real source files
│       └── scripts/                              ← fhevm-lint.js + verify.sh + README.md
├── adapters/
│   ├── cursor/.cursor/rules/fhevm.mdc            ← Cursor format
│   └── windsurf/.windsurf/rules/fhevm.md         ← Windsurf format
├── tests/fixtures/                               ← deliberately-broken Solidity that exercises each AP rule
```

---

## Author

**Harystyles** — [GitHub](https://github.com/harystyleseze) · [X / Twitter](https://x.com/Harystylesdev) · Telegram `@DevHarystyles`