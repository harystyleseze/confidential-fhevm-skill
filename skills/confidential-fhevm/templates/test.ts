import {expect} from "chai";
import {ethers, fhevm} from "hardhat";
import {FhevmType} from "@fhevm/hardhat-plugin";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import {MyContract} from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

// Fresh contract per test — encrypted state must not leak between cases.
async function deployFixture() {
  const factory = await ethers.getContractFactory("MyContract");
  const contract = (await factory.deploy()) as MyContract;
  await contract.waitForDeployment();
  return {contract, address: await contract.getAddress()};
}

describe("MyContract", function () {
  let signers: Signers;
  let contract: MyContract;
  let contractAddress: string;

  before(async function () {
    const s = await ethers.getSigners();
    signers = {deployer: s[0], alice: s[1], bob: s[2]};
  });

  beforeEach(async function () {
    // mock-only suite — skip on Sepolia/mainnet
    if (!fhevm.isMock) {
      console.warn("Skipping: this test requires mock FHE environment");
      this.skip();
    }
    ({contract, address: contractAddress} = await deployFixture());
  });

  it("returns ZeroHash for uninitialised values", async function () {
    const enc = await contract.getValue(signers.alice.address);
    expect(enc).to.equal(ethers.ZeroHash);
  });

  it("accepts encrypted input and updates state", async function () {
    const clearValue = 42n;

    // 1. encrypt — bound to (contractAddress, signerAddress)
    const encrypted = await fhevm
      .createEncryptedInput(contractAddress, signers.alice.address)
      .add64(clearValue)
      .encrypt();

    // 2. submit
    const tx = await contract
      .connect(signers.alice)
      .setValue(encrypted.handles[0], encrypted.inputProof);
    await tx.wait();

    // 3. read handle
    const encResult = await contract.getValue(signers.alice.address);
    expect(encResult).to.not.equal(ethers.ZeroHash);

    // 4. decrypt — alice must have FHE.allow permission
    const clearResult = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encResult,
      contractAddress,
      signers.alice,
    );
    expect(clearResult).to.equal(clearValue);
  });

  it("handles the true branch of FHE.select", async function () {
    // arrange state so the condition is true; assert expected outcome
  });

  it("handles the false branch of FHE.select (no-op, no revert)", async function () {
    // FHE.select doesn't revert on the false branch — state is unchanged
  });

  it("only the allowed signer can decrypt", async function () {
    // alice writes; alice decrypts (works); bob decrypts (rejected by KMS)
  });

  it("accumulates values across calls", async function () {
    // call setValue twice; decrypt; assert sum
  });
});
