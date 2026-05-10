# Testing FHEVM Contracts

## What to Test

FHEVM contracts have failure modes that don't exist in normal Solidity. Your test suite must cover:

1. **Encrypted state transitions** — After calling a function with encrypted inputs, decrypt the result and verify the expected plaintext value.
2. **Permission grants** — Verify that the correct addresses can decrypt (and that unauthorized addresses cannot).
3. **Conditional logic paths** — Test both branches of every `FHE.select`: the "sufficient funds" path AND the "insufficient funds" path.
4. **Uninitialized state** — Encrypted mappings return `ethers.ZeroHash` (null handle) when never written. Test this explicitly.
5. **Overflow behavior** — Arithmetic wraps silently. If your contract has overflow protection, test that it activates correctly.
6. **Error code paths** — If you use encrypted error codes, decrypt them and verify the correct error was recorded.

## Test Infrastructure

### Imports

```typescript
import {expect} from "chai";
import {ethers, fhevm} from "hardhat";
import {FhevmType} from "@fhevm/hardhat-plugin";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
```

### Signers and fixture

```typescript
type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = await ethers.getContractFactory("MyContract");
  const contract = await factory.deploy(/* args */);
  await contract.waitForDeployment();
  return {contract, address: await contract.getAddress()};
}
```

### Mock environment guard

Local tests use simulated FHE (fast, deterministic). The mock environment does not hit the real coprocessor or KMS — encryption and decryption are simulated. Always guard:

```typescript
beforeEach(async function () {
  if (!fhevm.isMock) {
    this.skip(); // Skip on real networks
  }
  ({contract, address: contractAddress} = await deployFixture());
});
```

For Sepolia tests, invert the guard and increase timeouts:
```typescript
beforeEach(async function () {
  if (fhevm.isMock) {
    this.skip(); // Only run on real network
  }
}).timeout(4 * 40_000); // Real coprocessor is slow
```

## Encryption Patterns

### Single value

```typescript
const encrypted = await fhevm
  .createEncryptedInput(contractAddress, signers.alice.address)
  .add64(1000)
  .encrypt();

await contract
  .connect(signers.alice)
  .deposit(encrypted.handles[0], encrypted.inputProof);
```

### Multiple values in one proof

```typescript
const multi = await fhevm
  .createEncryptedInput(contractAddress, signers.alice.address)
  .add64(salary)       // handles[0]
  .addBool(isActive)   // handles[1]
  .add8(department)    // handles[2]
  .encrypt();

await contract
  .connect(signers.alice)
  .setEmployee(
    multi.handles[0],   // externalEuint64
    multi.handles[1],   // externalEbool
    multi.handles[2],   // externalEuint8
    multi.inputProof,
  );
```

### Encryption method reference

| Type | Method | Example |
|------|--------|---------|
| `ebool` | `addBool(val)` | `.addBool(true)` |
| `euint8` | `add8(val)` | `.add8(255)` |
| `euint16` | `add16(val)` | `.add16(65535)` |
| `euint32` | `add32(val)` | `.add32(1000000)` |
| `euint64` | `add64(val)` | `.add64(1000000)` |
| `euint128` | `add128(val)` | `.add128(BigInt("340282366920938463463374607431768211455"))` |
| `euint256` | `add256(val)` | `.add256(val)` |
| `eaddress` | `addAddress(val)` | `.addAddress("0x1234...")` |

## Decryption Patterns

### Decrypt and assert

```typescript
const encBalance = await contract.getBalance(signers.alice.address);
const clearBalance = await fhevm.userDecryptEuint(
  FhevmType.euint64,
  encBalance,
  contractAddress,
  signers.alice,
);
expect(clearBalance).to.equal(1000n);
```

The signer passed to `userDecryptEuint` must have `FHE.allow` permission for that handle. If not, the mock environment may return incorrect results or throw.

### Handle uninitialized values

```typescript
const encBalance = await contract.getBalance(signers.bob.address);
// Bob never received tokens — handle is null
expect(encBalance).to.equal(ethers.ZeroHash);
// Do NOT attempt to decrypt ethers.ZeroHash — it is not an encrypted value
```

### Decrypt error codes

If your contract uses encrypted error logging:
```typescript
const [encError, timestamp] = await contract.getLastStatus(signers.alice.address);
if (encError !== ethers.ZeroHash) {
  const clearError = await fhevm.userDecryptEuint(
    FhevmType.euint8,
    encError,
    contractAddress,
    signers.alice,
  );
  expect(clearError).to.equal(1n); // INSUFFICIENT_FUNDS
}
```

## Testing Conditional Logic

Always test both paths of `FHE.select`:

```typescript
it("should transfer when balance is sufficient", async function () {
  // Mint 1000 to alice, then transfer 300 to bob
  // ... encrypt and call ...
  const aliceBalance = await decrypt(contract.getBalance(signers.alice.address));
  expect(aliceBalance).to.equal(700n);
});

it("should be a no-op when balance is insufficient", async function () {
  // Mint 100 to alice, then try to transfer 200 to bob
  // ... encrypt and call ...
  // Transaction succeeds (no revert!) but transfer is zero
  const aliceBalance = await decrypt(contract.getBalance(signers.alice.address));
  expect(aliceBalance).to.equal(100n); // unchanged
  const bobBalance = await contract.getBalance(signers.bob.address);
  expect(bobBalance).to.equal(ethers.ZeroHash); // never received anything
});
```

## Mock vs Real Network Differences

| Aspect | Local Mock | Sepolia Real |
|--------|-----------|-------------|
| Speed | Instant | 5-30s per FHE operation |
| FHE accuracy | Simulated (deterministic) | Real coprocessor |
| ACL enforcement | Partial | Full |
| Public decryption | Simulated | Real KMS interaction |
| Test timeout | Default (2s) | Need 4x increase |
| Wallet funding | Unlimited | Needs Sepolia ETH |

## Coverage Considerations

`solidity-coverage` works with FHEVM contracts but cannot measure which branch of `FHE.select` was taken — from the EVM's perspective, both branches always execute. To achieve meaningful coverage:

- Test each `FHE.select` with inputs that exercise both the true and false paths
- Verify outputs differ between the two paths (the selected value changes)
- Don't rely on coverage percentages alone — manually confirm each conditional path is tested

## CLI-Based Decryption (Hardhat Tasks)

For interactive testing and debugging, use `fhevm.initializeCLIApi()`:

```typescript
task("check-balance", "Decrypt a user's balance")
  .addParam("account", "Address to check")
  .setAction(async ({account}, hre) => {
    const {ethers, fhevm, deployments} = hre;
    await fhevm.initializeCLIApi(); // Required for CLI-based decryption

    const deployment = await deployments.get("MyContract");
    const [signer] = await ethers.getSigners();
    const contract = await ethers.getContractAt("MyContract", deployment.address, signer);

    const enc = await contract.getBalance(account);
    if (enc === ethers.ZeroHash) {
      console.log("Balance: 0 (uninitialized)");
      return;
    }

    const {FhevmType} = await import("@fhevm/hardhat-plugin");
    const clear = await fhevm.userDecryptEuint(
      FhevmType.euint64, enc, deployment.address, signer,
    );
    console.log("Balance:", clear.toString());
  });
```
