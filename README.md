# confidential-fhevm-skill

> An AI agent skill for [Zama's FHEVM Protocol](https://docs.zama.org/protocol). Drop it into Claude Code, Cursor, or Windsurf — covers **both** the Foundry track (`forge-fhevm` + `@zama-fhe/react-sdk` v3, matching the official `fhevm-react-template` today) and the Hardhat track (`@fhevm/hardhat-plugin` + SDK v2, for existing projects).

[![Skill format](https://img.shields.io/badge/SKILL.md-Anthropic%20Agent%20Skills-blue)](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
[![FHEVM](https://img.shields.io/badge/%40fhevm%2Fsolidity-0.11.1-FFD208)](https://docs.zama.org/protocol)
[![SDK](https://img.shields.io/badge/%40zama--fhe%2Fsdk-3.0.0-FFD208)](https://github.com/zama-ai/sdk)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Submitted to the **Zama Developer Program — Mainnet Season 2 — Bounty Track**.

---

## 60-second judge pitch

**Claim.** A developer who drops this skill into their AI coding agent and prompts *"build me a confidential X using FHEVM"* gets back a contract, test, deploy script, and frontend that compile, pass, and lint clean — on whichever toolchain Zama currently recommends.

**How it works.** The skill is a dual-track router. It detects the project's toolchain (Foundry vs. Hardhat) and the SDK version (`@zama-fhe/react-sdk` v3 vs. legacy v2), then guides the agent through the exact patterns and anti-patterns that match. Both tracks share an identical Solidity API (`@fhevm/solidity 0.11.1`); only tests, deploy scripts, and frontend hooks differ.

**Verified end-to-end.** The skill was put through a fresh-developer build: a confidential voting dApp generated from one natural-language prompt onto a clean clone of `zama-ai/fhevm-react-template`. Every check below passed:

| Check | Result |
| --- | --- |
| `forge build` on the generated contract | clean |
| `forge test` (17 unit tests, includes full `finalize()` with `buildDecryptionProof`) | **17 / 17 passed** |
| `npx fhevm-lint packages/foundry/src/` | **0 findings ✓** |
| `npx fhevm-lint packages/nextjs/{hooks,app}/` | **0 findings ✓** |
| `pnpm next:build` (production prerender of 5 routes) | clean |
| `pnpm chain && pnpm deploy:localhost` (anvil + FHEVM cleartext host) | `ConfidentialVoting` deployed locally on chain 31337 |
| `curl http://localhost:3000/vote` after `pnpm start` | HTTP 200, real HTML rendered |

The example built during that verification ships in [`examples/foundry/confidential-voting.md`](skills/confidential-fhevm/examples/foundry/confidential-voting.md) — the full contract, test suite, deploy script, hook, and page are reproduced inline so any judge can recreate the same end-to-end run in minutes.

**Validator.** The bundled linter (`scripts/fhevm-lint.js`) implements **20 anti-pattern rules** across Solidity AST and frontend regex layers. Verified against:
- Clean templates (Hardhat + Foundry + SDK v3) → 0 findings, exit 0.
- 12 hand-crafted broken fixtures in `tests/fixtures/` exercising the rules → all fire, exit 1.

---

## What's inside

| Asset | Count / size | Path |
| --- | --- | --- |
| Router `SKILL.md` | 386 lines (under Anthropic's 500 ceiling) | [`skills/confidential-fhevm/SKILL.md`](skills/confidential-fhevm/SKILL.md) |
| Reference docs | **15** numbered + the bounty's "topics to cover" all addressed | [`skills/confidential-fhevm/references/`](skills/confidential-fhevm/references/) |
| Worked examples | **4** (3 Hardhat + 1 full Foundry) | [`skills/confidential-fhevm/examples/`](skills/confidential-fhevm/examples/) |
| Templates — Hardhat | 5 real source files (`.sol`, `.ts`, `.tsx`, `hardhat.config.ts`) | [`skills/confidential-fhevm/templates/`](skills/confidential-fhevm/templates/) |
| Templates — Foundry | 5 real source files (`.sol`, `Test.t.sol`, `Deploy.s.sol`, `foundry.toml`, `README.md`) | [`skills/confidential-fhevm/templates/foundry/`](skills/confidential-fhevm/templates/foundry/) |
| Templates — SDK v3 | 3 real source files (`useFHEContract.tsx`, `page.tsx`, `README.md`) | [`skills/confidential-fhevm/templates/sdk-v3/`](skills/confidential-fhevm/templates/sdk-v3/) |
| Static linter | **20 rules**, Solidity + frontend, machine-checkable | [`skills/confidential-fhevm/scripts/fhevm-lint.js`](skills/confidential-fhevm/scripts/fhevm-lint.js) |
| Lint fixtures | 12 deliberately-broken files exercising the rules | [`tests/fixtures/`](tests/fixtures/) |
| Cross-tool adapters | Cursor `.mdc` + Windsurf `.md` (Foundry + SDK-v3 aware) | [`adapters/`](adapters/) |

Pinned to current Zama versions: `@fhevm/solidity 0.11.1`, `forge-fhevm eba2324`, `@fhevm/hardhat-plugin 0.4.2`, `@zama-fhe/sdk 3.0.0`, `@zama-fhe/react-sdk 3.0.0`, `@zama-fhe/relayer-sdk 0.4.2`, Solidity 0.8.27 (EVM `cancun`), Foundry forge 1.5+, Next.js 15.2, React 19.

---

## Try it (one minute)

### Claude Code
```bash
git clone https://github.com/harystyleseze/confidential-fhevm-skill.git
mkdir -p .claude/skills
cp -R confidential-fhevm-skill/skills/confidential-fhevm .claude/skills/
# now prompt Claude Code: "Write me a confidential voting contract using FHEVM"
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

### As a dev dep (registers `npx fhevm-lint`)
```bash
# pnpm workspace (fhevm-react-template) — from the workspace root
pnpm add -w --save-dev github:harystyleseze/confidential-fhevm-skill

# standalone npm/yarn project
npm install --save-dev github:harystyleseze/confidential-fhevm-skill
```

---

## The validator (this is the differentiator)

Documentation tells an agent *what to do*. The validator stops it from shipping when it doesn't.

```bash
$ npx fhevm-lint contracts/Vote.sol
contracts/Vote.sol
  contracts/Vote.sol:42:9  [CRITICAL/AP-001]   function 'castVote' writes an encrypted handle to state but never calls FHE.allowThis(...)
      fix: Add `FHE.allowThis(stateVar);` after each encrypted state write so the contract can read its own state in subsequent transactions.
      note: Heuristic check: verify all state-writing functions manually.

Summary: 1 finding(s) — 1 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW
$ echo $?
1
```

The 20 rules (full table in [`skills/confidential-fhevm/scripts/README.md`](skills/confidential-fhevm/scripts/README.md)):

| Layer | Rules |
| --- | --- |
| **Solidity — CRITICAL** | AP-001 (missing `allowThis`, including struct-member writes), AP-002 (`if`/`require` on `ebool`), AP-003 (missing `ZamaEthereumConfig`), AP-004 (missing `fromExternal`), AP-005 (encrypted `div`/`rem`) |
| **Solidity — HIGH** | AP-006, AP-007, AP-008 (auto-suppressed when contract uses public decryption), AP-017 (`FHE.encrypt*` in loop) |
| **Solidity — MEDIUM** | AP-010, AP-011, AP-012, AP-013 (deprecated `TFHE.*`), AP-014, AP-018 (direct `FHE.decrypt` in prod) |
| **Solidity — LOW / INFO** | AP-015 (bytecodeHash), AP-016 (Solidity < 0.8.24), AP-009 (opt-in) |
| **Frontend — HIGH / MEDIUM / LOW** | AP-019 (SDK v2 hook imports), AP-020 (awaited fire-and-forget `mutate`), AP-021 (missing `NEXT_PUBLIC_ALCHEMY_API_KEY`) |

The validation hook is wired into the SKILL.md "output contract": the agent must run `npx fhevm-lint` on every generated contract before responding. See [`skills/confidential-fhevm/scripts/README.md`](skills/confidential-fhevm/scripts/README.md).

---

## Coverage matrix (bounty topics)

The bounty (`/Users/mac/Downloads/zama-fhe/zama-bounty/challenge.md` lines 27–40) lists twelve required topics. Each one has a dedicated reference file:

| Required topic | Coverage |
| --- | --- |
| FHEVM architecture and how FHE works on-chain | [`SKILL.md` §1](skills/confidential-fhevm/SKILL.md), [`references/01-mental-model.md`](skills/confidential-fhevm/references/01-mental-model.md) |
| Setting up the dev environment using the Hardhat template | [`references/02-project-setup.md`](skills/confidential-fhevm/references/02-project-setup.md), [`templates/hardhat.config.ts`](skills/confidential-fhevm/templates/hardhat.config.ts) |
| Setting up with Foundry (the current canonical) | [`references/13-foundry-toolchain.md`](skills/confidential-fhevm/references/13-foundry-toolchain.md), [`templates/foundry/`](skills/confidential-fhevm/templates/foundry/) |
| Encrypted types (`euint8`–`euint256`, `ebool`, `eaddress`) | [`references/03-type-system.md`](skills/confidential-fhevm/references/03-type-system.md) |
| FHE operations (arithmetic, comparison, conditional logic) | [`references/06-writing-contracts.md`](skills/confidential-fhevm/references/06-writing-contracts.md) §§ 2–3 |
| Access control (`FHE.allow`, `FHE.allowTransient`) | [`references/05-permission-model.md`](skills/confidential-fhevm/references/05-permission-model.md), [`SKILL.md` §4](skills/confidential-fhevm/SKILL.md) |
| Input proofs — what / why / how | [`references/04-encrypted-io.md`](skills/confidential-fhevm/references/04-encrypted-io.md), [`references/06-writing-contracts.md`](skills/confidential-fhevm/references/06-writing-contracts.md) §1 |
| User decryption (EIP-712 signing flow) | [`references/04-encrypted-io.md`](skills/confidential-fhevm/references/04-encrypted-io.md), [`references/14-sdk-v3-frontend.md`](skills/confidential-fhevm/references/14-sdk-v3-frontend.md) §3 |
| Public decryption patterns | [`references/06-writing-contracts.md`](skills/confidential-fhevm/references/06-writing-contracts.md) §6, [`references/14-sdk-v3-frontend.md`](skills/confidential-fhevm/references/14-sdk-v3-frontend.md) §4, [`examples/foundry/confidential-voting.md`](skills/confidential-fhevm/examples/foundry/confidential-voting.md) |
| Frontend integration with fhevmjs / Relayer SDK | [`references/14-sdk-v3-frontend.md`](skills/confidential-fhevm/references/14-sdk-v3-frontend.md) (v3, current), [`references/09-frontend-patterns.md`](skills/confidential-fhevm/references/09-frontend-patterns.md) (v2 legacy), [`templates/sdk-v3/`](skills/confidential-fhevm/templates/sdk-v3/) |
| Testing FHEVM contracts | [`references/07-testing-guide.md`](skills/confidential-fhevm/references/07-testing-guide.md) (Hardhat mocks), [`references/13-foundry-toolchain.md`](skills/confidential-fhevm/references/13-foundry-toolchain.md) §§3–5 (Foundry + `buildDecryptionProof`) |
| Common anti-patterns and mistakes | [`references/11-pitfall-catalog.md`](skills/confidential-fhevm/references/11-pitfall-catalog.md) (22 entries), [`scripts/fhevm-lint.js`](skills/confidential-fhevm/scripts/fhevm-lint.js) (20 enforced) |
| OpenZeppelin Confidential Contracts / ERC-7984 | [`references/10-erc7984-confidential-tokens.md`](skills/confidential-fhevm/references/10-erc7984-confidential-tokens.md) |

---

## Judging-criteria mapping

| Criterion (from `challenge.md`) | Where it shows up |
| --- | --- |
| **Accuracy** — correct, working FHEVM code; up-to-date API | API verified against `@fhevm/solidity 0.11.1` source; Foundry-track templates use only current symbols (`FHE.*`, `ZamaEthereumConfig`, `FHE.fromExternal`, `buildDecryptionProof`); SDK v3 hooks (`useEncrypt`, `useUserDecrypt`, `usePublicDecrypt`); zero deprecated `TFHE.*` or v2-hook references. Verified end-to-end against a clean clone of the official `fhevm-react-template`. |
| **Completeness** — full development workflow | SKILL.md sections 1–11; 15 numbered references covering writing, testing, deploying, and frontend integration on both tracks; 5+5+3 template files; 4 worked examples (3 Hardhat + 1 full Foundry) |
| **Agent effectiveness** — prompt → working dApp | One-prompt build of a confidential voting dApp: 17/17 forge tests pass, frontend builds clean, contract deploys to local anvil, dApp serves `/vote` route at HTTP 200. The complete artefact is reproduced inline in [`examples/foundry/confidential-voting.md`](skills/confidential-fhevm/examples/foundry/confidential-voting.md). |
| **Code quality** — clean, well-documented, best practice | Templates are real source files (not markdown wrappers); pass `fhevm-lint` clean; follow canonical Hardhat AND Foundry configs (Solidity 0.8.27, EVM `cancun`, optimizer 800 runs, `bytecodeHash: "none"`) |
| **Structure** — clear separation of references / examples / templates | Anthropic-canonical layout: `SKILL.md` (router, 386 lines) + `references/` (15 numbered files) + `examples/` (4 worked dApps) + `templates/` (3 sub-folders: Hardhat, Foundry, SDK v3) + `scripts/` (linter + verify). Cross-tool adapters in `adapters/` |
| **Error prevention** — avoids common pitfalls | `scripts/fhevm-lint.js` with 20 rules across Solidity AND frontend; `references/11-pitfall-catalog.md` with root cause + fix per pitfall (22 entries); `references/15-failure-modes.md` for operational gotchas; SKILL.md "validation hook" forces lint before agent response |

---

## Live demo

> Filled in after deploy.

- **Sepolia contract:** _(deploy with `pnpm deploy:sepolia` and paste the address)_
- **Live frontend:** _(deploy `packages/nextjs` to Vercel and paste the URL)_
- **Walk-through video** (≤ 3:00, real-person pitch): _(YouTube unlisted)_

The dApp generated by the skill during verification — every file reproduced verbatim — is in [`examples/foundry/confidential-voting.md`](skills/confidential-fhevm/examples/foundry/confidential-voting.md). Any judge can copy it into a fresh `fhevm-react-template` clone and run the same checks in a few minutes.

---

## Repository layout

```
confidential-fhevm-skill/
├── README.md                                    ← you are here
├── LICENSE                                      ← MIT
├── package.json                                 ← installs @solidity-parser/parser; declares fhevm-lint bin
├── skills/
│   └── confidential-fhevm/
│       ├── SKILL.md                              ← 386-line router (dual-track, ≤ 500 ceiling)
│       ├── references/                           ← 15 numbered deep-dive docs
│       ├── examples/                             ← 4 worked dApps
│       │   ├── private-dao-treasury.md           (Hardhat track)
│       │   ├── sealed-bid-marketplace.md         (Hardhat track)
│       │   ├── confidential-payroll.md           (Hardhat track)
│       │   └── foundry/confidential-voting.md    (Foundry track — full end-to-end)
│       ├── templates/                            ← Hardhat-track starter files
│       │   ├── foundry/                          ← Foundry-track starter files
│       │   └── sdk-v3/                           ← @zama-fhe/react-sdk v3 hook + page
│       └── scripts/                              ← fhevm-lint.js (20 rules) + verify.sh + README.md
├── adapters/
│   ├── cursor/.cursor/rules/fhevm.mdc            ← Cursor format (Foundry + SDK v3 aware)
│   └── windsurf/.windsurf/rules/fhevm.md         ← Windsurf format (same)
└── tests/fixtures/                               ← 11 deliberately-broken files, one per AP rule code
```

---

## Author

**Harystyles** — [GitHub](https://github.com/harystyleseze) · [X / Twitter](https://x.com/Harystylesdev) · Telegram `@DevHarystyles`

Built for the [Zama Developer Program — Mainnet Season 2](https://www.zama.org/post/zama-developer-program-mainnet-season-2-confidential-finance-is-the-next-frontier).
