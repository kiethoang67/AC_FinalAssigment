const {
  time,
  loadFixture,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BankingSystem", function () {
  // Tiện ích hỗ trợ chuyển đổi 6 decimals (giống USDC)
  const parseUSDC = (amount) => ethers.parseUnits(amount.toString(), 6);
  const formatUSDC = (amount) => ethers.formatUnits(amount, 6);

  // Sử dụng loadFixture để thiết lập trạng thái ban đầu cho các test cases.
  // Điều này giúp tối ưu thời gian chạy test vì trạng thái mạng sẽ được snapshot và reset lại.
  async function deployBankingSystemFixture() {
    // Lấy các tài khoản giả lập từ Hardhat
    const [admin, feeReceiver, user1, user2] = await ethers.getSigners();

    // 1. Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const token = await MockUSDC.deploy();
    const tokenAddress = await token.getAddress();

    // 2. Deploy VaultManager
    const VaultManager = await ethers.getContractFactory("VaultManager");
    const vaultManager = await VaultManager.deploy(tokenAddress, feeReceiver.address);
    const vaultAddress = await vaultManager.getAddress();

    // 3. Deploy SavingCore
    const SavingCore = await ethers.getContractFactory("SavingCore");
    const savingCore = await SavingCore.deploy(tokenAddress, vaultAddress);
    const savingCoreAddress = await savingCore.getAddress();

    // 4. Liên kết SavingCore với VaultManager
    await vaultManager.setSavingCore(savingCoreAddress);

    // 5. Setup Plan (Tạo gói tiết kiệm mẫu)
    // Gói 1: 90 ngày, 8%/năm, tối thiểu 100 USDC, tối đa 10,000 USDC, phạt 5%
    const tenorDays = 90;
    const aprBps = 800; // 8%
    const minDeposit = parseUSDC(100);
    const maxDeposit = parseUSDC(10000);
    const penaltyBps = 500; // 5%

    await savingCore.createPlan(tenorDays, aprBps, minDeposit, maxDeposit, penaltyBps);

    // 6. Cấp MockUSDC cho User1 để test
    const initialUserBalance = parseUSDC(50000);
    await token.mint(user1.address, initialUserBalance);

    // 7. Admin nạp tiền vào VaultManager để chuẩn bị quỹ trả lãi
    const vaultFunding = parseUSDC(10000);
    await token.mint(admin.address, vaultFunding);
    await token.connect(admin).approve(vaultAddress, vaultFunding);
    await vaultManager.fundVault(vaultFunding);

    return { token, vaultManager, savingCore, admin, feeReceiver, user1, user2, parseUSDC };
  }

  describe("Deployment & Setup", function () {
    it("Should set the right owner", async function () {
      const { savingCore, admin } = await loadFixture(deployBankingSystemFixture);
      expect(await savingCore.owner()).to.equal(admin.address);
    });

    it("Should mint MockUSDC for User and fund VaultManager", async function () {
      const { token, vaultManager, user1, parseUSDC } = await loadFixture(deployBankingSystemFixture);
      // Kiểm tra User1 có 50,000 USDC
      expect(await token.balanceOf(user1.address)).to.equal(parseUSDC(50000));
      // Kiểm tra VaultManager có 10,000 USDC
      expect(await vaultManager.vaultBalance()).to.equal(parseUSDC(10000));
    });
  });

  describe("Happy Path", function () {
    it("Should open a deposit, wait 90 days, and withdraw principal + interest", async function () {
      const { token, savingCore, user1, parseUSDC } = await loadFixture(deployBankingSystemFixture);

      const depositAmount = parseUSDC(1000);
      const planId = 1;

      // User1 cấp quyền cho SavingCore rút tiền
      await token.connect(user1).approve(await savingCore.getAddress(), depositAmount);

      // User1 mở sổ tiết kiệm
      await expect(savingCore.connect(user1).openDeposit(planId, depositAmount))
        .to.emit(savingCore, "DepositOpened")
        .withArgs(1, user1.address, planId, depositAmount, anyValue, 800);

      // Kiểm tra User1 đã nhận được NFT (depositId = 1)
      expect(await savingCore.ownerOf(1)).to.equal(user1.address);

      // Kiểm tra số dư User1 đã bị trừ
      expect(await token.balanceOf(user1.address)).to.equal(parseUSDC(49000));

      // Giả lập thời gian trôi qua 90 ngày (đáo hạn)
      await time.increase(90 * 24 * 60 * 60);

      // Tính toán số lãi dự kiến trực tiếp từ smart contract
      const expectedInterest = await savingCore.calculateInterest(1);

      // Rút tiền khi đáo hạn
      await expect(savingCore.connect(user1).withdrawAtMaturity(1))
        .to.emit(savingCore, "Withdrawn")
        .withArgs(1, user1.address, depositAmount, expectedInterest, false);

      // Kiểm tra số dư User1 sau khi rút (gốc + lãi)
      const finalBalance = await token.balanceOf(user1.address);
      expect(finalBalance).to.equal(parseUSDC(49000) + depositAmount + expectedInterest);
    });
  });

  describe("Early Withdraw", function () {
    it("Should deduct 5% penalty, pay 0 interest, and send penalty to feeReceiver", async function () {
      const { token, savingCore, feeReceiver, user1, parseUSDC } = await loadFixture(deployBankingSystemFixture);

      const depositAmount = parseUSDC(1000);
      const planId = 1;

      // User1 cấp quyền và mở sổ tiết kiệm
      await token.connect(user1).approve(await savingCore.getAddress(), depositAmount);
      await savingCore.connect(user1).openDeposit(planId, depositAmount);

      // Giả lập thời gian trôi qua 30 ngày (chưa đáo hạn)
      await time.increase(30 * 24 * 60 * 60);

      // Tính toán tiền phạt = 5% của 1000 = 50 USDC
      const expectedPenalty = parseUSDC(50);
      const expectedReturn = depositAmount - expectedPenalty; // 950 USDC

      const feeReceiverBalanceBefore = await token.balanceOf(feeReceiver.address);
      const userBalanceBefore = await token.balanceOf(user1.address);

      // Thực hiện rút sớm (Early Withdraw)
      await expect(savingCore.connect(user1).earlyWithdraw(1))
        .to.emit(savingCore, "Withdrawn")
        .withArgs(1, user1.address, depositAmount, 0, true);

      // Kiểm tra số dư User1 nhận lại (chỉ còn 950 USDC)
      const userBalanceAfter = await token.balanceOf(user1.address);
      expect(userBalanceAfter - userBalanceBefore).to.equal(expectedReturn);

      // Kiểm tra feeReceiver nhận được phí phạt (50 USDC)
      const feeReceiverBalanceAfter = await token.balanceOf(feeReceiver.address);
      expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(expectedPenalty);
    });
  });

  describe("Best-Effort Payout (Liquidity Trap)", function () {
    it("Should return full principal and partial interest when vault is low", async function () {
      const { token, savingCore, vaultManager, admin, user1, parseUSDC } = await loadFixture(deployBankingSystemFixture);

      const depositAmount = parseUSDC(1000);
      const planId = 1;

      // User1 cấp quyền và mở sổ tiết kiệm
      await token.connect(user1).approve(await savingCore.getAddress(), depositAmount);
      await savingCore.connect(user1).openDeposit(planId, depositAmount);

      // Giả lập thời gian trôi qua 90 ngày (đáo hạn)
      await time.increase(90 * 24 * 60 * 60);

      // Lãi dự kiến (khoảng 19.72 USDC)
      const expectedInterest = await savingCore.calculateInterest(1);

      // KỊCH BẢN: Admin rút bớt quỹ của Vault, chỉ để lại 10 USDC (ít hơn số lãi dự kiến)
      const currentVaultBalance = await vaultManager.vaultBalance();
      const drainAmount = currentVaultBalance - parseUSDC(10);
      await vaultManager.connect(admin).withdrawVault(drainAmount);

      expect(await vaultManager.vaultBalance()).to.equal(parseUSDC(10));

      const userBalanceBefore = await token.balanceOf(user1.address);

      // Rút tiền khi đáo hạn (Best-Effort Payout sẽ được kích hoạt)
      await expect(savingCore.connect(user1).withdrawAtMaturity(1))
        .to.emit(savingCore, "PartialInterestPaid") // Vault thiếu tiền, emit event PartialInterestPaid
        .withArgs(1, expectedInterest, parseUSDC(10)) // Báo cáo: Đáng lẽ nhận expectedInterest, nhưng chỉ nhận 10 USDC
        .and.to.emit(savingCore, "Withdrawn")
        .withArgs(1, user1.address, depositAmount, parseUSDC(10), false);

      // Kiểm tra số dư User1: Nhận lại 100% gốc (1000) + số lãi có sẵn trong Vault (10)
      const userBalanceAfter = await token.balanceOf(user1.address);
      expect(userBalanceAfter - userBalanceBefore).to.equal(depositAmount + parseUSDC(10));
    });
  });

  describe("Auto-Renew", function () {
    it("Should revert with AboveMaxDeposit if compounding interest exceeds maxDeposit", async function () {
      const { token, savingCore, admin, user1, parseUSDC } = await loadFixture(deployBankingSystemFixture);

      // Tạo Gói tiết kiệm số 2 với maxDeposit rất ngặt nghèo (1000 USDC)
      await savingCore.connect(admin).createPlan(90, 800, parseUSDC(100), parseUSDC(1000), 500);
      const planId = 2;

      // User1 gửi tiền bằng đúng mức tối đa của gói (1000 USDC)
      const depositAmount = parseUSDC(1000);
      await token.connect(user1).approve(await savingCore.getAddress(), depositAmount);
      await savingCore.connect(user1).openDeposit(planId, depositAmount);

      // Giả lập thời gian trôi qua: 90 ngày (đáo hạn) + 3 ngày (ân hạn/Grace Period) + 1 giây
      await time.increase(93 * 24 * 60 * 60 + 1);

      // Gốc mới = Gốc cũ (1000) + Lãi (~19.72) = ~1019.72 USDC
      // Mức này đã vượt quá maxDeposit (1000)
      const expectedInterest = await savingCore.calculateInterest(1);
      const expectedNewPrincipal = depositAmount + expectedInterest;

      // Khi gọi autoRenewDeposit, giao dịch phải bị revert với Custom Error "AboveMaxDeposit"
      await expect(savingCore.connect(user1).autoRenewDeposit(1))
        .to.be.revertedWithCustomError(savingCore, "AboveMaxDeposit")
        .withArgs(expectedNewPrincipal, parseUSDC(1000));
    });

    it("Should auto-renew and use the CURRENT plan APR (not the old snapshot)", async function () {
      const { token, savingCore, admin, user1, parseUSDC } = await loadFixture(deployBankingSystemFixture);

      const depositAmount = parseUSDC(1000);
      const planId = 1; // maxDeposit là 10,000, nên ~1019.72 sẽ lọt qua dễ dàng

      await token.connect(user1).approve(await savingCore.getAddress(), depositAmount);
      await savingCore.connect(user1).openDeposit(planId, depositAmount);

      // TRƯỚC KHI gia hạn, Admin cập nhật lãi suất Gói 1 lên 10% (1000 bps)
      await savingCore.connect(admin).updatePlan(planId, 1000);

      // Giả lập thời gian trôi qua: 90 ngày (đáo hạn) + 3 ngày (ân hạn/Grace Period) + 1 giây
      await time.increase(93 * 24 * 60 * 60 + 1);

      const expectedInterest = await savingCore.calculateInterest(1);
      const expectedNewPrincipal = depositAmount + expectedInterest;

      // Thực hiện tự động gia hạn
      await expect(savingCore.connect(user1).autoRenewDeposit(1))
        .to.emit(savingCore, "Renewed")
        .withArgs(1, 2, expectedNewPrincipal, planId); // oldDepositId: 1, newDepositId: 2

      // Kiểm tra khoản gửi MỚI (depositId = 2)
      const newDeposit = await savingCore.getDeposit(2);
      expect(newDeposit.principal).to.equal(expectedNewPrincipal);
      
      // Khoản gửi mới phải cập nhật mức lãi suất HIỆN TẠI (1000 bps), 
      // chứ không dùng mức lãi suất cũ (800 bps) lúc mở sổ nữa.
      expect(newDeposit.aprBpsAtOpen).to.equal(1000);
    });
  });

  // =========================================================
  // BỔ SUNG CÁC TEST CASES ĐỂ ĐẠT 90%+ COVERAGE
  // =========================================================

  describe("MockUSDC Edge Cases", function () {
    it("Should return correct decimals", async function () {
      const { token } = await loadFixture(deployBankingSystemFixture);
      expect(await token.decimals()).to.equal(6); // Cover hàm decimals()
    });
  });

  describe("VaultManager Admin & Errors", function () {
    it("Should revert on ZeroAddress", async function () {
      const VaultManagerFactory = await ethers.getContractFactory("VaultManager");
      const { token, feeReceiver } = await loadFixture(deployBankingSystemFixture);
      
      // Cover lỗi ZeroAddress trong constructor
      await expect(
        VaultManagerFactory.deploy(ethers.ZeroAddress, feeReceiver.address)
      ).to.be.revertedWithCustomError(VaultManagerFactory, "ZeroAddress");

      await expect(
        VaultManagerFactory.deploy(await token.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(VaultManagerFactory, "ZeroAddress");
    });

    it("Should revert when withdrawing more than vault balance", async function () {
      const { vaultManager, admin, parseUSDC } = await loadFixture(deployBankingSystemFixture);
      const balance = await vaultManager.vaultBalance();
      // Cover lỗi InsufficientVaultBalance
      await expect(
        vaultManager.connect(admin).withdrawVault(balance + parseUSDC(1))
      ).to.be.revertedWithCustomError(vaultManager, "InsufficientVaultBalance");
    });

    it("Should allow admin to set fee receiver and pause", async function () {
      const { vaultManager, admin, user2 } = await loadFixture(deployBankingSystemFixture);
      
      // Cover setFeeReceiver và event FeeReceiverUpdated
      await expect(vaultManager.connect(admin).setFeeReceiver(user2.address))
        .to.emit(vaultManager, "FeeReceiverUpdated")
        .withArgs(anyValue, user2.address);
        
      // Cover pause/unpause VaultManager
      await vaultManager.connect(admin).pause();
      expect(await vaultManager.paused()).to.equal(true);
      
      await vaultManager.connect(admin).unpause();
      expect(await vaultManager.paused()).to.equal(false);
    });
    
    it("Should revert if SavingCore is already set", async function () {
      const { vaultManager, admin, user2 } = await loadFixture(deployBankingSystemFixture);
      // Cover lỗi SavingCoreAlreadySet
      await expect(vaultManager.connect(admin).setSavingCore(user2.address))
        .to.be.revertedWithCustomError(vaultManager, "SavingCoreAlreadySet");
    });
  });

  describe("SavingCore Admin Functions", function () {
    it("Should fail to create plan with invalid parameters", async function () {
      const { savingCore, admin, parseUSDC } = await loadFixture(deployBankingSystemFixture);
      // Cover lỗi InvalidTenor, InvalidAPR, InvalidDepositLimits
      await expect(savingCore.connect(admin).createPlan(0, 800, 100, 1000, 500))
        .to.be.revertedWithCustomError(savingCore, "InvalidTenor");
      
      await expect(savingCore.connect(admin).createPlan(90, 0, 100, 1000, 500))
        .to.be.revertedWithCustomError(savingCore, "InvalidAPR");
        
      await expect(savingCore.connect(admin).createPlan(90, 800, parseUSDC(2000), parseUSDC(1000), 500))
        .to.be.revertedWithCustomError(savingCore, "InvalidDepositLimits");
    });

    it("Should update, enable, and disable a plan", async function () {
      const { savingCore, admin } = await loadFixture(deployBankingSystemFixture);
      
      // Cover updatePlan, disablePlan, enablePlan
      await expect(savingCore.connect(admin).updatePlan(1, 900))
        .to.emit(savingCore, "PlanUpdated")
        .withArgs(1, 900);
        
      await expect(savingCore.connect(admin).disablePlan(1))
        .to.emit(savingCore, "PlanToggled")
        .withArgs(1, false);
        
      await expect(savingCore.connect(admin).enablePlan(1))
        .to.emit(savingCore, "PlanToggled")
        .withArgs(1, true);
    });

    it("Should allow pause and unpause", async function () {
      const { savingCore, admin } = await loadFixture(deployBankingSystemFixture);
      
      // Cover pause/unpause SavingCore
      await savingCore.connect(admin).pause();
      expect(await savingCore.paused()).to.equal(true);
      
      await savingCore.connect(admin).unpause();
      expect(await savingCore.paused()).to.equal(false);
    });
  });

  describe("SavingCore Manual Renew & Errors", function () {
    it("Should manually renew a deposit", async function () {
      const { token, savingCore, user1, parseUSDC } = await loadFixture(deployBankingSystemFixture);
      const depositAmount = parseUSDC(1000);
      const planId = 1;

      await token.connect(user1).approve(await savingCore.getAddress(), depositAmount);
      await savingCore.connect(user1).openDeposit(planId, depositAmount);

      await time.increase(90 * 24 * 60 * 60);

      const expectedInterest = await savingCore.calculateInterest(1);
      const expectedNewPrincipal = depositAmount + expectedInterest;

      // Cover tính năng renewDeposit thủ công
      await expect(savingCore.connect(user1).renewDeposit(1, planId))
        .to.emit(savingCore, "Renewed")
        .withArgs(1, 2, expectedNewPrincipal, planId);
    });

    it("Should revert on invalid openDeposit and withdraw actions", async function () {
      const { token, savingCore, admin, user1, user2, parseUSDC } = await loadFixture(deployBankingSystemFixture);
      
      // Cover lỗi BelowMinDeposit
      await token.connect(user1).approve(await savingCore.getAddress(), parseUSDC(10));
      await expect(savingCore.connect(user1).openDeposit(1, parseUSDC(10)))
        .to.be.revertedWithCustomError(savingCore, "BelowMinDeposit");

      // Cover lỗi AboveMaxDeposit (ở hàm openDeposit)
      await token.connect(user1).approve(await savingCore.getAddress(), parseUSDC(20000));
      await expect(savingCore.connect(user1).openDeposit(1, parseUSDC(20000)))
        .to.be.revertedWithCustomError(savingCore, "AboveMaxDeposit");

      // Cover lỗi ZeroAmount
      await expect(savingCore.connect(user1).openDeposit(1, 0))
        .to.be.revertedWithCustomError(savingCore, "ZeroAmount");

      // Khởi tạo khoản gửi
      const depositAmount = parseUSDC(1000);
      await token.connect(user1).approve(await savingCore.getAddress(), depositAmount);
      await savingCore.connect(user1).openDeposit(1, depositAmount);

      // Cover lỗi NotDepositOwner
      await expect(savingCore.connect(user2).withdrawAtMaturity(1))
        .to.be.revertedWithCustomError(savingCore, "NotDepositOwner");

      // Cover lỗi DepositNotMature
      await expect(savingCore.connect(user1).withdrawAtMaturity(1))
        .to.be.revertedWithCustomError(savingCore, "DepositNotMature");
        
      // Cover lỗi DepositAlreadyMature (khi gọi earlyWithdraw sau khi đã đáo hạn)
      await time.increase(90 * 24 * 60 * 60 + 1);
      await expect(savingCore.connect(user1).earlyWithdraw(1))
        .to.be.revertedWithCustomError(savingCore, "DepositAlreadyMature");
    });
    
    it("Should revert autoRenew if grace period not elapsed", async function () {
      const { token, savingCore, user1, parseUSDC } = await loadFixture(deployBankingSystemFixture);
      const depositAmount = parseUSDC(1000);

      await token.connect(user1).approve(await savingCore.getAddress(), depositAmount);
      await savingCore.connect(user1).openDeposit(1, depositAmount);

      // Nhảy thời gian đến đúng ngày đáo hạn, CHƯA VƯỢT QUA 3 ngày ân hạn (grace period)
      await time.increase(90 * 24 * 60 * 60);

      // Cover lỗi GracePeriodNotElapsed
      await expect(savingCore.connect(user1).autoRenewDeposit(1))
        .to.be.revertedWithCustomError(savingCore, "GracePeriodNotElapsed");
    });
  });
});
