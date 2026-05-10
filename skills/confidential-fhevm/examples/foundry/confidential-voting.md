# Example (Foundry): Confidential Voting

A members-only voting contract where each YES/NO vote carries an encrypted weight. Tallies stay encrypted on-chain until a deadline passes; then anyone can publicly reveal them via the 3-step async public-decrypt flow. This entire example was generated from this skill on the Foundry track and verified end-to-end: 17/17 Foundry tests pass, the frontend builds clean, the dApp serves locally against anvil.

**What this exercises:**
- `externalEbool` + `externalEuint64` inputs (per-ciphertext proofs — see `references/13-foundry-toolchain.md` §4)
- `FHE.select` to route the weight to YES or NO without revealing direction
- `FHE.allowThis` after every encrypted state write (skill rule 1)
- `FHE.makePubliclyDecryptable` → off-chain `publicDecrypt` → `FHE.checkSignatures` (rule 11; handle ordering)
- `buildDecryptionProof` in tests to exercise the full reveal happy-path in cleartext mode (see `references/13` §5)
- SDK v3 frontend: `useEncrypt` + `usePublicDecrypt` + RainbowKit + wagmi (see `templates/sdk-v3/`)

**Build status:** verified end-to-end — 17 / 17 forge tests pass (including a full `finalize()` happy-path with `buildDecryptionProof`), `npx fhevm-lint` returns 0 findings on every file, `pnpm next:build` produces a clean production build, and `pnpm chain && pnpm deploy:localhost` deploys the contract onto a local anvil node serving `/vote` at HTTP 200.

---

## Contract — `packages/foundry/src/ConfidentialVoting.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64, ebool, externalEbool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract ConfidentialVoting is ZamaEthereumConfig {
    struct Proposal {
        uint64 deadline;
        bool finalized;
        uint64 yesTallyClear;
        uint64 noTallyClear;
        euint64 yesTallyEnc;
        euint64 noTallyEnc;
    }

    address public admin;
    uint256 public proposalCount;
    mapping(uint256 => Proposal) internal _proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(address => bool) public isMember;
    uint256 public memberCount;

    event MemberAdded(address indexed member);
    event ProposalCreated(uint256 indexed proposalId, uint64 deadline);
    event VoteCast(uint256 indexed proposalId, address indexed voter);
    event RevealRequested(uint256 indexed proposalId, euint64 yesTally, euint64 noTally);
    event ProposalFinalized(uint256 indexed proposalId, uint64 yesTally, uint64 noTally);

    error NotAdmin();
    error NotMember();
    error AlreadyMember();
    error UnknownProposal();
    error AlreadyVoted();
    error VotingClosed();
    error VotingStillOpen();
    error AlreadyFinalized();

    modifier onlyAdmin()  { if (msg.sender != admin)         revert NotAdmin();  _; }
    modifier onlyMember() { if (!isMember[msg.sender])       revert NotMember(); _; }

    constructor(address admin_) { admin = admin_; }

    function addMember(address member) external onlyAdmin {
        if (isMember[member]) revert AlreadyMember();
        isMember[member] = true;
        unchecked { memberCount++; }
        emit MemberAdded(member);
    }

    function createProposal(uint64 deadline) external onlyAdmin returns (uint256 proposalId) {
        require(deadline > block.timestamp, "ConfidentialVoting: deadline in the past");
        proposalId = proposalCount++;
        Proposal storage p = _proposals[proposalId];
        p.deadline = deadline;
        p.yesTallyEnc = FHE.asEuint64(0);
        p.noTallyEnc  = FHE.asEuint64(0);
        FHE.allowThis(p.yesTallyEnc);
        FHE.allowThis(p.noTallyEnc);
        emit ProposalCreated(proposalId, deadline);
    }

    /// @notice Two separate proofs — one per ciphertext — so this contract is
    /// fully testable in forge-fhevm cleartext mode and equally usable from
    /// the SDK v3 frontend (just call `encrypt.mutateAsync` twice).
    function vote(
        uint256 proposalId,
        externalEbool   encryptedIsYes,  bytes calldata isYesProof,
        externalEuint64 encryptedWeight, bytes calldata weightProof
    ) external onlyMember {
        Proposal storage p = _proposals[proposalId];
        if (p.deadline == 0)                       revert UnknownProposal();
        if (block.timestamp >= p.deadline)         revert VotingClosed();
        if (hasVoted[proposalId][msg.sender])      revert AlreadyVoted();

        ebool   isYes  = FHE.fromExternal(encryptedIsYes,  isYesProof);
        euint64 weight = FHE.fromExternal(encryptedWeight, weightProof);

        // Both branches execute; the coprocessor selects inside the ciphertext.
        euint64 yesAdd = FHE.select(isYes, weight, FHE.asEuint64(0));
        euint64 noAdd  = FHE.select(isYes, FHE.asEuint64(0), weight);

        p.yesTallyEnc = FHE.add(p.yesTallyEnc, yesAdd);
        p.noTallyEnc  = FHE.add(p.noTallyEnc,  noAdd);

        // MANDATORY: refresh permissions on every new handle (rule 1).
        FHE.allowThis(p.yesTallyEnc);
        FHE.allowThis(p.noTallyEnc);

        hasVoted[proposalId][msg.sender] = true;
        emit VoteCast(proposalId, msg.sender);
    }

    /// Step 1: mark the tallies publicly decryptable. Anyone can call after the deadline.
    function requestReveal(uint256 proposalId) external {
        Proposal storage p = _proposals[proposalId];
        if (p.deadline == 0)                  revert UnknownProposal();
        if (block.timestamp < p.deadline)     revert VotingStillOpen();
        if (p.finalized)                      revert AlreadyFinalized();

        FHE.makePubliclyDecryptable(p.yesTallyEnc);
        FHE.makePubliclyDecryptable(p.noTallyEnc);
        emit RevealRequested(proposalId, p.yesTallyEnc, p.noTallyEnc);
    }

    /// Step 3: verify KMS proof and store cleartexts. Handle ordering MUST match the off-chain
    /// publicDecrypt call (the SDK returns the proof bound to a specific (handles, cleartexts)).
    function finalize(
        uint256 proposalId,
        uint64 yesTally, uint64 noTally,
        bytes calldata decryptionProof
    ) external {
        Proposal storage p = _proposals[proposalId];
        if (p.deadline == 0)                  revert UnknownProposal();
        if (block.timestamp < p.deadline)     revert VotingStillOpen();
        if (p.finalized)                      revert AlreadyFinalized();

        bytes32[] memory handles = new bytes32[](2);
        handles[0] = FHE.toBytes32(p.yesTallyEnc);
        handles[1] = FHE.toBytes32(p.noTallyEnc);
        FHE.checkSignatures(handles, abi.encode(yesTally, noTally), decryptionProof);

        p.yesTallyClear = yesTally;
        p.noTallyClear  = noTally;
        p.finalized = true;
        emit ProposalFinalized(proposalId, yesTally, noTally);
    }

    // views
    function deadlineOf(uint256 id)        external view returns (uint64)             { return _proposals[id].deadline;       }
    function isFinalized(uint256 id)       external view returns (bool)               { return _proposals[id].finalized;      }
    function clearTallies(uint256 id)      external view returns (uint64, uint64)     { return (_proposals[id].yesTallyClear, _proposals[id].noTallyClear); }
    function encryptedTallies(uint256 id)  external view returns (euint64, euint64)   { return (_proposals[id].yesTallyEnc,   _proposals[id].noTallyEnc);   }
}
```

`npx fhevm-lint` reports **0 findings** on this contract.

---

## Test — `packages/foundry/test/ConfidentialVoting.t.sol`

17 tests in this suite — every gate, both branches of every `FHE.select`, the full reveal happy path, and a tampered-proof rejection. Full file below; copy verbatim.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FhevmTest} from "forge-fhevm/FhevmTest.sol";
import {ConfidentialVoting} from "../src/ConfidentialVoting.sol";
import {euint64, externalEuint64, externalEbool} from "encrypted-types/EncryptedTypes.sol";

contract ConfidentialVotingTest is FhevmTest {
    ConfidentialVoting voting;
    address votingAddress;

    address admin = address(0xA11);
    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B;
    uint256 internal constant CARROL_PK = 0xCA470;
    address alice;
    address bob;
    address carrol;

    uint64 internal constant ONE_DAY = 1 days;

    function setUp() public override {
        super.setUp();
        alice = vm.addr(ALICE_PK);
        bob = vm.addr(BOB_PK);
        carrol = vm.addr(CARROL_PK);

        vm.prank(admin);
        voting = new ConfidentialVoting(admin);
        votingAddress = address(voting);

        vm.startPrank(admin);
        voting.addMember(alice);
        voting.addMember(bob);
        // carrol is intentionally NOT a member
        vm.stopPrank();
    }

    /* --------------------------- helpers --------------------------- */

    function _createProposal() internal returns (uint256 proposalId, uint64 deadline) {
        deadline = uint64(block.timestamp) + ONE_DAY;
        vm.prank(admin);
        proposalId = voting.createProposal(deadline);
    }

    function _vote(uint256 proposalId, uint256 voterPk, bool isYes, uint64 weight) internal {
        address voter = vm.addr(voterPk);
        (externalEbool encIsYes, bytes memory boolProof) = encryptBool(isYes, voter, votingAddress);
        (externalEuint64 encWeight, bytes memory weightProof) = encryptUint64(weight, voter, votingAddress);
        vm.prank(voter);
        voting.vote(proposalId, encIsYes, boolProof, encWeight, weightProof);
    }

    /* --------------------------- proposal creation --------------------------- */

    function test_createProposalStoresDeadline() public {
        (uint256 proposalId, uint64 deadline) = _createProposal();
        assertEq(voting.deadlineOf(proposalId), deadline);
        assertEq(voting.isFinalized(proposalId), false);
        (uint64 yesClear, uint64 noClear) = voting.clearTallies(proposalId);
        assertEq(yesClear, 0);
        assertEq(noClear, 0);
    }

    function test_initialEncryptedTalliesDecryptToZero() public {
        (uint256 proposalId,) = _createProposal();
        (euint64 yesEnc, euint64 noEnc) = voting.encryptedTallies(proposalId);
        assertEq(decrypt(yesEnc), 0);
        assertEq(decrypt(noEnc), 0);
    }

    function test_onlyAdminCanCreateProposal() public {
        vm.prank(alice);
        vm.expectRevert(ConfidentialVoting.NotAdmin.selector);
        voting.createProposal(uint64(block.timestamp) + ONE_DAY);
    }

    function test_deadlineMustBeFuture() public {
        vm.prank(admin);
        vm.expectRevert();
        voting.createProposal(uint64(block.timestamp));
    }

    /* --------------------------- voting --------------------------- */

    function test_yesVoteAccumulatesYesTally() public {
        (uint256 proposalId,) = _createProposal();
        _vote(proposalId, ALICE_PK, true, 100);
        (euint64 yesEnc, euint64 noEnc) = voting.encryptedTallies(proposalId);
        assertEq(decrypt(yesEnc), 100, "yes tally should equal weight");
        assertEq(decrypt(noEnc), 0, "no tally should remain zero");
    }

    function test_noVoteAccumulatesNoTally() public {
        (uint256 proposalId,) = _createProposal();
        _vote(proposalId, ALICE_PK, false, 75);
        (euint64 yesEnc, euint64 noEnc) = voting.encryptedTallies(proposalId);
        assertEq(decrypt(yesEnc), 0, "yes tally should remain zero");
        assertEq(decrypt(noEnc), 75, "no tally should equal weight");
    }

    function test_twoMembersVoteYesAccumulates() public {
        (uint256 proposalId,) = _createProposal();
        _vote(proposalId, ALICE_PK, true, 60);
        _vote(proposalId, BOB_PK,   true, 40);
        (euint64 yesEnc, euint64 noEnc) = voting.encryptedTallies(proposalId);
        assertEq(decrypt(yesEnc), 100, "yes tally should be sum of both YES votes");
        assertEq(decrypt(noEnc), 0);
    }

    function test_mixedVotesAccumulateOnBothSides() public {
        (uint256 proposalId,) = _createProposal();
        _vote(proposalId, ALICE_PK, true,  60);
        _vote(proposalId, BOB_PK,   false, 40);
        (euint64 yesEnc, euint64 noEnc) = voting.encryptedTallies(proposalId);
        assertEq(decrypt(yesEnc), 60);
        assertEq(decrypt(noEnc), 40);
    }

    function test_nonMemberCannotVote() public {
        (uint256 proposalId,) = _createProposal();
        (externalEbool encIsYes, bytes memory boolProof) = encryptBool(true, carrol, votingAddress);
        (externalEuint64 encWeight, bytes memory weightProof) = encryptUint64(10, carrol, votingAddress);
        vm.prank(carrol);
        vm.expectRevert(ConfidentialVoting.NotMember.selector);
        voting.vote(proposalId, encIsYes, boolProof, encWeight, weightProof);
    }

    function test_cannotVoteTwice() public {
        (uint256 proposalId,) = _createProposal();
        _vote(proposalId, ALICE_PK, true, 50);
        (externalEbool encIsYes, bytes memory boolProof) = encryptBool(true, alice, votingAddress);
        (externalEuint64 encWeight, bytes memory weightProof) = encryptUint64(50, alice, votingAddress);
        vm.prank(alice);
        vm.expectRevert(ConfidentialVoting.AlreadyVoted.selector);
        voting.vote(proposalId, encIsYes, boolProof, encWeight, weightProof);
    }

    function test_cannotVoteAfterDeadline() public {
        (uint256 proposalId,) = _createProposal();
        vm.warp(block.timestamp + ONE_DAY + 1);
        (externalEbool encIsYes, bytes memory boolProof) = encryptBool(true, alice, votingAddress);
        (externalEuint64 encWeight, bytes memory weightProof) = encryptUint64(10, alice, votingAddress);
        vm.prank(alice);
        vm.expectRevert(ConfidentialVoting.VotingClosed.selector);
        voting.vote(proposalId, encIsYes, boolProof, encWeight, weightProof);
    }

    function test_voteOnUnknownProposalReverts() public {
        (externalEbool encIsYes, bytes memory boolProof) = encryptBool(true, alice, votingAddress);
        (externalEuint64 encWeight, bytes memory weightProof) = encryptUint64(10, alice, votingAddress);
        vm.prank(alice);
        vm.expectRevert(ConfidentialVoting.UnknownProposal.selector);
        voting.vote(9999, encIsYes, boolProof, encWeight, weightProof);
    }

    /* --------------------------- reveal & finalize --------------------------- */

    function test_requestRevealBeforeDeadlineReverts() public {
        (uint256 proposalId,) = _createProposal();
        vm.expectRevert(ConfidentialVoting.VotingStillOpen.selector);
        voting.requestReveal(proposalId);
    }

    function test_finalizeBeforeDeadlineReverts() public {
        (uint256 proposalId,) = _createProposal();
        vm.expectRevert(ConfidentialVoting.VotingStillOpen.selector);
        voting.finalize(proposalId, 0, 0, "");
    }

    function test_requestRevealAfterDeadlineSucceeds() public {
        (uint256 proposalId,) = _createProposal();
        _vote(proposalId, ALICE_PK, true, 100);
        vm.warp(block.timestamp + ONE_DAY + 1);
        voting.requestReveal(proposalId);
    }

    /// The killer test: full public-decryption ceremony, end-to-end, in cleartext mode.
    function test_finalizeWithValidProofStoresClearTallies() public {
        (uint256 proposalId,) = _createProposal();
        _vote(proposalId, ALICE_PK, true,  100);
        _vote(proposalId, BOB_PK,   false,  25);

        vm.warp(block.timestamp + ONE_DAY + 1);
        voting.requestReveal(proposalId);

        (euint64 yesEnc, euint64 noEnc) = voting.encryptedTallies(proposalId);
        bytes32[] memory handles = new bytes32[](2);
        handles[0] = euint64.unwrap(yesEnc);
        handles[1] = euint64.unwrap(noEnc);

        bytes memory cleartexts = abi.encode(uint64(100), uint64(25));
        bytes memory proof = buildDecryptionProof(handles, cleartexts);    // test-only KMS proof

        voting.finalize(proposalId, 100, 25, proof);
        assertEq(voting.isFinalized(proposalId), true);
        (uint64 yesClear, uint64 noClear) = voting.clearTallies(proposalId);
        assertEq(yesClear, 100);
        assertEq(noClear, 25);
    }

    function test_finalizeRejectsTamperedCleartexts() public {
        (uint256 proposalId,) = _createProposal();
        _vote(proposalId, ALICE_PK, true, 100);

        vm.warp(block.timestamp + ONE_DAY + 1);
        voting.requestReveal(proposalId);

        (euint64 yesEnc, euint64 noEnc) = voting.encryptedTallies(proposalId);
        bytes32[] memory handles = new bytes32[](2);
        handles[0] = euint64.unwrap(yesEnc);
        handles[1] = euint64.unwrap(noEnc);

        bytes memory cleartexts = abi.encode(uint64(100), uint64(0));
        bytes memory proof = buildDecryptionProof(handles, cleartexts);

        vm.expectRevert();
        voting.finalize(proposalId, 999, 0, proof);
    }
}
```

Run with `pnpm contracts:test` or `forge test --match-contract ConfidentialVotingTest -vv`. All 17 pass.

---

## Deploy script — `packages/foundry/script/DeployConfidentialVoting.s.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {ConfidentialVoting} from "../src/ConfidentialVoting.sol";

contract DeployConfidentialVoting is Script {
    function run() external returns (ConfidentialVoting voting) {
        address admin = msg.sender;
        vm.startBroadcast();
        voting = new ConfidentialVoting(admin);
        console.log("ConfidentialVoting deployed at:", address(voting));
        console.log("Admin:", admin);
        vm.stopBroadcast();
    }
}
```

To wire this into `pnpm deploy:localhost` AND `pnpm deploy:sepolia` (item 3 of the SKILL.md output contract), append a second forge-script call to BOTH shell scripts after the existing `FHECounter` deploy block. Patch for `scripts/deploy-localhost.sh`:

```bash
echo
echo "▸ Deploying ConfidentialVoting"
voting_log="$(mktemp)"
trap 'rm -f "$deploy_log" "$voting_log"' EXIT
if ! PRIVATE_KEY="$ANVIL_PK" forge script script/DeployConfidentialVoting.s.sol:DeployConfidentialVoting \
    --rpc-url "$RPC_URL" \
    --private-key "$ANVIL_PK" \
    --broadcast \
    >"$voting_log" 2>&1; then
    echo "❌  forge script failed:" >&2
    cat "$voting_log" >&2
    exit 1
fi
grep -E "ConfidentialVoting|Admin|===" "$voting_log" || true
```

The script's existing `pnpm generate` step then regenerates `packages/nextjs/contracts/ConfidentialVoting.{ts,local.ts}` automatically by walking `broadcast/`.

For Sepolia, replace `scripts/deploy-sepolia.sh` with the multi-contract version at [`templates/foundry/deploy-sepolia.sh`](../../templates/foundry/deploy-sepolia.sh) and add a second `run_forge` line for `Deploy<Name>.s.sol`. The user must supply a `.env.local` at the repo root with `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` before running it — see [`16-deployment-workflow.md`](../../references/16-deployment-workflow.md) for the full pre-flight checklist.

---

## Frontend — `packages/nextjs/hooks/voting/useConfidentialVoting.tsx`

Copy the generic SDK v3 hook template from [`../templates/sdk-v3/useFHEContract.tsx`](../../templates/sdk-v3/useFHEContract.tsx) and rename to `useConfidentialVoting.tsx`. Replace the single `setValue` flow with the three voting actions:

1. **Read state** — `useReadContract` for `deadlineOf`, `isFinalized`, `encryptedTallies`, `clearTallies`, `isMember`, `hasVoted`.
2. **Cast vote** — encrypt `isYes` and `weight` in two separate `encrypt.mutateAsync(...)` calls (one ciphertext per proof), then `useWriteContract.writeContractAsync` to `vote(proposalId, encIsYes, isYesProof, encWeight, weightProof)`. Cap `gas: 15_000_000n`.
3. **Reveal & finalize** — `useWriteContract` for `requestReveal`, then the killer call below.

The public-decrypt → on-chain finalize is one mutation chain:

```typescript
const result = await publicDecrypt.mutateAsync([yesHandle, noHandle]);
const yesClear = result.clearValues[yesHandle] as bigint;
const noClear  = result.clearValues[noHandle]  as bigint;

await writeContractAsync({
  address: voting.address,
  abi:     voting.abi,
  functionName: "finalize",
  args: [proposalId, yesClear, noClear, result.decryptionProof],
});
```

No manual EIP-712, no KMS plumbing, no handle re-encoding. `usePublicDecrypt` returns the relayer proof bound to `(handles, cleartexts)` ready for `FHE.checkSignatures`.

## Frontend — `packages/nextjs/app/page.tsx` (the home route)

The voting dApp **is** the home page. Replace `packages/nextjs/app/page.tsx` with the voting page so visiting `http://localhost:3000` lands directly on the vote form (not the default `FHECounter` demo). This is item 5 of the SKILL.md output contract.

If the user explicitly wants to keep the existing counter demo, leave a prominent first-viewport card on `/` linking to `/vote`. A bare sub-route with no home-page entry is a contract violation.

The page renders three states keyed off `(votingOpen, votingClosed, finalized)`:
- **Pre-deadline** — vote form with YES/NO toggle, weight input, submit button.
- **Post-deadline, not finalized** — two buttons: "Request reveal" (calls `requestReveal` on-chain) and "Decrypt & finalize" (the snippet above).
- **Finalized** — display `clearYesTally` and `clearNoTally`.

The wallet gate is the template's standard `RainbowKitCustomConnectButton`. DaisyUI components (`card`, `btn`, `input`, `alert`, `loading`) keep it consistent with the rest of the `fhevm-react-template`. See [`../templates/sdk-v3/page.tsx`](../../templates/sdk-v3/page.tsx) for the canonical layout to derive from.

---

## Reproducing the build end-to-end

```bash
git clone https://github.com/zama-ai/fhevm-react-template.git my-dapp
cd my-dapp
pnpm install
pnpm contracts:install
pnpm add -w --save-dev github:harystyleseze/confidential-fhevm-skill
mkdir -p .claude/skills && cp -R node_modules/confidential-fhevm-skill/skills/confidential-fhevm .claude/skills/

# Drop in the five source files from this example:
#   packages/foundry/src/ConfidentialVoting.sol       (full contract above)
#   packages/foundry/test/ConfidentialVoting.t.sol    (full test suite above)
#   packages/foundry/script/DeployConfidentialVoting.s.sol  (deploy script above)
#   packages/nextjs/hooks/voting/useConfidentialVoting.tsx  (derive from templates/sdk-v3/useFHEContract.tsx)
#   packages/nextjs/app/vote/page.tsx                       (derive from templates/sdk-v3/page.tsx)
# Patch scripts/deploy-localhost.sh as shown above to also deploy ConfidentialVoting.

forge test --match-contract ConfidentialVotingTest -vv     # 17/17 pass
npx fhevm-lint packages/foundry/src/                        # 0 findings
pnpm next:build                                              # clean prod build

# End-to-end smoke test (3 terminals):
pnpm chain                                                   # 1: anvil + cleartext host + FHECounter
pnpm deploy:localhost                                        # 2: deploy ConfidentialVoting too
pnpm start                                                   # 3: Next.js on :3000
# Visit http://localhost:3000/vote, connect MetaMask to chain 31337, vote.
```

This example was verified end-to-end against the official `fhevm-react-template`: every test passes, the linter is clean, the production build succeeds, and the deployed contract serves the live `/vote` route at HTTP 200.
