import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // Deploy MockERC20 tokens for testing
  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  
  // Deploy ETH token
  const ethToken = await MockERC20Factory.deploy(
    "Ethereum",
    "ETH",
    18,
    ethers.utils.parseEther("1000000") // 1M tokens
  );
  await ethToken.deployed();
  console.log("ETH Token deployed to:", ethToken.address);

  // Deploy USDC token
  const usdcToken = await MockERC20Factory.deploy(
    "USD Coin",
    "USDC",
    6, // USDC has 6 decimals
    ethers.utils.parseUnits("1000000", 6) // 1M USDC
  );
  await usdcToken.deployed();
  console.log("USDC Token deployed to:", usdcToken.address);

  // Deploy BTC token
  const btcToken = await MockERC20Factory.deploy(
    "Bitcoin",
    "BTC",
    8, // BTC has 8 decimals
    ethers.utils.parseUnits("21000", 8) // 21K BTC
  );
  await btcToken.deployed();
  console.log("BTC Token deployed to:", btcToken.address);

  // Deploy HybridCLOB
  const HybridCLOBFactory = await ethers.getContractFactory("HybridCLOB");
  const hybridCLOB = await HybridCLOBFactory.deploy(deployer.address); // Fee recipient is deployer
  await hybridCLOB.deployed();
  console.log("HybridCLOB deployed to:", hybridCLOB.address);

  // Add trading pairs
  console.log("\nAdding trading pairs...");
  
  // ETH/USDC
  await hybridCLOB.addTradingPair(ethToken.address, usdcToken.address);
  console.log("Added ETH/USDC trading pair");

  // BTC/USDC
  await hybridCLOB.addTradingPair(btcToken.address, usdcToken.address);
  console.log("Added BTC/USDC trading pair");

  // BTC/ETH
  await hybridCLOB.addTradingPair(btcToken.address, ethToken.address);
  console.log("Added BTC/ETH trading pair");

  // Set initial fees (0.1% maker, 0.2% taker)
  await hybridCLOB.setFees(10, 20); // 0.1% = 10 basis points, 0.2% = 20 basis points
  console.log("Set fees: 0.1% maker, 0.2% taker");

  // Setup settler role for backend matching engine
  const SETTLER_ROLE = await hybridCLOB.SETTLER_ROLE();
  // In production, this would be the backend matching engine's address
  // For now, we'll grant it to the deployer
  await hybridCLOB.grantRole(SETTLER_ROLE, deployer.address);
  console.log("Granted settler role to deployer");

  console.log("\n=== Deployment Summary ===");
  console.log("ETH Token:", ethToken.address);
  console.log("USDC Token:", usdcToken.address);
  console.log("BTC Token:", btcToken.address);
  console.log("HybridCLOB:", hybridCLOB.address);
  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("Chain ID:", (await ethers.provider.getNetwork()).chainId);

  // Save addresses to file for frontend/backend integration
  const addresses = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: (await ethers.provider.getNetwork()).chainId,
    contracts: {
      HybridCLOB: hybridCLOB.address,
      tokens: {
        ETH: ethToken.address,
        USDC: usdcToken.address,
        BTC: btcToken.address
      }
    },
    deployer: deployer.address,
    deployedAt: new Date().toISOString()
  };

  console.log("\n=== Contract Addresses (JSON) ===");
  console.log(JSON.stringify(addresses, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
