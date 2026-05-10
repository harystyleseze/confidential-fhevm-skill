# Example: Private DAO Treasury

A governance contract where DAO members vote on treasury proposals with encrypted vote weights. When a public quorum threshold is reached, the vote tally is publicly decrypted and funds are released if the proposal passes. Demonstrates: encrypted accumulation, public decryption (3-step async flow), mixing encrypted and plaintext state, state machine pattern.

## Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool, externalEbool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title PrivateDAOTreasury
/// @notice Encrypted vote weights with threshold-based public reveal and fund release.
contract PrivateDAOTreasury is ZamaEthereumConfig {
    enum ProposalState { Active, RevealRequested, Finalized, Rejected }

    struct Proposal {
        string description;
        address payable recipient;
        uint256 requestedAmount;
        euint64 encryptedYesVotes;
        euint64 encryptedNoVotes;
        uint256 voteCount;       // Public counter for quorum check
        uint256 quorum;
        uint256 deadline;
        ProposalState state;
        uint64 finalYesVotes;    // Populated after decryption
        uint64 finalNoVotes;
    }

    address public admin;
    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(address => bool) public isMember;
    uint256 public memberCount;

    event ProposalCreated(uint256 indexed id, string description, uint256 requestedAmount);
    event VoteCast(uint256 indexed proposalId, address indexed voter);
    event RevealRequested(uint256 indexed proposalId, euint64 yesVotes, euint64 noVotes);
    event ProposalFinalized(uint256 indexed proposalId, uint64 yesVotes, uint64 noVotes, bool passed);

    error NotAdmin();
    error NotMember();
    error AlreadyVoted();
    error VotingNotActive();
    error VotingStillActive();
    error InvalidState();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyMember() {
        if (!isMember[msg.sender]) revert NotMember();
        _;
    }

    constructor() {
        admin = msg.sender;
        isMember[msg.sender] = true;
        memberCount = 1;
    }

    receive() external payable {} // Accept ETH for treasury

    function addMember(address member) external onlyAdmin {
        if (!isMember[member]) {
            isMember[member] = true;
            memberCount++;
        }
    }

    /// @notice Create a new spending proposal.
    function createProposal(
        string calldata description,
        address payable recipient,
        uint256 requestedAmount,
        uint256 quorum,
        uint256 votingDurationSeconds
    ) external onlyAdmin returns (uint256) {
        uint256 id = proposalCount++;

        // Initialize encrypted vote tallies to zero
        euint64 zeroVotes = FHE.asEuint64(0);
        proposals[id].description = description;
        proposals[id].recipient = recipient;
        proposals[id].requestedAmount = requestedAmount;
        proposals[id].encryptedYesVotes = zeroVotes;
        proposals[id].encryptedNoVotes = FHE.asEuint64(0);
        proposals[id].quorum = quorum;
        proposals[id].deadline = block.timestamp + votingDurationSeconds;
        proposals[id].state = ProposalState.Active;

        FHE.allowThis(proposals[id].encryptedYesVotes);
        FHE.allowThis(proposals[id].encryptedNoVotes);

        emit ProposalCreated(id, description, requestedAmount);
        return id;
    }

    /// @notice Cast an encrypted vote weight on a proposal.
    /// @param voteWeight How many tokens/weight to assign (encrypted).
    /// @param voteYes Whether this weight goes to YES or NO (encrypted boolean).
    function vote(
        uint256 proposalId,
        externalEuint64 voteWeight,
        externalEbool voteYes,
        bytes calldata inputProof
    ) external onlyMember {
        Proposal storage p = proposals[proposalId];
        if (p.state != ProposalState.Active) revert VotingNotActive();
        if (block.timestamp >= p.deadline) revert VotingNotActive();
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted();

        euint64 weight = FHE.fromExternal(voteWeight, inputProof);
        ebool isYes = FHE.fromExternal(voteYes, inputProof);

        // Add weight to the selected tally. FHE.select routes the weight
        // to YES or NO without revealing which way this member voted.
        euint64 yesIncrement = FHE.select(isYes, weight, FHE.asEuint64(0));
        euint64 noIncrement = FHE.select(isYes, FHE.asEuint64(0), weight);

        p.encryptedYesVotes = FHE.add(p.encryptedYesVotes, yesIncrement);
        p.encryptedNoVotes = FHE.add(p.encryptedNoVotes, noIncrement);

        // Refresh permissions on the updated tallies
        FHE.allowThis(p.encryptedYesVotes);
        FHE.allowThis(p.encryptedNoVotes);

        hasVoted[proposalId][msg.sender] = true;
        p.voteCount++; // Public counter — safe to increment publicly

        emit VoteCast(proposalId, msg.sender);
    }

    /// @notice Step 1 of public reveal: mark tallies as publicly decryptable.
    function requestReveal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (p.state != ProposalState.Active) revert InvalidState();
        if (block.timestamp < p.deadline && p.voteCount < p.quorum) {
            revert VotingStillActive();
        }

        p.state = ProposalState.RevealRequested;

        // These calls permanently authorize anyone to decrypt the tallies.
        FHE.makePubliclyDecryptable(p.encryptedYesVotes);
        FHE.makePubliclyDecryptable(p.encryptedNoVotes);

        emit RevealRequested(proposalId, p.encryptedYesVotes, p.encryptedNoVotes);
    }

    /// @notice Step 3 of public reveal: verify proof and execute proposal.
    function finalizeProposal(
        uint256 proposalId,
        uint64 yesVotes,
        uint64 noVotes,
        bytes calldata decryptionProof
    ) external {
        Proposal storage p = proposals[proposalId];
        if (p.state != ProposalState.RevealRequested) revert InvalidState();

        // Build handles array in the SAME ORDER as the RevealRequested event.
        // The proof is bound to this exact ordering.
        bytes32[] memory handles = new bytes32[](2);
        handles[0] = FHE.toBytes32(p.encryptedYesVotes);
        handles[1] = FHE.toBytes32(p.encryptedNoVotes);

        // ABI encode cleartexts in matching order
        bytes memory encoded = abi.encode(yesVotes, noVotes);

        // Verify the KMS decryption proof. Reverts if invalid.
        FHE.checkSignatures(handles, encoded, decryptionProof);

        p.finalYesVotes = yesVotes;
        p.finalNoVotes = noVotes;

        bool passed = yesVotes > noVotes;
        if (passed && address(this).balance >= p.requestedAmount) {
            p.state = ProposalState.Finalized;
            p.recipient.transfer(p.requestedAmount);
        } else {
            p.state = ProposalState.Rejected;
        }

        emit ProposalFinalized(proposalId, yesVotes, noVotes, passed);
    }

    function getProposalVotes(uint256 proposalId) external view returns (euint64, euint64) {
        Proposal storage p = proposals[proposalId];
        return (p.encryptedYesVotes, p.encryptedNoVotes);
    }
}
```

## Test

```typescript
import {expect} from "chai";
import {ethers, fhevm} from "hardhat";
import {FhevmType} from "@fhevm/hardhat-plugin";

describe("PrivateDAOTreasury", function () {
  let contract: any;
  let contractAddress: string;
  let admin: any, alice: any, bob: any, carol: any;

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    [admin, alice, bob, carol] = await ethers.getSigners();

    const factory = await ethers.getContractFactory("PrivateDAOTreasury");
    contract = await factory.connect(admin).deploy();
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();

    // Fund the treasury
    await admin.sendTransaction({to: contractAddress, value: ethers.parseEther("10")});

    // Add members
    await contract.connect(admin).addMember(alice.address);
    await contract.connect(admin).addMember(bob.address);
    await contract.connect(admin).addMember(carol.address);
  });

  it("should accumulate encrypted votes and reach quorum", async function () {
    // Create proposal: send 1 ETH to alice, quorum = 2, 1 hour deadline
    await contract.connect(admin).createProposal(
      "Fund project Alpha",
      alice.address,
      ethers.parseEther("1"),
      2,   // quorum
      3600, // 1 hour
    );

    // Alice votes YES with weight 100
    const aliceVote = await fhevm
      .createEncryptedInput(contractAddress, alice.address)
      .add64(100)        // vote weight
      .addBool(true)     // YES vote
      .encrypt();
    await contract.connect(alice).vote(
      0, aliceVote.handles[0], aliceVote.handles[1], aliceVote.inputProof,
    );

    // Bob votes NO with weight 40
    const bobVote = await fhevm
      .createEncryptedInput(contractAddress, bob.address)
      .add64(40)
      .addBool(false)    // NO vote
      .encrypt();
    await contract.connect(bob).vote(
      0, bobVote.handles[0], bobVote.handles[1], bobVote.inputProof,
    );

    // Quorum reached (2 votes). Request reveal.
    await contract.requestReveal(0);

    // Verify state
    const state = (await contract.proposals(0)).state;
    expect(state).to.equal(1); // RevealRequested
  });

  it("should prevent double voting", async function () {
    await contract.connect(admin).createProposal(
      "Test", alice.address, ethers.parseEther("1"), 3, 3600,
    );

    const enc = await fhevm
      .createEncryptedInput(contractAddress, alice.address)
      .add64(50)
      .addBool(true)
      .encrypt();
    await contract.connect(alice).vote(0, enc.handles[0], enc.handles[1], enc.inputProof);

    // Second vote should fail
    const enc2 = await fhevm
      .createEncryptedInput(contractAddress, alice.address)
      .add64(50)
      .addBool(true)
      .encrypt();
    await expect(
      contract.connect(alice).vote(0, enc2.handles[0], enc2.handles[1], enc2.inputProof),
    ).to.be.revertedWithCustomError(contract, "AlreadyVoted");
  });

  it("should prevent non-members from voting", async function () {
    await contract.connect(admin).createProposal(
      "Test", alice.address, ethers.parseEther("1"), 1, 3600,
    );

    const nonMember = (await ethers.getSigners())[4];
    const enc = await fhevm
      .createEncryptedInput(contractAddress, nonMember.address)
      .add64(1000)
      .addBool(true)
      .encrypt();
    await expect(
      contract.connect(nonMember).vote(0, enc.handles[0], enc.handles[1], enc.inputProof),
    ).to.be.revertedWithCustomError(contract, "NotMember");
  });
});
```

## Frontend Snippet: Vote Submission

```tsx
async function submitVote(proposalId: number, weight: number, voteYes: boolean) {
  setStatus("Encrypting your vote...");
  const encrypted = await fhevm
    .createEncryptedInput(contractAddress, userAddress)
    .add64(weight)
    .addBool(voteYes)
    .encrypt();

  setStatus("Sending vote transaction...");
  const tx = await contract.vote(
    proposalId,
    encrypted.handles[0],
    encrypted.handles[1],
    encrypted.inputProof,
  );
  await tx.wait();
  setStatus("Vote cast! Your vote weight and direction are encrypted on-chain.");
}
```

## Patterns Demonstrated

1. **Encrypted accumulation** — Vote tallies accumulate via `FHE.add` without revealing individual votes
2. **Mixed encrypted/public state** — `voteCount` (public) for quorum, `encryptedYesVotes` (private) for tallies
3. **Public decryption 3-step** — `makePubliclyDecryptable` → off-chain `publicDecrypt` → `checkSignatures`
4. **Handle ordering** — `checkSignatures` handles must match `RevealRequested` event order
5. **State machine** — Active → RevealRequested → Finalized/Rejected
6. **Multi-input encryption** — `add64(weight)` + `addBool(voteYes)` in single proof
7. **Conditional routing** — `FHE.select(isYes, weight, zero)` routes vote weight without revealing direction
