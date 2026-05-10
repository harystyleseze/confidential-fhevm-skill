# Example: Confidential Payroll

A payroll contract where employee salaries are encrypted on-chain. Only each employee can see their own salary. The employer can set and update salaries, and distribute payments in batch. Demonstrates: encrypted mappings, multi-party permissions, scalar operations, overflow protection, encrypted error codes.

## Contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, euint8, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title ConfidentialPayroll
/// @notice Manages encrypted employee salaries with per-employee decrypt access.
contract ConfidentialPayroll is ZamaEthereumConfig {
    address public employer;
    euint64 private _treasury;
    uint256 public employeeCount;

    mapping(address => euint64) private _salaries;
    mapping(address => bool) public isEmployee;

    // Encrypted error codes
    euint8 private OK;
    euint8 private ERR_INSUFFICIENT_TREASURY;

    struct PaymentStatus {
        euint8 code;
        uint256 timestamp;
    }
    mapping(address => PaymentStatus) private _paymentStatus;

    event EmployeeAdded(address indexed employee);
    event SalaryUpdated(address indexed employee);
    event PaymentProcessed(address indexed employee);
    event TreasuryFunded(uint64 amount);

    error OnlyEmployer();
    error AlreadyEmployee();
    error NotEmployee();

    modifier onlyEmployer() {
        if (msg.sender != employer) revert OnlyEmployer();
        _;
    }

    constructor() {
        employer = msg.sender;
        _treasury = FHE.asEuint64(0);
        FHE.allowThis(_treasury);

        OK = FHE.asEuint8(0);
        ERR_INSUFFICIENT_TREASURY = FHE.asEuint8(1);
        FHE.allowThis(OK);
        FHE.allowThis(ERR_INSUFFICIENT_TREASURY);
    }

    /// @notice Fund the treasury with a public amount.
    /// @dev The treasury amount becomes encrypted once funded.
    function fundTreasury(uint64 amount) external onlyEmployer {
        euint64 deposit = FHE.asEuint64(amount);
        euint64 newTreasury = FHE.add(_treasury, deposit);

        // Overflow protection: if newTreasury < _treasury, overflow occurred
        ebool overflowed = FHE.lt(newTreasury, _treasury);
        _treasury = FHE.select(overflowed, _treasury, newTreasury);

        FHE.allowThis(_treasury);
        FHE.allow(_treasury, employer);
        emit TreasuryFunded(amount);
    }

    /// @notice Add an employee and set their encrypted salary.
    function addEmployee(
        address employee,
        externalEuint64 encryptedSalary,
        bytes calldata inputProof
    ) external onlyEmployer {
        if (isEmployee[employee]) revert AlreadyEmployee();

        euint64 salary = FHE.fromExternal(encryptedSalary, inputProof);
        _salaries[employee] = salary;
        isEmployee[employee] = true;
        employeeCount++;

        // Employer can see all salaries; each employee can see their own.
        FHE.allowThis(_salaries[employee]);
        FHE.allow(_salaries[employee], employee);
        FHE.allow(_salaries[employee], employer);

        emit EmployeeAdded(employee);
    }

    /// @notice Update an employee's salary.
    function updateSalary(
        address employee,
        externalEuint64 encryptedNewSalary,
        bytes calldata inputProof
    ) external onlyEmployer {
        if (!isEmployee[employee]) revert NotEmployee();

        euint64 newSalary = FHE.fromExternal(encryptedNewSalary, inputProof);
        _salaries[employee] = newSalary;

        FHE.allowThis(_salaries[employee]);
        FHE.allow(_salaries[employee], employee);
        FHE.allow(_salaries[employee], employer);

        emit SalaryUpdated(employee);
    }

    /// @notice Pay a single employee from the treasury.
    /// @dev If treasury is insufficient, the payment is a no-op and an error code is recorded.
    function payEmployee(address employee) external onlyEmployer {
        if (!isEmployee[employee]) revert NotEmployee();

        euint64 salary = _salaries[employee];
        ebool canPay = FHE.le(salary, _treasury);

        // Conditional payment: pay salary if treasury has enough, else zero
        euint64 payment = FHE.select(canPay, salary, FHE.asEuint64(0));
        _treasury = FHE.sub(_treasury, payment);

        // Record payment status (encrypted error code)
        euint8 statusCode = FHE.select(canPay, OK, ERR_INSUFFICIENT_TREASURY);
        _paymentStatus[employee] = PaymentStatus(statusCode, block.timestamp);

        FHE.allowThis(_treasury);
        FHE.allow(_treasury, employer);
        FHE.allowThis(statusCode);
        FHE.allow(statusCode, employee);
        FHE.allow(statusCode, employer);

        emit PaymentProcessed(employee);
    }

    /// @notice Pay multiple employees in a single transaction.
    function batchPay(address[] calldata employees) external onlyEmployer {
        for (uint256 i = 0; i < employees.length; i++) {
            if (!isEmployee[employees[i]]) continue;

            euint64 salary = _salaries[employees[i]];
            ebool canPay = FHE.le(salary, _treasury);
            euint64 payment = FHE.select(canPay, salary, FHE.asEuint64(0));
            _treasury = FHE.sub(_treasury, payment);

            euint8 statusCode = FHE.select(canPay, OK, ERR_INSUFFICIENT_TREASURY);
            _paymentStatus[employees[i]] = PaymentStatus(statusCode, block.timestamp);

            FHE.allowThis(_treasury);
            FHE.allowThis(statusCode);
            FHE.allow(statusCode, employees[i]);
            FHE.allow(statusCode, employer);

            emit PaymentProcessed(employees[i]);
        }
        FHE.allow(_treasury, employer);
    }

    // --- View functions ---

    function getSalary(address employee) external view returns (euint64) {
        return _salaries[employee];
    }

    function getTreasury() external view returns (euint64) {
        return _treasury;
    }

    function getPaymentStatus(address employee) external view returns (euint8, uint256) {
        PaymentStatus memory s = _paymentStatus[employee];
        return (s.code, s.timestamp);
    }
}
```

## Test

```typescript
import {expect} from "chai";
import {ethers, fhevm} from "hardhat";
import {FhevmType} from "@fhevm/hardhat-plugin";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";

describe("ConfidentialPayroll", function () {
  let contract: any;
  let contractAddress: string;
  let employer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    const signers = await ethers.getSigners();
    [employer, alice, bob, carol] = signers;

    const factory = await ethers.getContractFactory("ConfidentialPayroll");
    contract = await factory.connect(employer).deploy();
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();
  });

  it("should set encrypted salaries and allow employees to decrypt only their own", async function () {
    // Fund treasury with 100,000
    await contract.connect(employer).fundTreasury(100000);

    // Add alice with salary 50,000
    const encAliceSalary = await fhevm
      .createEncryptedInput(contractAddress, employer.address)
      .add64(50000)
      .encrypt();
    await contract.connect(employer).addEmployee(
      alice.address, encAliceSalary.handles[0], encAliceSalary.inputProof,
    );

    // Add bob with salary 30,000
    const encBobSalary = await fhevm
      .createEncryptedInput(contractAddress, employer.address)
      .add64(30000)
      .encrypt();
    await contract.connect(employer).addEmployee(
      bob.address, encBobSalary.handles[0], encBobSalary.inputProof,
    );

    // Alice decrypts her own salary
    const aliceEncSalary = await contract.getSalary(alice.address);
    const aliceClearSalary = await fhevm.userDecryptEuint(
      FhevmType.euint64, aliceEncSalary, contractAddress, alice,
    );
    expect(aliceClearSalary).to.equal(50000n);

    // Bob decrypts his own salary
    const bobEncSalary = await contract.getSalary(bob.address);
    const bobClearSalary = await fhevm.userDecryptEuint(
      FhevmType.euint64, bobEncSalary, contractAddress, bob,
    );
    expect(bobClearSalary).to.equal(30000n);

    // Employer decrypts treasury
    const encTreasury = await contract.getTreasury();
    const clearTreasury = await fhevm.userDecryptEuint(
      FhevmType.euint64, encTreasury, contractAddress, employer,
    );
    expect(clearTreasury).to.equal(100000n);
  });

  it("should pay employees and deduct from treasury", async function () {
    await contract.connect(employer).fundTreasury(100000);

    const encSalary = await fhevm
      .createEncryptedInput(contractAddress, employer.address)
      .add64(25000)
      .encrypt();
    await contract.connect(employer).addEmployee(
      alice.address, encSalary.handles[0], encSalary.inputProof,
    );

    // Pay alice
    await contract.connect(employer).payEmployee(alice.address);

    // Treasury should be 75,000
    const encTreasury = await contract.getTreasury();
    const clearTreasury = await fhevm.userDecryptEuint(
      FhevmType.euint64, encTreasury, contractAddress, employer,
    );
    expect(clearTreasury).to.equal(75000n);

    // Payment status should be OK (0)
    const [encStatus] = await contract.getPaymentStatus(alice.address);
    const clearStatus = await fhevm.userDecryptEuint(
      FhevmType.euint8, encStatus, contractAddress, alice,
    );
    expect(clearStatus).to.equal(0n); // OK
  });

  it("should record error when treasury insufficient", async function () {
    await contract.connect(employer).fundTreasury(10);

    const encSalary = await fhevm
      .createEncryptedInput(contractAddress, employer.address)
      .add64(50000)
      .encrypt();
    await contract.connect(employer).addEmployee(
      alice.address, encSalary.handles[0], encSalary.inputProof,
    );

    // Pay fails silently — no revert, but error code is set
    await contract.connect(employer).payEmployee(alice.address);

    // Treasury unchanged (payment was zero)
    const encTreasury = await contract.getTreasury();
    const clearTreasury = await fhevm.userDecryptEuint(
      FhevmType.euint64, encTreasury, contractAddress, employer,
    );
    expect(clearTreasury).to.equal(10n);

    // Error code = 1 (INSUFFICIENT_TREASURY)
    const [encStatus] = await contract.getPaymentStatus(alice.address);
    const clearStatus = await fhevm.userDecryptEuint(
      FhevmType.euint8, encStatus, contractAddress, alice,
    );
    expect(clearStatus).to.equal(1n);
  });

  it("should prevent non-employer from adding employees", async function () {
    const enc = await fhevm
      .createEncryptedInput(contractAddress, alice.address)
      .add64(1000)
      .encrypt();
    await expect(
      contract.connect(alice).addEmployee(bob.address, enc.handles[0], enc.inputProof),
    ).to.be.revertedWithCustomError(contract, "OnlyEmployer");
  });
});
```

## Deploy Script

```typescript
import {DeployFunction} from "hardhat-deploy/types";
import {HardhatRuntimeEnvironment} from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployer} = await hre.getNamedAccounts();
  const {deploy} = hre.deployments;

  const result = await deploy("ConfidentialPayroll", {
    from: deployer,
    log: true,
  });
  console.log("ConfidentialPayroll deployed to:", result.address);
};

func.id = "deploy_confidential_payroll";
func.tags = ["ConfidentialPayroll"];
export default func;
```

## Patterns Demonstrated

1. **Encrypted mappings** — `mapping(address => euint64) private _salaries`
2. **Multi-party permissions** — Employer and employee both get `FHE.allow` on salary
3. **Scalar operations** — `FHE.asEuint64(amount)` for public-to-encrypted conversion
4. **Overflow protection** — Treasury funding checks for wraparound
5. **Encrypted error codes** — `FHE.select(canPay, OK, ERR_INSUFFICIENT_TREASURY)` instead of revert
6. **Batch processing** — `batchPay` loops through employees with per-iteration ACL grants
7. **Conditional execution** — `FHE.select` makes payment a no-op when treasury is insufficient
