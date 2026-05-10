# Example: Sealed-Bid Marketplace

A marketplace where sellers list items and buyers submit encrypted bids. After the bidding deadline, the highest bid is determined using encrypted comparisons, and the winner is revealed via public decryption. Demonstrates: encrypted comparison chain, eaddress for encrypted winner tracking, time-locked state machine, public decryption with escrow settlement.

## Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool, eaddress} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title SealedBidMarketplace
/// @notice Sealed-bid auction with encrypted bids and public winner reveal.
contract SealedBidMarketplace is ZamaEthereumConfig {
    enum ListingState { Open, RevealRequested, Settled, Cancelled }

    struct Listing {
        address seller;
        string itemName;
        uint256 minPrice;       // Public minimum price in wei
        uint256 deadline;
        euint64 highestBid;
        eaddress highestBidder;
        uint256 bidCount;
        ListingState state;
        // Populated after public decryption
        uint64 finalPrice;
        address finalWinner;
    }

    uint256 public listingCount;
    mapping(uint256 => Listing) private _listings;
    mapping(uint256 => mapping(address => euint64)) private _bids;
    mapping(uint256 => mapping(address => bool)) public hasBid;

    event ListingCreated(uint256 indexed id, address indexed seller, string itemName, uint256 deadline);
    event BidPlaced(uint256 indexed listingId, address indexed bidder);
    event RevealRequested(uint256 indexed listingId, euint64 highestBid, eaddress highestBidder);
    event ListingSettled(uint256 indexed listingId, uint64 price, address winner);
    event ListingCancelled(uint256 indexed listingId);

    error NotSeller();
    error BiddingClosed();
    error BiddingStillOpen();
    error AlreadyBid();
    error InvalidState();

    /// @notice Create a new item listing with a bidding deadline.
    function createListing(
        string calldata itemName,
        uint256 minPrice,
        uint256 biddingDurationSeconds
    ) external returns (uint256) {
        uint256 id = listingCount++;
        Listing storage l = _listings[id];

        l.seller = msg.sender;
        l.itemName = itemName;
        l.minPrice = minPrice;
        l.deadline = block.timestamp + biddingDurationSeconds;
        l.state = ListingState.Open;

        // Initialize with zero bid and zero-address bidder
        l.highestBid = FHE.asEuint64(0);
        l.highestBidder = FHE.asEaddress(address(0));
        FHE.allowThis(l.highestBid);
        FHE.allowThis(l.highestBidder);

        emit ListingCreated(id, msg.sender, itemName, l.deadline);
        return id;
    }

    /// @notice Submit a sealed (encrypted) bid on a listing.
    /// @dev Each address can bid once. The highest bid is tracked via FHE.select.
    function placeBid(
        uint256 listingId,
        externalEuint64 encryptedBid,
        bytes calldata inputProof
    ) external {
        Listing storage l = _listings[listingId];
        if (l.state != ListingState.Open) revert BiddingClosed();
        if (block.timestamp >= l.deadline) revert BiddingClosed();
        if (hasBid[listingId][msg.sender]) revert AlreadyBid();

        euint64 bidAmount = FHE.fromExternal(encryptedBid, inputProof);

        // Store the individual bid so the bidder can view it later
        _bids[listingId][msg.sender] = bidAmount;
        FHE.allowThis(_bids[listingId][msg.sender]);
        FHE.allow(_bids[listingId][msg.sender], msg.sender);

        // Update highest bid tracker.
        // The coprocessor compares encrypted values — nobody learns whether
        // this bid is higher or lower until the public reveal.
        ebool isHigher = FHE.gt(bidAmount, l.highestBid);
        l.highestBid = FHE.select(isHigher, bidAmount, l.highestBid);
        l.highestBidder = FHE.select(
            isHigher,
            FHE.asEaddress(msg.sender),
            l.highestBidder
        );

        // Refresh permissions on updated handles
        FHE.allowThis(l.highestBid);
        FHE.allowThis(l.highestBidder);

        hasBid[listingId][msg.sender] = true;
        l.bidCount++;

        emit BidPlaced(listingId, msg.sender);
    }

    /// @notice Step 1: Request public reveal of the winner after bidding ends.
    function requestReveal(uint256 listingId) external {
        Listing storage l = _listings[listingId];
        if (l.state != ListingState.Open) revert InvalidState();
        if (block.timestamp < l.deadline) revert BiddingStillOpen();

        if (l.bidCount == 0) {
            l.state = ListingState.Cancelled;
            emit ListingCancelled(listingId);
            return;
        }

        l.state = ListingState.RevealRequested;
        FHE.makePubliclyDecryptable(l.highestBid);
        FHE.makePubliclyDecryptable(l.highestBidder);

        emit RevealRequested(listingId, l.highestBid, l.highestBidder);
    }

    /// @notice Step 3: Verify decryption proof and settle the listing.
    function settle(
        uint256 listingId,
        uint64 winningPrice,
        address winner,
        bytes calldata decryptionProof
    ) external {
        Listing storage l = _listings[listingId];
        if (l.state != ListingState.RevealRequested) revert InvalidState();

        // CRITICAL: Handle order must match requestReveal's makePubliclyDecryptable order
        bytes32[] memory handles = new bytes32[](2);
        handles[0] = FHE.toBytes32(l.highestBid);     // First: bid amount
        handles[1] = FHE.toBytes32(l.highestBidder);   // Second: bidder address

        bytes memory encoded = abi.encode(winningPrice, winner);
        FHE.checkSignatures(handles, encoded, decryptionProof);

        l.finalPrice = winningPrice;
        l.finalWinner = winner;
        l.state = ListingState.Settled;

        emit ListingSettled(listingId, winningPrice, winner);
    }

    // --- View functions ---

    function getMyBid(uint256 listingId) external view returns (euint64) {
        return _bids[listingId][msg.sender];
    }

    function getListing(uint256 listingId) external view returns (
        address seller,
        string memory itemName,
        uint256 minPrice,
        uint256 deadline,
        uint256 bidCount,
        ListingState state,
        uint64 finalPrice,
        address finalWinner
    ) {
        Listing storage l = _listings[listingId];
        return (
            l.seller, l.itemName, l.minPrice, l.deadline,
            l.bidCount, l.state, l.finalPrice, l.finalWinner
        );
    }
}
```

## Test

```typescript
import {expect} from "chai";
import {ethers, fhevm} from "hardhat";
import {FhevmType} from "@fhevm/hardhat-plugin";
import {time} from "@nomicfoundation/hardhat-network-helpers";

describe("SealedBidMarketplace", function () {
  let contract: any;
  let contractAddress: string;
  let seller: any, bidder1: any, bidder2: any, bidder3: any;

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    [seller, bidder1, bidder2, bidder3] = await ethers.getSigners();

    const factory = await ethers.getContractFactory("SealedBidMarketplace");
    contract = await factory.connect(seller).deploy();
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();
  });

  it("should track highest bid across multiple encrypted bids", async function () {
    // Create listing: 1 hour bidding window
    await contract.connect(seller).createListing("Rare NFT", 0, 3600);

    // Bidder 1 bids 500
    const enc1 = await fhevm
      .createEncryptedInput(contractAddress, bidder1.address)
      .add64(500)
      .encrypt();
    await contract.connect(bidder1).placeBid(0, enc1.handles[0], enc1.inputProof);

    // Bidder 2 bids 800 (highest)
    const enc2 = await fhevm
      .createEncryptedInput(contractAddress, bidder2.address)
      .add64(800)
      .encrypt();
    await contract.connect(bidder2).placeBid(0, enc2.handles[0], enc2.inputProof);

    // Bidder 3 bids 300
    const enc3 = await fhevm
      .createEncryptedInput(contractAddress, bidder3.address)
      .add64(300)
      .encrypt();
    await contract.connect(bidder3).placeBid(0, enc3.handles[0], enc3.inputProof);

    // Verify each bidder can decrypt their own bid
    const myBid1 = await contract.connect(bidder1).getMyBid(0);
    const clear1 = await fhevm.userDecryptEuint(
      FhevmType.euint64, myBid1, contractAddress, bidder1,
    );
    expect(clear1).to.equal(500n);

    // Verify bid count
    const listing = await contract.getListing(0);
    expect(listing.bidCount).to.equal(3n);
  });

  it("should prevent bidding after deadline", async function () {
    await contract.connect(seller).createListing("Item", 0, 60); // 60 second window

    // Advance time past deadline
    await time.increase(61);

    const enc = await fhevm
      .createEncryptedInput(contractAddress, bidder1.address)
      .add64(100)
      .encrypt();
    await expect(
      contract.connect(bidder1).placeBid(0, enc.handles[0], enc.inputProof),
    ).to.be.revertedWithCustomError(contract, "BiddingClosed");
  });

  it("should prevent double bidding", async function () {
    await contract.connect(seller).createListing("Item", 0, 3600);

    const enc = await fhevm
      .createEncryptedInput(contractAddress, bidder1.address)
      .add64(100)
      .encrypt();
    await contract.connect(bidder1).placeBid(0, enc.handles[0], enc.inputProof);

    const enc2 = await fhevm
      .createEncryptedInput(contractAddress, bidder1.address)
      .add64(200)
      .encrypt();
    await expect(
      contract.connect(bidder1).placeBid(0, enc2.handles[0], enc2.inputProof),
    ).to.be.revertedWithCustomError(contract, "AlreadyBid");
  });

  it("should cancel listing with zero bids", async function () {
    await contract.connect(seller).createListing("Item", 0, 60);
    await time.increase(61);

    await contract.requestReveal(0);
    const listing = await contract.getListing(0);
    expect(listing.state).to.equal(3); // Cancelled
  });

  it("should transition through state machine correctly", async function () {
    await contract.connect(seller).createListing("Item", 0, 60);

    const enc = await fhevm
      .createEncryptedInput(contractAddress, bidder1.address)
      .add64(100)
      .encrypt();
    await contract.connect(bidder1).placeBid(0, enc.handles[0], enc.inputProof);

    // Can't reveal while bidding is active
    await expect(contract.requestReveal(0))
      .to.be.revertedWithCustomError(contract, "BiddingStillOpen");

    // Advance past deadline
    await time.increase(61);

    // Now reveal works
    await contract.requestReveal(0);

    const listing = await contract.getListing(0);
    expect(listing.state).to.equal(1); // RevealRequested
  });
});
```

## Client-Side Public Decryption (Step 2)

After `requestReveal` emits the `RevealRequested` event, an off-chain service (or the frontend) decrypts the values:

```typescript
// Listen for the RevealRequested event
const filter = contract.filters.RevealRequested(listingId);
const events = await contract.queryFilter(filter);
const {highestBid: bidHandle, highestBidder: bidderHandle} = events[0].args;

// Step 2: Off-chain decryption via the relayer
const results = await instance.publicDecrypt([bidHandle, bidderHandle]);
const winningPrice = results.clearValues[bidHandle];
const winner = results.clearValues[bidderHandle];
const proof = results.decryptionProof;

// Step 3: Submit proof to settle on-chain
const tx = await contract.settle(listingId, winningPrice, winner, proof);
await tx.wait();
console.log(`Listing settled: ${winner} wins with bid of ${winningPrice}`);
```

## Patterns Demonstrated

1. **Encrypted comparison chain** — Each new bid is compared against `highestBid` via `FHE.gt`. The `FHE.select` updates both `highestBid` and `highestBidder` atomically, without revealing whether any individual bid was higher or lower.

2. **eaddress for encrypted identity** — `highestBidder` uses `eaddress` (160-bit encrypted address) so the winner's identity is hidden until the reveal. Only `eq`, `ne`, and `select` are supported on `eaddress` — no arithmetic.

3. **Time-locked state machine** — Open → (deadline passes) → RevealRequested → Settled/Cancelled. Plaintext `block.timestamp` controls transitions; encrypted data controls outcomes.

4. **Individual bid privacy** — Each bidder's bid is stored separately with `FHE.allow` only for that bidder. They can verify their own bid but not see others'.

5. **Public decryption with proof verification** — The 3-step async flow with strict handle ordering in `checkSignatures`.

6. **Zero-bid cancellation** — If no bids are placed, the listing is cancelled immediately in `requestReveal` without going through the decryption flow.
