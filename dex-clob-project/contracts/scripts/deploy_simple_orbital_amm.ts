// scripts/deploy_simple_orbital_amm.ts
import { ethers } from "hardhat";
import { BigNumber } from "ethers";

async function main() {
    console.log("🚀 Deploying Simple Orbital AMM System...");
    
    // Get the deployer
    const [deployer] = await ethers.getSigners();
    console.log("Deploying with account:", deployer.address);
    
    const balance = await deployer.getBalance();
    console.log("Account balance:", ethers.utils.formatEther(balance), "ETH");

    // Deploy Simple Factory
    console.log("\n📦 Deploying Simple Orbital AMM Factory...");
    const SimpleFactory = await ethers.getContractFactory("SimpleOrbitalAMMFactory");
    const factory = await SimpleFactory.deploy();
    await factory.deployed();
    console.log("✅ Simple Factory deployed to:", factory.address);

    // Deploy test tokens
    console.log("\n🪙 Deploying test ERC20 tokens...");
    
    const TestToken = await ethers.getContractFactory("MockERC20");
    
    const tokenA = await TestToken.deploy("Token A", "TKNA", 18, ethers.utils.parseEther("1000000"));
    await tokenA.deployed();
    console.log("✅ Token A deployed to:", tokenA.address);
    
    const tokenB = await TestToken.deploy("Token B", "TKNB", 18, ethers.utils.parseEther("1000000"));
    await tokenB.deployed();
    console.log("✅ Token B deployed to:", tokenB.address);

    // Create pool
    console.log("\n🏊 Creating Simple Orbital AMM Pool...");
    const fee = 3000; // 0.3% fee
    const tx = await factory.createPool(tokenA.address, tokenB.address, fee);
    const receipt = await tx.wait();
    
    // Get pool address from event
    const poolCreatedEvent = receipt.events?.find((event: any) => event.event === 'PoolCreated');
    
    if (poolCreatedEvent) {
        const poolAddress = poolCreatedEvent.args?.pool;
        console.log("✅ Simple Orbital AMM Pool created at:", poolAddress);
        
        // Initialize pool
        console.log("\n🎯 Initializing Pool...");
        const SimpleOrbitalAMM = await ethers.getContractFactory("SimpleOrbitalAMM");
        const pool = SimpleOrbitalAMM.attach(poolAddress);
        
        // Initialize with 1:1 price
        const sqrtPriceX96 = BigNumber.from("79228162514264337593543950336"); // sqrt(1) * 2^96
        await pool.initialize(sqrtPriceX96);
        console.log("✅ Pool initialized with price ratio 1:1");
        
        // Test pool info
        console.log("\n📊 Pool Information:");
        console.log("  - Token0:", await pool.getToken0());
        console.log("  - Token1:", await pool.getToken1());
        console.log("  - Fee:", await pool.fee(), "bp");
        console.log("  - Tick Spacing:", await pool.tickSpacing());
        console.log("  - Total Liquidity:", await pool.totalLiquidity());
        console.log("  - Reserve0:", await pool.reserve0());
        console.log("  - Reserve1:", await pool.reserve1());
        console.log("  - Orbital Factor:", await pool.orbitalFactor());
        
    } else {
        console.log("❌ Failed to find PoolCreated event");
    }

    // Summary
    console.log("\n📋 Deployment Summary:");
    console.log("=".repeat(50));
    console.log("Simple Factory:", factory.address);
    console.log("Test Token A:", tokenA.address);
    console.log("Test Token B:", tokenB.address);
    console.log("=".repeat(50));
    
    console.log("\n✨ Simple Orbital AMM System deployed successfully!");
    console.log("\n🔧 Next steps:");
    console.log("  1. Add liquidity to the pool");
    console.log("  2. Test swapping functionality");
    console.log("  3. Monitor orbital curve behavior");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
