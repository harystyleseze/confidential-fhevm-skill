// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// Foundry-track test template. Uses forge-fhevm's `FhevmTest` base class which
// auto-deploys the FHEVM host stack (ACL, Executor, Decryption, InputVerifier)
// in `setUp()`. Helpers like `encryptUint64(...)` and `decrypt(...)` work in
// cleartext mode — no relayer or KMS needed for unit tests.
//
// Key forge-fhevm helpers (see dependencies/forge-fhevm-*/src/FhevmTest.sol):
//   encryptBool(bool, user, contract)      -> (externalEbool,    bytes proof)
//   encryptUint8/16/32/64/128/256(...)     -> (externalEuintNN,  bytes proof)
//   encryptAddress(addr, user, contract)   -> (externalEaddress, bytes proof)
//   decrypt(eboolOrEuintN)                  -> the cleartext       (test-only!)
//   signUserDecrypt(USER_PK, contract)      -> bytes signature
//   userDecrypt(handle, user, contract, sig)-> uint256 cleartext   (mocks EIP-712)
//   buildDecryptionProof(handles, abiEncoded) -> bytes proof acceptable to FHE.checkSignatures
//
// **Each ciphertext gets its own proof in cleartext mode**, so encrypt each
// input separately and pass two `bytes` parameters to your contract function.

import {FhevmTest} from "forge-fhevm/FhevmTest.sol";
import {MyContract} from "../src/MyContract.sol";
import {euint64, externalEuint64} from "encrypted-types/EncryptedTypes.sol";

contract MyContractTest is FhevmTest {
    MyContract instance;
    address instanceAddress;

    uint256 internal constant ALICE_PK = 0xA11CE;
    address alice;

    function setUp() public override {
        super.setUp();              // brings up the FHEVM cleartext host stack
        instance = new MyContract();
        instanceAddress = address(instance);
        alice = vm.addr(ALICE_PK);
    }

    function test_uninitialisedHandleIsZero() public view {
        assertEq(euint64.unwrap(instance.getValue(alice)), bytes32(0));
    }

    function test_setValueAccumulates() public {
        (externalEuint64 encVal, bytes memory proof) = encryptUint64(42, alice, instanceAddress);
        vm.prank(alice);
        instance.setValue(encVal, proof);

        // decrypt(...) is cleartext-mode only — there is no relayer in tests.
        assertEq(decrypt(instance.getValue(alice)), 42);

        (externalEuint64 encVal2, bytes memory proof2) = encryptUint64(8, alice, instanceAddress);
        vm.prank(alice);
        instance.setValue(encVal2, proof2);
        assertEq(decrypt(instance.getValue(alice)), 50);
    }

    /// Testing the user-decrypt EIP-712 path in cleartext mode.
    /// signUserDecrypt builds a signed message that the contract's userDecrypt
    /// helper validates — equivalent to the SDK's `useUserDecrypt` flow.
    function test_userDecryptFromHandle() public {
        (externalEuint64 encVal, bytes memory proof) = encryptUint64(99, alice, instanceAddress);
        vm.prank(alice);
        instance.setValue(encVal, proof);

        bytes32 handle = euint64.unwrap(instance.getValue(alice));
        bytes memory sig = signUserDecrypt(ALICE_PK, instanceAddress);
        assertEq(userDecrypt(handle, alice, instanceAddress, sig), 99);
    }
}
