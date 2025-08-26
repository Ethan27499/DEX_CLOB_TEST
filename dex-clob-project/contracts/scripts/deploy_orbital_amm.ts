// scripts/deploy_orbital_amm.ts
import { ethers } from "hardhat";
import { BigNumber } from "ethers";

async function main() {
    console.log("🚀 Deploying Orbital AMM System...");
    
    // Get the deployer
    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);
    
    const balance = await deployer.getBalance();
    console.log("Account balance:", ethers.utils.formatEther(balance), "ETH");

    // Deploy OrbitalAMM Factory
    console.log("\n📦 Deploying OrbitalAMM Factory...");
    const OrbitalAMMFactory = await ethers.getContractFactory("OrbitalAMMFactory");
    const factory = await OrbitalAMMFactory.deploy();
    await factory.deployed();
    console.log("✅ OrbitalAMM Factory deployed to:", factory.address);

    // Deploy test tokens for demonstration
    console.log("\n🪙 Deploying test ERC20 tokens...");
    
    const TestToken = await ethers.getContractFactory("MockERC20");
    
    const tokenA = await TestToken.deploy("Token A", "TKNA", 18, ethers.utils.parseEther("1000000"));
    await tokenA.deployed();
    console.log("✅ Token A deployed to:", tokenA.address);
    
    const tokenB = await TestToken.deploy("Token B", "TKNB", 18, ethers.utils.parseEther("1000000"));
    await tokenB.deployed();
    console.log("✅ Token B deployed to:", tokenB.address);

    // Create a pool
    console.log("\n🏊 Creating Orbital AMM Pool...");
    const fee = 3000; // 0.3% fee
    const tx = await factory.createPool(tokenA.address, tokenB.address, fee);
    const receipt = await tx.wait();
    
    // Get the pool address from the event
    const poolCreatedEvent = receipt.events?.find((event: any) => event.event === 'PoolCreated');
    
    if (poolCreatedEvent) {
        const poolAddress = poolCreatedEvent.args?.pool;
        console.log("✅ Orbital AMM Pool created at:", poolAddress);
        
        // Get pool info
        const poolParameters = await factory.getPoolParameters(poolAddress);
        console.log("📊 Pool Parameters:");
        console.log("  - Token0:", poolParameters.token0);
        console.log("  - Token1:", poolParameters.token1);
        console.log("  - Fee:", poolParameters.fee, "bp");
        console.log("  - Tick Spacing:", poolParameters.tickSpacing);
        
        // Initialize the pool
        console.log("\n🎯 Initializing Pool...");
        const OrbitalAMM = await ethers.getContractFactory("OrbitalAMM");
        const pool = OrbitalAMM.attach(poolAddress);
        
        // Initialize with a price of 1:1 (sqrt(1) * 2^96)
        const sqrtPriceX96 = BigNumber.from("79228162514264337593543950336"); // sqrt(1) * 2^96
        await pool.initialize(sqrtPriceX96);
        console.log("✅ Pool initialized with price ratio 1:1");
        
    } else {
        console.log("❌ Failed to find PoolCreated event");
    }

    // Show deployed addresses summary
    console.log("\n📋 Deployment Summary:");
    console.log("=".repeat(50));
    console.log("OrbitalAMM Factory:", factory.address);
    console.log("Test Token A:", tokenA.address);
    console.log("Test Token B:", tokenB.address);
    console.log("=".repeat(50));
    
    console.log("\n✨ Orbital AMM System deployed successfully!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
