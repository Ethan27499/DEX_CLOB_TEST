import { ethers } from "hardhat";
import { expect } from "chai";
import { HybridCLOB, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";

// Extend chai with waffle matchers
import "chai";
import "@nomiclabs/hardhat-waffle";

describe("HybridCLOB", function () {
  let hybridCLOB: HybridCLOB;
  let baseToken: MockERC20;
  let quoteToken: MockERC20;
  let owner: SignerWithAddress;
  let trader1: SignerWithAddress;
  let trader2: SignerWithAddress;
  let settler: SignerWithAddress;
  let feeRecipient: SignerWithAddress;

  const INITIAL_SUPPLY = ethers.utils.parseEther("1000000");
  const TRADE_AMOUNT = ethers.utils.parseEther("1"); // 1 ETH instead of 100
  const TRADE_PRICE = ethers.utils.parseUnits("2000", 18); // 2000 tokens per ETH (both 18 decimals)

  beforeEach(async function () {
    [owner, trader1, trader2, settler, feeRecipient] = await ethers.getSigners();

    // Deploy tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    baseToken = (await MockERC20Factory.deploy("Ethereum", "ETH", 18, INITIAL_SUPPLY)) as MockERC20;
    quoteToken = (await MockERC20Factory.deploy("USD Coin", "USDC", 18, INITIAL_SUPPLY)) as MockERC20;

    // Deploy HybridCLOB
    const HybridCLOBFactory = await ethers.getContractFactory("HybridCLOB");
    hybridCLOB = (await HybridCLOBFactory.deploy(feeRecipient.address)) as HybridCLOB;

    // Grant settler role
    const SETTLER_ROLE = await hybridCLOB.SETTLER_ROLE();
    await hybridCLOB.grantRole(SETTLER_ROLE, settler.address);

    // Add trading pair
    await hybridCLOB.addTradingPair(baseToken.address, quoteToken.address);

    // Set fees to 0 for testing
    await hybridCLOB.setFees(0, 0);

    // Distribute tokens
    await baseToken.transfer(trader1.address, ethers.utils.parseEther("100"));
    await baseToken.transfer(trader2.address, ethers.utils.parseEther("100"));
    await quoteToken.transfer(trader1.address, ethers.utils.parseEther("10000")); // 10K quote tokens
    await quoteToken.transfer(trader2.address, ethers.utils.parseEther("10000")); // 10K quote tokens

    // Approve tokens
    await baseToken.connect(trader1).approve(hybridCLOB.address, ethers.constants.MaxUint256);
    await baseToken.connect(trader2).approve(hybridCLOB.address, ethers.constants.MaxUint256);
    await quoteToken.connect(trader1).approve(hybridCLOB.address, ethers.constants.MaxUint256);
    await quoteToken.connect(trader2).approve(hybridCLOB.address, ethers.constants.MaxUint256);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const DEFAULT_ADMIN_ROLE = await hybridCLOB.DEFAULT_ADMIN_ROLE();
      expect(await hybridCLOB.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should set the fee recipient", async function () {
      expect(await hybridCLOB.feeRecipient()).to.equal(feeRecipient.address);
    });

    it("Should have trading pair added", async function () {
      expect(await hybridCLOB.isTradingPairSupported(baseToken.address, quoteToken.address)).to.be.true;
    });
  });

  describe("Order Management", function () {
    it("Should place a buy order", async function () {
      const tx = await hybridCLOB.connect(trader1).placeOrder(
        baseToken.address,
        quoteToken.address,
        TRADE_AMOUNT,
        TRADE_PRICE,
        0, // Buy
        0  // No expiry
      );

      await expect(tx)
        .to.emit(hybridCLOB, "OrderPlaced")
        .withArgs(
          1, // orderId
          trader1.address,
          baseToken.address,
          quoteToken.address,
          TRADE_AMOUNT,
          TRADE_PRICE,
          0, // Buy
          await ethers.provider.getBlock("latest").then((b: any) => b.timestamp)
        );

      const order = await hybridCLOB.getOrder(1);
      expect(order.trader).to.equal(trader1.address);
      expect(order.amount).to.equal(TRADE_AMOUNT);
      expect(order.price).to.equal(TRADE_PRICE);
      expect(order.side).to.equal(0); // Buy
      expect(order.status).to.equal(0); // Active
    });

    it("Should place a sell order", async function () {
      await hybridCLOB.connect(trader2).placeOrder(
        baseToken.address,
        quoteToken.address,
        TRADE_AMOUNT,
        TRADE_PRICE,
        1, // Sell
        0  // No expiry
      );

      const order = await hybridCLOB.getOrder(1);
      expect(order.side).to.equal(1); // Sell
    });

    it("Should cancel an order", async function () {
      // Place order
      await hybridCLOB.connect(trader1).placeOrder(
        baseToken.address,
        quoteToken.address,
        TRADE_AMOUNT,
        TRADE_PRICE,
        0, // Buy
        0
      );

      // Cancel order
      const tx = await hybridCLOB.connect(trader1).cancelOrder(1);
      
      await expect(tx)
        .to.emit(hybridCLOB, "OrderCancelled")
        .withArgs(1, trader1.address, await ethers.provider.getBlock("latest").then((b: any) => b.timestamp));

      const order = await hybridCLOB.getOrder(1);
      expect(order.status).to.equal(1); // Cancelled
    });

    it("Should not allow cancelling other's order", async function () {
      await hybridCLOB.connect(trader1).placeOrder(
        baseToken.address,
        quoteToken.address,
        TRADE_AMOUNT,
        TRADE_PRICE,
        0, // Buy
        0
      );

      await expect(
        hybridCLOB.connect(trader2).cancelOrder(1)
      ).to.be.revertedWith("Not order owner");
    });

    it("Should not allow placing order for unsupported pair", async function () {
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const invalidToken = await MockERC20Factory.deploy("Invalid", "INV", 18, INITIAL_SUPPLY);

      await expect(
        hybridCLOB.connect(trader1).placeOrder(
          invalidToken.address,
          quoteToken.address,
          TRADE_AMOUNT,
          TRADE_PRICE,
          0,
          0
        )
      ).to.be.revertedWith("Trading pair not supported");
    });
  });

  describe("Settlement", function () {
    beforeEach(async function () {
      // Place buy order (trader1 buys ETH with USDC)
      await hybridCLOB.connect(trader1).placeOrder(
        baseToken.address,
        quoteToken.address,
        TRADE_AMOUNT,
        TRADE_PRICE,
        0, // Buy
        0
      );

      // Place sell order (trader2 sells ETH for USDC)
      await hybridCLOB.connect(trader2).placeOrder(
        baseToken.address,
        quoteToken.address,
        TRADE_AMOUNT,
        TRADE_PRICE,
        1, // Sell
        0
      );
    });

    it("Should settle a batch successfully", async function () {
      const batchHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256[]", "uint256[]", "uint256[]", "uint256[]"],
          [[1], [2], [TRADE_AMOUNT], [TRADE_PRICE]]
        )
      );

      const tx = await hybridCLOB.connect(settler).settleBatch(
        [1], // buyOrderIds
        [2], // sellOrderIds
        [TRADE_AMOUNT], // amounts
        [TRADE_PRICE], // prices
        batchHash
      );

      await expect(tx)
        .to.emit(hybridCLOB, "OrderMatched")
        .withArgs(
          1, // tradeId
          1, // buyOrderId
          2, // sellOrderId
          TRADE_AMOUNT,
          TRADE_PRICE,
          trader1.address,
          trader2.address,
          await ethers.provider.getBlock("latest").then((b: any) => b.timestamp)
        );

      await expect(tx)
        .to.emit(hybridCLOB, "BatchSettled");

      // Check orders are matched
      const buyOrder = await hybridCLOB.getOrder(1);
      const sellOrder = await hybridCLOB.getOrder(2);
      expect(buyOrder.status).to.equal(2); // Matched
      expect(sellOrder.status).to.equal(2); // Matched
      expect(buyOrder.filledAmount).to.equal(TRADE_AMOUNT);
      expect(sellOrder.filledAmount).to.equal(TRADE_AMOUNT);
    });

    it("Should not allow double settlement", async function () {
      const batchHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["uint256[]", "uint256[]", "uint256[]", "uint256[]"],
          [[1], [2], [TRADE_AMOUNT], [TRADE_PRICE]]
        )
      );

      // First settlement
      await hybridCLOB.connect(settler).settleBatch(
        [1], [2], [TRADE_AMOUNT], [TRADE_PRICE], batchHash
      );

      // Second settlement should fail
      await expect(
        hybridCLOB.connect(settler).settleBatch(
          [1], [2], [TRADE_AMOUNT], [TRADE_PRICE], batchHash
        )
      ).to.be.revertedWith("Batch already processed");
    });

    it("Should not allow non-settler to settle", async function () {
      const batchHash = ethers.utils.keccak256("0x");

      await expect(
        hybridCLOB.connect(trader1).settleBatch(
          [1], [2], [TRADE_AMOUNT], [TRADE_PRICE], batchHash
        )
      ).to.be.reverted;
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to add trading pair", async function () {
      const MockERC20Factory = await ethers.getContractFactory("MockERC20");
      const newToken = await MockERC20Factory.deploy("New Token", "NEW", 18, INITIAL_SUPPLY);

      const tx = await hybridCLOB.addTradingPair(newToken.address, quoteToken.address);
      
      await expect(tx)
        .to.emit(hybridCLOB, "TradingPairAdded")
        .withArgs(newToken.address, quoteToken.address);

      expect(await hybridCLOB.isTradingPairSupported(newToken.address, quoteToken.address)).to.be.true;
    });

    it("Should allow admin to set fees", async function () {
      const newMakerFee = 50;
      const newTakerFee = 100;

      const tx = await hybridCLOB.setFees(newMakerFee, newTakerFee);
      
      await expect(tx)
        .to.emit(hybridCLOB, "FeesUpdated")
        .withArgs(newMakerFee, newTakerFee);

      expect(await hybridCLOB.makerFee()).to.equal(newMakerFee);
      expect(await hybridCLOB.takerFee()).to.equal(newTakerFee);
    });

    it("Should not allow setting fees too high", async function () {
      await expect(
        hybridCLOB.setFees(2000, 2000) // 2%
      ).to.be.revertedWith("Fee too high");
    });
  });

  describe("View Functions", function () {
    it("Should return user orders", async function () {
      await hybridCLOB.connect(trader1).placeOrder(
        baseToken.address,
        quoteToken.address,
        TRADE_AMOUNT,
        TRADE_PRICE,
        0, // Buy
        0
      );

      await hybridCLOB.connect(trader1).placeOrder(
        baseToken.address,
        quoteToken.address,
        TRADE_AMOUNT.div(2),
        TRADE_PRICE,
        0, // Buy
        0
      );

      const userOrders = await hybridCLOB.getUserOrders(trader1.address);
      expect(userOrders.length).to.equal(2);
      expect(userOrders[0]).to.equal(1);
      expect(userOrders[1]).to.equal(2);
    });

    it("Should return active orders only", async function () {
      // Place orders
      await hybridCLOB.connect(trader1).placeOrder(
        baseToken.address,
        quoteToken.address,
        TRADE_AMOUNT,
        TRADE_PRICE,
        0, 0
      );

      await hybridCLOB.connect(trader1).placeOrder(
        baseToken.address,
        quoteToken.address,
        TRADE_AMOUNT,
        TRADE_PRICE,
        0, 0
      );

      // Cancel one order
      await hybridCLOB.connect(trader1).cancelOrder(1);

      const activeOrders = await hybridCLOB.getUserActiveOrders(trader1.address);
      expect(activeOrders.length).to.equal(1);
      expect(activeOrders[0]).to.equal(2);
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow emergency withdrawal", async function () {
      const EMERGENCY_ROLE = await hybridCLOB.EMERGENCY_ROLE();
      
      // Transfer some tokens to contract
      await baseToken.transfer(hybridCLOB.address, TRADE_AMOUNT);
      
      const balanceBefore = await baseToken.balanceOf(owner.address);
      
      await hybridCLOB.emergencyWithdraw(
        baseToken.address,
        TRADE_AMOUNT,
        owner.address
      );
      
      const balanceAfter = await baseToken.balanceOf(owner.address);
      expect(balanceAfter.sub(balanceBefore)).to.equal(TRADE_AMOUNT);
    });

    it("Should allow emergency cancel orders", async function () {
      // Place order
      await hybridCLOB.connect(trader1).placeOrder(
        baseToken.address,
        quoteToken.address,
        TRADE_AMOUNT,
        TRADE_PRICE,
        0, 0
      );

      await hybridCLOB.emergencyCancelOrders([1]);

      const order = await hybridCLOB.getOrder(1);
      expect(order.status).to.equal(1); // Cancelled
    });
  });
});
