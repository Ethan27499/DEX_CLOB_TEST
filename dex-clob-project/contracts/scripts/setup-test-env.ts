import { ethers } from "hardhat";
import { HybridCLOB, MockERC20 } from "../typechain-types";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Setting up test environment with:", deployer.address);

  // Contract addresses (replace with actual deployed addresses)
  const HYBRID_CLOB_ADDRESS = process.env.HYBRID_CLOB_ADDRESS || "";
  const ETH_TOKEN_ADDRESS = process.env.ETH_TOKEN_ADDRESS || "";
  const USDC_TOKEN_ADDRESS = process.env.USDC_TOKEN_ADDRESS || "";

  if (!HYBRID_CLOB_ADDRESS || !ETH_TOKEN_ADDRESS || !USDC_TOKEN_ADDRESS) {
    console.error("Please set contract addresses in environment variables");
    return;
  }

  // Get contract instances
  const hybridCLOB = await ethers.getContractAt("HybridCLOB", HYBRID_CLOB_ADDRESS) as HybridCLOB;
  const ethToken = await ethers.getContractAt("MockERC20", ETH_TOKEN_ADDRESS) as MockERC20;
  const usdcToken = await ethers.getContractAt("MockERC20", USDC_TOKEN_ADDRESS) as MockERC20;

  console.log("Connected to contracts");

  // Create test accounts
  const [, trader1, trader2, trader3] = await ethers.getSigners();

  // Distribute tokens
  console.log("\nDistributing tokens to test accounts...");
  
  // Give ETH tokens
  await ethToken.transfer(trader1.address, ethers.utils.parseEther("100"));
  await ethToken.transfer(trader2.address, ethers.utils.parseEther("100"));
  await ethToken.transfer(trader3.address, ethers.utils.parseEther("100"));

  // Give USDC tokens
  const usdcAmount = ethers.utils.parseUnits("50000", 6); // 50K USDC
  await usdcToken.transfer(trader1.address, usdcAmount);
  await usdcToken.transfer(trader2.address, usdcAmount);
  await usdcToken.transfer(trader3.address, usdcAmount);

  console.log("Tokens distributed");

  // Approve tokens for trading
  console.log("\nApproving tokens for trading...");
  
  for (const trader of [trader1, trader2, trader3]) {
    await ethToken.connect(trader).approve(hybridCLOB.address, ethers.constants.MaxUint256);
    await usdcToken.connect(trader).approve(hybridCLOB.address, ethers.constants.MaxUint256);
  }

  console.log("Tokens approved");

  // Place some test orders
  console.log("\nPlacing test orders...");

  // ETH price: $2000
  const ethPrice = ethers.utils.parseUnits("2000", 6); // 2000 USDC per ETH

  // Trader1: Buy 1 ETH at $1950 (bid)
  await hybridCLOB.connect(trader1).placeOrder(
    ethToken.address,
    usdcToken.address,
    ethers.utils.parseEther("1"), // 1 ETH
    ethers.utils.parseUnits("1950", 6), // 1950 USDC per ETH
    0, // Buy
    0  // No expiry
  );

  // Trader2: Sell 0.5 ETH at $2050 (ask)
  await hybridCLOB.connect(trader2).placeOrder(
    ethToken.address,
    usdcToken.address,
    ethers.utils.parseEther("0.5"), // 0.5 ETH
    ethers.utils.parseUnits("2050", 6), // 2050 USDC per ETH
    1, // Sell
    0  // No expiry
  );

  // Trader3: Buy 2 ETH at $1980 (bid)
  await hybridCLOB.connect(trader3).placeOrder(
    ethToken.address,
    usdcToken.address,
    ethers.utils.parseEther("2"), // 2 ETH
    ethers.utils.parseUnits("1980", 6), // 1980 USDC per ETH
    0, // Buy
    0  // No expiry
  );

  // Trader1: Sell 1.5 ETH at $2000 (ask)
  await hybridCLOB.connect(trader1).placeOrder(
    ethToken.address,
    usdcToken.address,
    ethers.utils.parseEther("1.5"), // 1.5 ETH
    ethPrice, // 2000 USDC per ETH
    1, // Sell
    0  // No expiry
  );

  console.log("Test orders placed");

  // Display order information
  console.log("\n=== Order Summary ===");
  for (let i = 1; i <= 4; i++) {
    const order = await hybridCLOB.getOrder(i);
    const side = order.side === 0 ? "BUY" : "SELL";
    const amount = ethers.utils.formatEther(order.amount);
    const price = ethers.utils.formatUnits(order.price, 6);
    console.log(`Order ${i}: ${side} ${amount} ETH at $${price}`);
  }

  // Display balances
  console.log("\n=== Token Balances ===");
  for (let i = 1; i <= 3; i++) {
    const trader = [trader1, trader2, trader3][i - 1];
    const ethBalance = await ethToken.balanceOf(trader.address);
    const usdcBalance = await usdcToken.balanceOf(trader.address);
    
    console.log(`Trader ${i}:`);
    console.log(`  ETH: ${ethers.utils.formatEther(ethBalance)}`);
    console.log(`  USDC: ${ethers.utils.formatUnits(usdcBalance, 6)}`);
  }

  console.log("\n=== Test Environment Ready ===");
  console.log("You can now test the matching engine with these orders!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
