const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners(); // Account #0 = Admin/Owner

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║       🏦 ONLINE BANKING SYSTEM — DEPLOY SCRIPT       ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`\n📌 Deployer  : ${deployer.address}`);
  console.log(`💰 Balance   : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  // ─── 1. Deploy MockUSDC ───────────────────────────────────────
  console.log("⏳ [1/3] Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC", deployer);
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();
  const mockUSDCAddress = await mockUSDC.getAddress();
  console.log(`   ✅ MockUSDC deployed!`);
  console.log(`   📍 Address : ${mockUSDCAddress}\n`);

  // ─── 2. Deploy VaultManager ──────────────────────────────────
  console.log("⏳ [2/3] Deploying VaultManager...");
  const VaultManager = await ethers.getContractFactory("VaultManager", deployer);
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
  const SavingCore = await ethers.getContractFactory("SavingCore", deployer);
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

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║               ✅ DEPLOY HOÀN TẤT!                    ║");
  console.log("╠══════════════════════════════════════════════════════╣");
  console.log(`║  MockUSDC     : ${mockUSDCAddress}  ║`);
  console.log(`║  VaultManager : ${vaultManagerAddress}  ║`);
  console.log(`║  SavingCore   : ${savingCoreAddress}  ║`);
  console.log("╚══════════════════════════════════════════════════════╝");

  // ─── 6. Tự động cập nhật frontend/app.js ─────────────────────
  const fs   = require("fs");
  const path = require("path");

  const appJsPath = path.join(__dirname, "../frontend/app.js");
  let appJs = fs.readFileSync(appJsPath, "utf8");
  appJs = appJs.replace(
    /const ADDRESSES = \{[\s\S]*?\};/,
    `const ADDRESSES = {\n  usdc:    "${mockUSDCAddress}",\n  vault:   "${vaultManagerAddress}",\n  core:    "${savingCoreAddress}",\n};`
  );
  fs.writeFileSync(appJsPath, appJs);

  // ─── Cập nhật địa chỉ trong index.html ───────────────────────
  const htmlPath = path.join(__dirname, "../frontend/index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  html = html
    .replace(/onclick="copy\('[^']+'\)"[^>]*>Copy<\/button><\/div>\s*<div class="contract-item">🔐 VaultManager/,
      `onclick="copy('${mockUSDCAddress}')">Copy</button></div>\n  <div class="contract-item">🔐 VaultManager`)
    .replace(/copy\('0x[0-9a-fA-F]+'\)">Copy<\/button><\/div>\s*<div class="contract-item">📄 SavingCore/,
      `copy('${vaultManagerAddress}')">Copy</button></div>\n  <div class="contract-item">📄 SavingCore`);
  // Simpler approach: write addresses.json that HTML can load
  const addrJson = { usdc: mockUSDCAddress, vault: vaultManagerAddress, core: savingCoreAddress };
  fs.writeFileSync(path.join(__dirname, "../frontend/addresses.json"), JSON.stringify(addrJson, null, 2));

  console.log("\n✅ Đã tự động cập nhật frontend/app.js!");
  console.log("✅ Đã tạo frontend/addresses.json!\n");
}

main().catch((error) => {
  console.error("❌ Deploy thất bại:", error);
  process.exitCode = 1;
});
