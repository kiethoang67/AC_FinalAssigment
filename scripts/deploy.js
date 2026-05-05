const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║       🏦 ONLINE BANKING SYSTEM — DEPLOY SCRIPT       ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\n📌 Deployer  : ${deployer.address}`);
  console.log(`💰 Balance   : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  // ─── 1. Deploy MockUSDC ───────────────────────────────────────
  console.log("⏳ [1/3] Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();
  const mockUSDCAddress = await mockUSDC.getAddress();
  console.log(`   ✅ MockUSDC deployed!`);
  console.log(`   📍 Address : ${mockUSDCAddress}\n`);

  // ─── 2. Deploy VaultManager ──────────────────────────────────
  console.log("⏳ [2/3] Deploying VaultManager...");
  const VaultManager = await ethers.getContractFactory("VaultManager");
  const vaultManager = await VaultManager.deploy(
    mockUSDCAddress,   // _token
    deployer.address   // _feeReceiver (admin nhận phí phạt rút sớm)
  );
  await vaultManager.waitForDeployment();
  const vaultManagerAddress = await vaultManager.getAddress();
  console.log(`   ✅ VaultManager deployed!`);
  console.log(`   📍 Address : ${vaultManagerAddress}\n`);

  // ─── 3. Deploy SavingCore ────────────────────────────────────
  console.log("⏳ [3/3] Deploying SavingCore...");
  const SavingCore = await ethers.getContractFactory("SavingCore");
  const savingCore = await SavingCore.deploy(
    mockUSDCAddress,    // _token
    vaultManagerAddress // _vaultManager
  );
  await savingCore.waitForDeployment();
  const savingCoreAddress = await savingCore.getAddress();
  console.log(`   ✅ SavingCore deployed!`);
  console.log(`   📍 Address : ${savingCoreAddress}\n`);

  // ─── 4. Liên kết SavingCore với VaultManager ─────────────────
  console.log("🔗 Linking SavingCore → VaultManager...");
  await vaultManager.setSavingCore(savingCoreAddress);
  console.log("   ✅ setSavingCore() called successfully!\n");

  // ─── 5. Tổng kết ─────────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║               ✅ DEPLOY HOÀN TẤT!                    ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║  MockUSDC     : ${mockUSDCAddress}  ║`);
  console.log(`║  VaultManager : ${vaultManagerAddress}  ║`);
  console.log(`║  SavingCore   : ${savingCoreAddress}  ║`);
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("\n📋 Copy các địa chỉ trên và cung cấp cho đội Frontend!\n");
}

main().catch((error) => {
  console.error("❌ Deploy thất bại:", error);
  process.exitCode = 1;
});
