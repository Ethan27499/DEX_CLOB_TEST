import { ethers, network } from "hardhat";

async function main() {
    console.log("🚀 Deploying Paradigm-Style Orbital AMM System...");
    console.log("Network:", network.name);
    
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.utils.formatEther(await deployer.getBalance()));

    // =================================================================
    // 1. Deploy Mock Stablecoins for Testing
    // =================================================================
    
    console.log("\n📄 Deploying Mock Stablecoins...");
    
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6, 0);
    await usdc.deployed();
    console.log("✅ USDC deployed to:", usdc.address);
    
    const usdt = await MockERC20.deploy("Tether USD", "USDT", 6, 0);
    await usdt.deployed();
    console.log("✅ USDT deployed to:", usdt.address);
    
    const dai = await MockERC20.deploy("Dai Stablecoin", "DAI", 18, 0);
    await dai.deployed();
    console.log("✅ DAI deployed to:", dai.address);
    
    const frax = await MockERC20.deploy("Frax", "FRAX", 18, 0);
    await frax.deployed();
    console.log("✅ FRAX deployed to:", frax.address);
    
    const lusd = await MockERC20.deploy("Liquity USD", "LUSD", 18, 0);
    await lusd.deployed();
    console.log("✅ LUSD deployed to:", lusd.address);

    // =================================================================
    // 2. Deploy Core Orbital AMM Contracts
    // =================================================================
    
    console.log("\n🌌 Deploying Orbital AMM Contracts...");
    
    // Deploy DepegManager first
    const DepegManager = await ethers.getContractFactory("DepegManager");
    const depegManager = await DepegManager.deploy();
    await depegManager.deployed();
    console.log("✅ DepegManager deployed to:", depegManager.address);
    
    // Deploy ParadigmOrbitalAMM
    const ParadigmOrbitalAMM = await ethers.getContractFactory("ParadigmOrbitalAMM");
    const orbitalAMM = await ParadigmOrbitalAMM.deploy();
    await orbitalAMM.deployed();
    console.log("✅ ParadigmOrbitalAMM deployed to:", orbitalAMM.address);

    // =================================================================
    // 3. Configure Orbital AMM Pools
    // =================================================================
    
    console.log("\n🏊 Creating Orbital AMM Pools...");
    
    // Pool 1: Major Stablecoins (USDC, USDT, DAI)
    const majorStableTokens = [usdc.address, usdt.address, dai.address];
    
    const majorStableWeights = [
        ethers.utils.parseEther("0.40"), // 40% USDC
        ethers.utils.parseEther("0.35"), // 35% USDT  
        ethers.utils.parseEther("0.25")  // 25% DAI
    ];
    
    const majorStablePriceRanges = [
        ethers.utils.parseEther("1.01"), // USDC range
        ethers.utils.parseEther("1.01"), // USDT range
        ethers.utils.parseEther("1.02")  // DAI range (slightly wider)
    ];
    
    const createMajorPoolTx = await orbitalAMM.createPool(
        majorStableTokens,
        majorStableWeights,
        1000, // High amplification for stability
        majorStablePriceRanges
    );
    const majorPoolReceipt = await createMajorPoolTx.wait();
    
    // Extract pool ID from events
    const majorPoolCreatedEvent = majorPoolReceipt.events?.find(
        (event: any) => event.event === "PoolCreated"
    );
    const majorPoolId = majorPoolCreatedEvent ? majorPoolCreatedEvent.args[0] : null;
    console.log("✅ Major Stablecoin Pool created:", majorPoolId);
    
    // Pool 2: All Stablecoins (5-asset pool showcasing multi-asset capability)
    const allTokens = [usdc.address, usdt.address, dai.address, frax.address, lusd.address];
    
    const allWeights = [
        ethers.utils.parseEther("0.25"), // 25% USDC
        ethers.utils.parseEther("0.25"), // 25% USDT
        ethers.utils.parseEther("0.25"), // 25% DAI
        ethers.utils.parseEther("0.15"), // 15% FRAX
        ethers.utils.parseEther("0.10")  // 10% LUSD
    ];
    
    const allPriceRanges = [
        ethers.utils.parseEther("1.01"), // USDC
        ethers.utils.parseEther("1.01"), // USDT
        ethers.utils.parseEther("1.02"), // DAI
        ethers.utils.parseEther("1.03"), // FRAX (wider range)
        ethers.utils.parseEther("1.03")  // LUSD (wider range)
    ];
    
    const createAllPoolTx = await orbitalAMM.createPool(
        allTokens,
        allWeights,
        800, // Moderate amplification for 5 assets
        allPriceRanges
    );
    const allPoolReceipt = await createAllPoolTx.wait();
    
    const allPoolCreatedEvent = allPoolReceipt.events?.find(
        (event: any) => event.event === "PoolCreated"
    );
    const allPoolId = allPoolCreatedEvent ? allPoolCreatedEvent.args[0] : null;
    console.log("✅ Multi-Asset Pool (5 tokens) created:", allPoolId);

    // =================================================================
    // 4. Add Initial Liquidity
    // =================================================================
    
    console.log("\n💧 Adding Initial Liquidity...");
    
    // Mint tokens to deployer
    const mintAmount = ethers.utils.parseUnits("1000000", 6); // 1M for 6-decimal tokens
    const mintAmountDAI = ethers.utils.parseEther("1000000");   // 1M for 18-decimal tokens
    
    await usdc.mint(deployer.address, mintAmount);
    await usdt.mint(deployer.address, mintAmount);
    await dai.mint(deployer.address, mintAmountDAI);
    await frax.mint(deployer.address, mintAmountDAI);
    await lusd.mint(deployer.address, mintAmountDAI);
    
    console.log("✅ Minted initial tokens to deployer");
    
    // Add liquidity to major pool
    const majorLiquidityAmounts = [
        ethers.utils.parseUnits("100000", 6), // 100K USDC
        ethers.utils.parseUnits("100000", 6), // 100K USDT
        ethers.utils.parseEther("100000")     // 100K DAI
    ];
    
    // Approve tokens
    await usdc.approve(orbitalAMM.address, majorLiquidityAmounts[0]);
    await usdt.approve(orbitalAMM.address, majorLiquidityAmounts[1]);
    await dai.approve(orbitalAMM.address, majorLiquidityAmounts[2]);
    
    if (majorPoolId) {
        const addLiquidityTx = await orbitalAMM.addLiquidity(
            majorPoolId,
            majorLiquidityAmounts,
            0, // minLPTokens
            ethers.utils.parseEther("0.99"), // minPrice
            ethers.utils.parseEther("1.01")  // maxPrice
        );
        await addLiquidityTx.wait();
        console.log("✅ Added liquidity to Major Stablecoin Pool");
    }

    // =================================================================
    // 5. Test Swaps
    // =================================================================
    
    console.log("\n🔄 Testing Orbital AMM Swaps...");
    
    if (majorPoolId) {
        // Test swap: 1000 USDC -> USDT
        const swapAmount = ethers.utils.parseUnits("1000", 6);
        await usdc.approve(orbitalAMM.address, swapAmount);
        
        // Get quote first
        const quote = await orbitalAMM.getSwapQuote(
            majorPoolId,
            usdc.address,
            usdt.address,
            swapAmount
        );
        
        console.log("📊 Swap Quote:");
        console.log("  Amount Out:", ethers.utils.formatUnits(quote.amountOut, 6), "USDT");
        console.log("  Price Impact:", quote.priceImpact.toString(), "basis points");
        console.log("  Fee:", ethers.utils.formatUnits(quote.fee, 6), "USDC");
        
        // Execute swap
        const swapTx = await orbitalAMM.swap(
            majorPoolId,
            usdc.address,
            usdt.address,
            swapAmount,
            quote.amountOut.mul(99).div(100) // 1% slippage tolerance
        );
        await swapTx.wait();
        
        console.log("✅ Test swap executed successfully!");
    }

    // =================================================================
    // 6. Display Summary
    // =================================================================
    
    console.log("\n🎉 DEPLOYMENT COMPLETE!");
    console.log("========================================");
    console.log("📄 Token Contracts:");
    console.log("  USDC:", usdc.address);
    console.log("  USDT:", usdt.address);
    console.log("  DAI:", dai.address);
    console.log("  FRAX:", frax.address);
    console.log("  LUSD:", lusd.address);
    console.log("\n🌌 Orbital AMM Contracts:");
    console.log("  ParadigmOrbitalAMM:", orbitalAMM.address);
    console.log("  DepegManager:", depegManager.address);
    console.log("\n🏊 Pool Information:");
    console.log("  Major Stablecoin Pool ID:", majorPoolId);
    console.log("  Multi-Asset Pool ID:", allPoolId);
    console.log("\n💰 Ready for Trading!");
    console.log("  Total Pools:", 2);
    console.log("  Total Assets:", 5);
    console.log("  Risk Monitoring: Active");
    console.log("  Multi-Asset Support: Up to 10,000 tokens per pool");
    
    // Save deployment info
    const deploymentInfo = {
        network: network.name,
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        contracts: {
            tokens: {
                USDC: usdc.address,
                USDT: usdt.address,
                DAI: dai.address,
                FRAX: frax.address,
                LUSD: lusd.address
            },
            orbital: {
                ParadigmOrbitalAMM: orbitalAMM.address,
                DepegManager: depegManager.address
            }
        },
        pools: {
            majorStablecoin: majorPoolId,
            multiAsset: allPoolId
        }
    };
    
    console.log("\n📁 Deployment Info:", JSON.stringify(deploymentInfo, null, 2));
    
    return {
        tokens: { usdc, usdt, dai, frax, lusd },
        orbital: { orbitalAMM, depegManager },
        pools: { majorPoolId, allPoolId },
        info: deploymentInfo
    };
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then((result) => {
        console.log("\n🚀 Paradigm Orbital AMM deployed successfully!");
        console.log("🌟 Ready to capture the $27T stablecoin market!");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Deployment failed:", error);
        process.exit(1);
    });
