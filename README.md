# confidential-fhevm-skill

An AI agent skill that teaches Claude Code, Cursor, and Windsurf how to build, test, and deploy confidential smart contracts on [Zama's FHEVM Protocol](https://docs.zama.org/protocol).

[![Skill format](https://img.shields.io/badge/SKILL.md-Anthropic%20Agent%20Skills-blue)](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
[![FHEVM](https://img.shields.io/badge/%40fhevm%2Fsolidity-0.11.1-FFD208)](https://docs.zama.org/protocol)
[![SDK](https://img.shields.io/badge/%40zama--fhe%2Fsdk-3.0.0-FFD208)](https://github.com/zama-ai/sdk)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## What this is

An [Anthropic Agent Skill](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) — a `SKILL.md` plus supporting references, templates, and scripts — that you drop into your AI coding agent's skill directory. Once installed, your agent gains end-to-end knowledge of how to write confidential smart contracts on FHEVM: encrypted types, FHE operations, the ACL permission model, public and user decryption, ERC-7984 confidential tokens, the matching test harnesses, deploy scripts, and a Next.js + wagmi + `@zama-fhe/react-sdk` v3 frontend.

It covers both toolchains Zama currently supports:

- **Foundry track** — `forge-fhevm` for tests, the official [`fhevm-react-template`](https://github.com/zama-ai/fhevm-react-template) for full-stack scaffolding, and SDK v3 on the frontend. This is the path Zama recommends today.
- **Hardhat track** — `@fhevm/hardhat-plugin` for mock-mode tests, the legacy [`fhevm-hardhat-template`](https://github.com/zama-ai/fhevm-hardhat-template) for contract-only projects, SDK v2 patterns on the frontend. Still supported for existing repositories.

The Solidity API (`@fhevm/solidity` 0.11.1) is identical between tracks. Only the surrounding tests, deploy scripts, and frontend hooks differ — the skill teaches both.

## Why use it

Without a skill like this, an AI agent asked to "write me a confidential voting contract using FHEVM" typically:

- Hallucinates FHE operations that don't exist (`FHE.if`, `FHE.encrypt(true)`, `TFHE.add`).
- Forgets to call `FHE.allowThis` after every state write, producing contracts whose state silently turns into null handles on the next transaction.
- Uses `if` / `require` on `ebool` (the EVM cannot evaluate ciphertexts; this either fails to compile or always takes one branch).
- Mixes up SDK v2 hooks (`useFhevm`, `useFHEEncryption`) with SDK v3 hooks (`useEncrypt`, `useUserDecrypt`, `usePublicDecrypt`).
- Skips `FHE.fromExternal` and tries to use `externalEuint*` parameters directly.
- Calls `FHE.decrypt(handle)` in a production contract (a test-only helper that doesn't exist on Sepolia).

With this skill installed, the agent reads the Solidity API from the same source `@fhevm/solidity` ships, follows a 23-item pitfall catalogue, and validates its own output against an executable linter (`fhevm-lint`) before returning code to you. The result is a contract that compiles, tests that pass, and a frontend that builds clean on first attempt.

## What's inside

```
confidential-fhevm-skill/
├── skills/confidential-fhevm/
│   ├── SKILL.md                         router doc — name, description, mental model, output contract
│   ├── references/                      17 numbered deep-dive docs (one per topic)
│   ├── examples/                        4 worked dApps (DAO voting, sealed-bid auction, payroll, confidential voting)
│   ├── templates/                       drop-in source files: Hardhat-track + Foundry-track + SDK v3 frontend
│   └── scripts/                         the fhevm-lint binary + a verify.sh smoke check
├── adapters/                            same guidance reformatted for Cursor (.mdc) and Windsurf (.md)
├── tests/fixtures/                      12 deliberately-broken Solidity / TypeScript files exercising each rule
└── package.json                         declares the fhevm-lint bin so `npx fhevm-lint` resolves anywhere
```

Pinned to current Zama versions: `@fhevm/solidity 0.11.1`, `forge-fhevm eba2324`, `@fhevm/hardhat-plugin 0.4.2`, `@zama-fhe/sdk 3.0.0`, `@zama-fhe/react-sdk 3.0.0`, `@zama-fhe/relayer-sdk 0.4.2`, Solidity 0.8.27 (EVM `cancun`), Foundry forge 1.5+, Hardhat 2.28+, Next.js 15.2, React 19, wagmi 2.19.

## Install

### Claude Code

```bash
git clone https://github.com/harystyleseze/confidential-fhevm-skill.git
mkdir -p .claude/skills
cp -R confidential-fhevm-skill/skills/confidential-fhevm .claude/skills/
```

Claude Code discovers skills under `.claude/skills/` automatically on the next session start. Verify with `/skills` inside Claude Code — `confidential-fhevm` should appear in the list.

### Cursor

```bash
git clone https://github.com/harystyleseze/confidential-fhevm-skill.git
mkdir -p .cursor/rules
cp confidential-fhevm-skill/adapters/cursor/.cursor/rules/fhevm.mdc .cursor/rules/
```

The rule's `globs` field is configured to auto-attach when you're editing `contracts/**/*.sol`, `packages/foundry/**/*.sol`, `test/**/*.ts`, `packages/nextjs/**/*.{ts,tsx}`, `hardhat.config.{ts,js}`, or `foundry.toml`. No manual activation needed.

### Windsurf

```bash
git clone https://github.com/harystyleseze/confidential-fhevm-skill.git
mkdir -p .windsurf/rules
cp confidential-fhevm-skill/adapters/windsurf/.windsurf/rules/fhevm.md .windsurf/rules/
```

The rule is set to `trigger: model_decision`, so Cascade pulls it in whenever the conversation touches FHEVM topics.

### As a dev dependency (gives you `npx fhevm-lint`)

If you want the linter on its own — for CI, pre-commit hooks, or invocation from a generated dApp — install the repository as a dev dependency. Use the package manager that matches your project; mixing managers inside a pnpm workspace produces broken bin symlinks.

```bash
# pnpm workspace (e.g. fhevm-react-template) — install from the workspace ROOT
pnpm add -w --save-dev github:harystyleseze/confidential-fhevm-skill

# standalone npm project
npm install --save-dev github:harystyleseze/confidential-fhevm-skill

# standalone yarn project
yarn add --dev github:harystyleseze/confidential-fhevm-skill
```

`npx fhevm-lint contracts/` will now run anywhere within that project.

## Quick start — your first confidential dApp

This walkthrough takes about ten minutes on a machine that already has Node ≥ 20, pnpm, Foundry (`forge` / `anvil` / `cast`), `jq`, and MetaMask.

### 1. Scaffold a project

```bash
git clone https://github.com/zama-ai/fhevm-react-template.git my-dapp
cd my-dapp
pnpm install
pnpm contracts:install        # forge soldeer install — required before `pnpm chain`
```

### 2. Drop the skill in

```bash
git clone https://github.com/harystyleseze/confidential-fhevm-skill.git ../skill-source
mkdir -p .claude/skills
cp -R ../skill-source/skills/confidential-fhevm .claude/skills/

# And install the linter as a workspace dev dep
pnpm add -w --save-dev github:harystyleseze/confidential-fhevm-skill
```

### 3. Replace `next.config.ts`

The template's default config will hit a `WagmiProviderNotFoundError` during dev because of two webpack module-resolution warnings that Next 15 escalates to errors. Copy the skill's drop-in replacement, which adds the four mitigations:

```bash
cp .claude/skills/confidential-fhevm/templates/sdk-v3/next.config.ts packages/nextjs/next.config.ts
```

### 4. Prompt the agent

Open Claude Code (or Cursor / Windsurf) in this directory and ask it to build something. For example:

> Write me a confidential voting contract using FHEVM. Members vote yes or no with encrypted weights, and the tally is publicly revealed after the deadline.

With the skill loaded, the agent produces eight things:

1. `packages/foundry/src/<Name>.sol` — the contract.
2. `packages/foundry/test/<Name>.t.sol` — a forge-fhevm test suite (uses cleartext-mode helpers like `encryptUint64`, `buildDecryptionProof`).
3. `packages/foundry/script/Deploy<Name>.s.sol` plus a patch to both `scripts/deploy-localhost.sh` and `scripts/deploy-sepolia.sh`.
4. `packages/nextjs/hooks/<feature>/use<Name>.tsx` — a wagmi + SDK v3 hook.
5. `packages/nextjs/app/page.tsx` — the dApp as the home route (not buried at a sub-path).
6. A `.env.example` at the repo root listing the env vars needed for Sepolia.
7. A `## Live demo` placeholder block in the project's README.
8. A lint pass: `npx fhevm-lint` reports zero CRITICAL or HIGH findings before the agent returns.

### 5. Build and test locally

```bash
# Compile
pnpm contracts:build

# Run the generated forge test suite in cleartext mode (no relayer needed)
pnpm contracts:test

# Run the static linter — should report 0 findings
npx fhevm-lint packages/foundry/src/ packages/nextjs/

# Build the frontend
pnpm next:build
```

### 6. Deploy locally and click around

In three terminals:

```bash
# Terminal 1 — anvil + the FHEVM cleartext host + the default FHECounter
pnpm chain

# Terminal 2 — deploy your contract (and any others wired into the script)
pnpm deploy:localhost

# Terminal 3 — Next.js dev server
pnpm start
```

Open `http://localhost:3000`, connect MetaMask to the local network (RPC `http://127.0.0.1:8545`, chain id 31337), and interact with the dApp. The home route is the new feature you built; the page surfaces a lifecycle stepper, a role-aware empty state (admin / member / spectator), and a copy-on-click anvil dev key so you can become the deployer wallet in one step if you're testing.

### 7. (Optional) Deploy to Sepolia

```bash
cp .env.example .env.local      # fill in SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, ETHERSCAN_API_KEY
pnpm deploy:sepolia
```

[`skills/confidential-fhevm/references/16-deployment-workflow.md`](skills/confidential-fhevm/references/16-deployment-workflow.md) walks through wallet creation, faucets, RPC choice, and the Etherscan V2 key for first-time deployers.

## The linter

`fhevm-lint` is a static analyser for FHEVM Solidity and frontend code. It runs on `.sol` / `.ts` / `.tsx` / `.js` / `.jsx` files and exits non-zero on CRITICAL or HIGH findings.

```bash
$ npx fhevm-lint contracts/Vote.sol
contracts/Vote.sol
  contracts/Vote.sol:42:9  [CRITICAL/AP-001]   function 'castVote' writes an encrypted handle to state but never calls FHE.allowThis(...)
      fix: Add `FHE.allowThis(stateVar);` after each encrypted state write so the contract can read its own state in subsequent transactions.
      note: Heuristic check — verify all state-writing functions manually.

Summary: 1 finding(s) — 1 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW
$ echo $?
1
```

It checks 20 rules across two layers:

| Layer | Codes | Examples |
| --- | --- | --- |
| Solidity (AST + regex) | AP-001 … AP-018 | missing `FHE.allowThis`, `if` / `require` on `ebool`, missing `ZamaEthereumConfig`, missing `FHE.fromExternal`, encrypted divisor, `FHE.encrypt*` inside loops, direct `FHE.decrypt` in production, deprecated `TFHE.*` namespace |
| Frontend (regex) | AP-019 … AP-021 | SDK v2 hook imports, awaited fire-and-forget `mutate`, missing `NEXT_PUBLIC_ALCHEMY_API_KEY` |

The full rule table with severities, heuristic boundaries, and fix examples is in [`skills/confidential-fhevm/scripts/README.md`](skills/confidential-fhevm/scripts/README.md). The complementary narrative catalogue (root cause + worked fix per pitfall) is in [`skills/confidential-fhevm/references/11-pitfall-catalog.md`](skills/confidential-fhevm/references/11-pitfall-catalog.md).

Useful invocations:

```bash
npx fhevm-lint contracts/MyContract.sol           # single file
npx fhevm-lint packages/foundry/src/              # whole directory
npx fhevm-lint --info contracts/                  # include INFO-level heuristics (off by default)
npx fhevm-lint --json contracts/ > findings.json  # machine-readable output for CI
```

## Documentation map

The skill is structured as a router (`SKILL.md`) plus deep-dive references. Open the reference for the topic you're working on:

| Topic | Reference |
| --- | --- |
| FHEVM architecture, handles, ACL, async decryption | [`01-mental-model.md`](skills/confidential-fhevm/references/01-mental-model.md) |
| Project setup (Hardhat track) | [`02-project-setup.md`](skills/confidential-fhevm/references/02-project-setup.md) |
| Encrypted types, op matrix, gas tiers | [`03-type-system.md`](skills/confidential-fhevm/references/03-type-system.md) |
| Encrypted input proofs, user / public decryption flows | [`04-encrypted-io.md`](skills/confidential-fhevm/references/04-encrypted-io.md) |
| ACL lifecycle — `allow`, `allowThis`, `allowTransient`, `makePubliclyDecryptable` | [`05-permission-model.md`](skills/confidential-fhevm/references/05-permission-model.md) |
| Writing contracts — pattern catalogue with worked snippets | [`06-writing-contracts.md`](skills/confidential-fhevm/references/06-writing-contracts.md) |
| Testing with `@fhevm/hardhat-plugin` (mock mode) | [`07-testing-guide.md`](skills/confidential-fhevm/references/07-testing-guide.md) |
| Deployment — `hardhat-deploy` and Foundry, Etherscan V2, Sourcify | [`08-deployment.md`](skills/confidential-fhevm/references/08-deployment.md) |
| Frontend patterns (legacy SDK v2) | [`09-frontend-patterns.md`](skills/confidential-fhevm/references/09-frontend-patterns.md) |
| ERC-7984 confidential tokens, wrap / unwrap | [`10-erc7984-confidential-tokens.md`](skills/confidential-fhevm/references/10-erc7984-confidential-tokens.md) |
| Pitfall catalogue (23 entries with root cause + fix) | [`11-pitfall-catalog.md`](skills/confidential-fhevm/references/11-pitfall-catalog.md) |
| Non-obvious production edge cases | [`12-production-edge-cases.md`](skills/confidential-fhevm/references/12-production-edge-cases.md) |
| Foundry toolchain — `forge-fhevm`, soldeer, cleartext-mode KMS proofs | [`13-foundry-toolchain.md`](skills/confidential-fhevm/references/13-foundry-toolchain.md) |
| `@zama-fhe/react-sdk` v3 hooks | [`14-sdk-v3-frontend.md`](skills/confidential-fhevm/references/14-sdk-v3-frontend.md) |
| Operational failure catalogue (when setup or build breaks) | [`15-failure-modes.md`](skills/confidential-fhevm/references/15-failure-modes.md) |
| Deployment workflow — env files, Sepolia, Vercel, post-deploy doc updates | [`16-deployment-workflow.md`](skills/confidential-fhevm/references/16-deployment-workflow.md) |
| UX patterns — lifecycle stepper, role banners, local-dev onboarding | [`17-ux-patterns.md`](skills/confidential-fhevm/references/17-ux-patterns.md) |

Four worked end-to-end examples live in [`skills/confidential-fhevm/examples/`](skills/confidential-fhevm/examples/). The Foundry-track [confidential voting example](skills/confidential-fhevm/examples/foundry/confidential-voting.md) reproduces the entire contract, test suite (17 cases including the full reveal happy path via `buildDecryptionProof`), deploy script patch, and frontend wiring inline — copy-paste straight into a fresh `fhevm-react-template`.

## Choosing a toolchain

| | Foundry track | Hardhat track |
| --- | --- | --- |
| When to pick | Greenfield projects starting from `zama-ai/fhevm-react-template`. Recommended for new work. | Existing Hardhat repositories. Contract-only projects that don't ship a frontend. |
| Test harness | `forge-fhevm` `FhevmTest` base class with `encryptUint64`, `decrypt`, `buildDecryptionProof` helpers | `@fhevm/hardhat-plugin` mock object — `fhevm.createEncryptedInput`, `fhevm.userDecryptEuint` |
| Deploy | `forge script` invoked by `pnpm deploy:localhost` / `pnpm deploy:sepolia` shell wrappers; frontend ABIs auto-regenerated | `hardhat-deploy` TypeScript modules with `func.id` / `func.tags`; manual ABI copy into the frontend |
| Frontend SDK | `@zama-fhe/sdk` 3.0.0 + `@zama-fhe/react-sdk` 3.0.0 (hooks: `useEncrypt`, `useUserDecrypt`, `usePublicDecrypt`, …) | Legacy `@zama-fhe/sdk` 2.x patterns (`Token` class) or the older `useFhevm` / `useFHEEncryption` / `useFHEDecrypt` hooks (deprecated; `fhevm-lint` AP-019 flags them) |
| Local FHE runtime | `RelayerCleartext` against anvil + the real FHEVM host stack | JS-side mock in the Hardhat plugin |
| End-to-end testability of `FHE.checkSignatures` | Yes, via `buildDecryptionProof` — the full public-reveal ceremony runs in unit tests | Sepolia-only — the mock doesn't expose an equivalent helper |

Solidity contracts are byte-identical between tracks. Only the surrounding tooling differs.

## Project structure

```
confidential-fhevm-skill/
├── README.md                                       this file
├── LICENSE                                         MIT
├── package.json                                    declares the fhevm-lint bin
├── adapters/
│   ├── cursor/.cursor/rules/fhevm.mdc              Cursor rule (auto-attach via globs)
│   └── windsurf/.windsurf/rules/fhevm.md           Windsurf rule (trigger: model_decision)
├── skills/
│   └── confidential-fhevm/
│       ├── SKILL.md                                router doc with the output contract
│       ├── references/                             17 numbered topic docs
│       ├── examples/
│       │   ├── private-dao-treasury.md             Hardhat-track example
│       │   ├── sealed-bid-marketplace.md           Hardhat-track example
│       │   ├── confidential-payroll.md             Hardhat-track example
│       │   └── foundry/confidential-voting.md      Foundry-track end-to-end example
│       ├── templates/
│       │   ├── contract.sol  test.ts  deploy.ts    Hardhat-track starters
│       │   ├── page.tsx  hardhat.config.ts
│       │   ├── foundry/                            Foundry-track starters + multi-contract deploy-sepolia.sh + .env.example
│       │   └── sdk-v3/                             SDK v3 hook + page + next.config.ts with webpack mitigations
│       └── scripts/
│           ├── fhevm-lint.js                       the linter (20 rules)
│           ├── verify.sh                           install + compile + test + lint smoke check
│           └── README.md                           linter reference, install instructions, rule table
└── tests/fixtures/                                 12 deliberately-broken files; one per rule code, exercised in CI
```

## Verifying the skill yourself

If you want to confirm the linter is doing what the docs claim, clone the repository and run it against the fixtures:

```bash
git clone https://github.com/harystyleseze/confidential-fhevm-skill.git
cd confidential-fhevm-skill
npm install                                      # only needs @solidity-parser/parser

# Clean templates — should exit 0 with no findings
npx fhevm-lint skills/confidential-fhevm/templates/

# Broken fixtures — should exit 1 with one finding per rule code
npx fhevm-lint tests/fixtures/
```

## Contributing

Issues and pull requests are welcome — particularly:

- **New rules.** If you've hit an FHEVM mistake the linter doesn't catch, open an issue with a minimal repro. New rules go in [`skills/confidential-fhevm/scripts/fhevm-lint.js`](skills/confidential-fhevm/scripts/fhevm-lint.js) with a matching fixture under `tests/fixtures/AP0NN_<name>.sol` (or `.tsx` for frontend rules).
- **New references.** If a topic in the skill is thin or out of date — `references/14-sdk-v3-frontend.md` will need updates as the SDK evolves, for example — file a PR with the corrected content.
- **New worked examples.** Examples live in `skills/confidential-fhevm/examples/`. Each is a self-contained markdown file showing the full contract + tests + deploy + frontend; the Foundry-track [`confidential-voting.md`](skills/confidential-fhevm/examples/foundry/confidential-voting.md) is the canonical shape to mirror.

Run `bash skills/confidential-fhevm/scripts/verify.sh` before submitting a PR; it installs, compiles, tests, and lints in one pass.

## License

[MIT](LICENSE).
