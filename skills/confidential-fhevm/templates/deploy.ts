import {DeployFunction} from "hardhat-deploy/types";
import {HardhatRuntimeEnvironment} from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  // namedAccounts.deployer maps to index 0 in hardhat.config.ts
  const {deployer} = await hre.getNamedAccounts();
  const {deploy}   = hre.deployments;

  const result = await deploy("MyContract", {
    from: deployer,
    args: [
      // Constructor arguments go here.
      // Example: "MyToken", "MTK", 6
    ],
    log: true,
  });

  console.log("MyContract deployed to:", result.address);

  // UUPS proxy variant:
  // const result = await deploy("MyContract", {
  //   from: deployer,
  //   proxy: {
  //     proxyContract: "ERC1967Proxy",
  //     execute: { init: { methodName: "initialize", args: [/* … */] } },
  //   },
  //   log: true,
  // });
};

// Prevent re-execution on subsequent `hardhat deploy` runs.
// Change this ID to force a re-deployment.
func.id = "deploy_my_contract";

// Enable selective deploy: `npx hardhat deploy --tags MyContract`.
func.tags = ["MyContract"];

// Optional dependencies:
// func.dependencies = ["OtherContract"];

export default func;
