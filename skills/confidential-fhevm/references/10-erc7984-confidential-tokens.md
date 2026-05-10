# ERC-7984: Confidential Token Standard

## What ERC-7984 Changes from ERC-20

ERC-7984 replaces public balances and transfer amounts with encrypted equivalents. This is not just "ERC-20 with encryption bolted on" — several design decisions are fundamentally different.

**Balances are `euint64`, not `uint256`.** The `euint64` cap of ~1.8e19 limits the maximum token supply. With 6 decimals, this allows ~18.4 trillion tokens — sufficient for any practical token but a hard ceiling.

**Maximum 6 decimals.** This is a consequence of the `euint64` constraint. An 18-decimal token with `euint64` balances would max out at ~18.4 tokens — useless. Six decimals is the pragmatic sweet spot.

**Operators replace approve/allowance.** ERC-20's `approve(spender, amount)` doesn't work because the amount would need to be encrypted and compared on every transfer — expensive and complex. Instead, ERC-7984 uses a time-bounded operator model: `setOperator(operator, validUntilTimestamp)`. An operator can transfer any amount from the holder's balance until the timestamp expires.

**Transfers are encrypted.** `confidentialTransfer(to, encryptedAmount, inputProof)` sends an encrypted amount. Neither the blockchain nor observers learn how much was transferred.

**Wrapping ERC-20 tokens.** The `ERC7984ERC20Wrapper` contract converts standard ERC-20 tokens into confidential ERC-7984 tokens. This is a one-way shield (wrap) and a two-phase unshield (unwrap + finalize).

## Building a Confidential Token

### Storage layout

```solidity
mapping(address => euint64) private _balances;
mapping(address => mapping(address => uint48)) private _operators; // operator => validUntil
euint64 private _totalSupply;
string private _name;
string private _symbol;
```

### Constructor

```solidity
constructor(string memory name_, string memory symbol_) ZamaEthereumConfig {
    _name = name_;
    _symbol = symbol_;
}

function decimals() public pure returns (uint8) {
    return 6; // MUST be 6 or fewer
}
```

### Minting

```solidity
function mint(address to, uint64 amount) external onlyOwner {
    euint64 encAmount = FHE.asEuint64(amount);
    _balances[to] = FHE.add(_balances[to], encAmount);

    // Overflow check: totalSupply is public, so we can use normal Solidity
    _totalSupply = FHE.add(_totalSupply, encAmount);

    FHE.allowThis(_balances[to]);
    FHE.allow(_balances[to], to);
    FHE.allowThis(_totalSupply);
}
```

### Confidential Transfer

The transfer function must handle insufficient balance without reverting — that would reveal balance information. Instead, use `FHE.select` to make the transfer a no-op when funds are insufficient.

```solidity
function confidentialTransfer(
    address to,
    externalEuint64 encryptedAmount,
    bytes calldata inputProof
) external returns (euint64) {
    require(to != address(0), "Zero address");
    euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
    return _executeTransfer(msg.sender, to, amount);
}

function _executeTransfer(
    address from,
    address to,
    euint64 amount
) internal returns (euint64 transferred) {
    ebool sufficient = FHE.le(amount, _balances[from]);
    // If insufficient: transferred = 0, balances unchanged
    transferred = FHE.select(sufficient, amount, FHE.asEuint64(0));

    _balances[from] = FHE.sub(_balances[from], transferred);
    _balances[to] = FHE.add(_balances[to], transferred);

    FHE.allowThis(_balances[from]);
    FHE.allow(_balances[from], from);
    FHE.allowThis(_balances[to]);
    FHE.allow(_balances[to], to);

    emit ConfidentialTransfer(from, to, transferred);
    return transferred;
}
```

### Operator Model

```solidity
function setOperator(address operator, uint48 validUntil) external {
    _operators[msg.sender][operator] = validUntil;
    emit OperatorSet(msg.sender, operator, validUntil);
}

function isOperator(address holder, address operator) public view returns (bool) {
    return _operators[holder][operator] >= block.timestamp;
}

function confidentialTransferFrom(
    address from,
    address to,
    externalEuint64 encryptedAmount,
    bytes calldata inputProof
) external returns (euint64) {
    require(isOperator(from, msg.sender), "Not authorized operator");
    euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
    return _executeTransfer(from, to, amount);
}
```

### Reading Balance

```solidity
function confidentialBalanceOf(address account) external view returns (euint64) {
    return _balances[account]; // Returns a handle, not a readable number
}
```

The returned `euint64` is a bytes32 handle. The account holder decrypts it off-chain via the SDK.

## Wrapping ERC-20 to ERC-7984

### Decimal conversion

When wrapping an 18-decimal ERC-20 into a 6-decimal ERC-7984:
- **Conversion rate** = 10^(18-6) = 10^12
- Wrapping 1.5 USDC (= 1,500,000,000,000,000,000 base units) produces 1,500,000 confidential units
- Amounts below the conversion rate (e.g., 500,000 base units of an 18-decimal token) cannot be represented — they are refunded to the sender

### Wrap (shield) — single step

```solidity
function wrap(address to, uint256 amount) external returns (euint64) {
    // Transfer ERC-20 from sender to wrapper
    IERC20(underlying).transferFrom(msg.sender, address(this), amount);

    // Convert to 6-decimal representation
    uint256 confidentialAmount = amount / rate;
    uint256 remainder = amount % rate;

    // Refund remainder that can't be represented
    if (remainder > 0) {
        IERC20(underlying).transfer(msg.sender, remainder);
    }

    // Mint encrypted tokens
    euint64 encAmount = FHE.asEuint64(uint64(confidentialAmount));
    _balances[to] = FHE.add(_balances[to], encAmount);
    FHE.allowThis(_balances[to]);
    FHE.allow(_balances[to], to);

    return encAmount;
}
```

### Unwrap (unshield) — two-phase async

Phase 1: The user requests unwrapping. The contract burns encrypted tokens and records a pending request.
```solidity
function unwrap(
    address to,
    euint64 amount
) external returns (bytes32 requestId) {
    // Burn from sender's encrypted balance
    _balances[msg.sender] = FHE.sub(_balances[msg.sender], amount);
    FHE.allowThis(_balances[msg.sender]);
    FHE.allow(_balances[msg.sender], msg.sender);

    // Record pending unwrap
    requestId = keccak256(abi.encodePacked(msg.sender, to, block.number));
    _pendingUnwraps[requestId] = PendingUnwrap(to, amount);

    // Mark amount for public decryption
    FHE.makePubliclyDecryptable(amount);
    emit UnwrapRequested(to, requestId, amount);
}
```

Phase 2: After off-chain decryption, anyone can finalize by providing the cleartext + proof.
```solidity
function finalizeUnwrap(
    bytes32 requestId,
    uint64 clearAmount,
    bytes calldata decryptionProof
) external {
    PendingUnwrap memory pending = _pendingUnwraps[requestId];
    require(pending.to != address(0), "Invalid request");

    bytes32[] memory handles = new bytes32[](1);
    handles[0] = FHE.toBytes32(pending.amount);
    FHE.checkSignatures(handles, abi.encode(clearAmount), decryptionProof);

    delete _pendingUnwraps[requestId];

    // Release ERC-20 tokens
    uint256 erc20Amount = uint256(clearAmount) * rate;
    IERC20(underlying).transfer(pending.to, erc20Amount);

    emit UnwrapFinalized(pending.to, requestId, pending.amount, clearAmount);
}
```

## Key Constraints

- **Only standard ERC-20 tokens** can be wrapped. Fee-on-transfer, rebasing, and deflationary tokens break the accounting because `transferFrom(amount)` doesn't move exactly `amount`.
- **Wrapping is irreversible from a privacy perspective** — once ERC-20 tokens are shielded, all subsequent transfers are encrypted. The wrap transaction itself (public ERC-20 transfer to wrapper) is visible, but encrypted transfers afterward are private.
- **Staking shares don't earn rewards when wrapped** — the wrapper contract becomes the custodian, not the individual user.
