const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const readline = require("readline");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const askQuestion = (query) => new Promise(resolve => rl.question(query, resolve));
const pressEnter = (msg) => askQuestion(`\n${msg || "Nhấn Enter để tiếp tục..."}`);
const separator = (title) => {
  console.log("\n======================================================");
  console.log(`  ${title}`);
  console.log("======================================================\n");
};

async function main() {
  separator("🏦 ONLINE BANKING SYSTEM - KỊCH BẢN DEMO TƯƠNG TÁC 🏦");

  const [admin, feeReceiver, user1, user2] = await ethers.getSigners();
  const parseUSDC = (amount) => ethers.parseUnits(amount.toString(), 6);
  const formatUSDC = (amount) => ethers.formatUnits(amount, 6);

  // ══════════════════════════════════════
  //  BƯỚC 0: DEPLOY HỆ THỐNG
  // ══════════════════════════════════════
  separator("BƯỚC 0: DEPLOY HỆ THỐNG");

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const token = await MockUSDC.deploy();
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();

  const VaultManager = await ethers.getContractFactory("VaultManager");
  const vault = await VaultManager.deploy(tokenAddr, feeReceiver.address);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();

  const SavingCore = await ethers.getContractFactory("SavingCore");
  const core = await SavingCore.deploy(tokenAddr, vaultAddr);
  await core.waitForDeployment();
  const coreAddr = await core.getAddress();

  await vault.setSavingCore(coreAddr);

  console.log(`   ✅ MockUSDC (6 decimals) : ${tokenAddr}`);
  console.log(`   ✅ VaultManager          : ${vaultAddr}`);
  console.log(`   ✅ SavingCore (ERC-721)  : ${coreAddr}`);
  console.log(`\n   📌 THIẾT KẾ: Mỗi Sổ Tiết Kiệm là một NFT (tokenId = depositId)`);
  console.log(`   📌 Tiền gốc: giữ ở SavingCore | Tiền lãi: trả từ VaultManager`);

  // ══════════════════════════════════════
  //  BƯỚC 1: ADMIN TẠO GÓI TIẾT KIỆM
  // ══════════════════════════════════════
  separator("BƯỚC 1: ADMIN TẠO GÓI TIẾT KIỆM (createPlan)");
  console.log("   ℹ️  Admin có thể tạo nhiều Gói tiết kiệm với các thông số khác nhau.\n");

  const tenorInput = await askQuestion("Nhập số ngày kỳ hạn (mặc định 90): ");
  const tenor = tenorInput ? parseInt(tenorInput) : 90;

  const aprInput = await askQuestion("Nhập Lãi suất năm - APR % (mặc định 8): ");
  const apr = aprInput ? parseInt(aprInput) * 100 : 800;

  await core.createPlan(tenor, apr, parseUSDC(100), parseUSDC(10000), 500);
  console.log(`\n   ✅ Gói #1 tạo thành công:`);
  console.log(`      Kỳ hạn  : ${tenor} ngày`);
  console.log(`      Lãi suất: ${apr / 100}%/năm (${apr} bps)`);
  console.log(`      Gửi tối thiểu: 100 USDC | Gửi tối đa: 10,000 USDC`);
  console.log(`      Phí phạt rút sớm: 5%`);

  // ══════════════════════════════════════
  //  BƯỚC 2: CẤP VỐN VÀ XEM SỐ DƯ
  // ══════════════════════════════════════
  separator("BƯỚC 2: CẤP VỐN (USDC) CHO HỆ THỐNG");

  await token.mint(admin.address, parseUSDC(10000));
  await token.connect(admin).approve(vaultAddr, parseUSDC(10000));
  await vault.fundVault(parseUSDC(10000));

  console.log(`   👤 User1 ban đầu   : 0 USDC (sẽ được mint đúng số tiền gửi)`);
  console.log(`   👤 User2 ban đầu   : 0 USDC (sẽ được mint đúng số tiền gửi)`);
  console.log(`   🏦 Két (Vault)     : ${formatUSDC(await vault.vaultBalance())} USDC (vốn của Ngân hàng để trả lãi)`);

  // ══════════════════════════════════════
  //  KỊCH BẢN 1: GỬI TIỀN ĐÚNG HẠN
  // ══════════════════════════════════════
  separator("KỊCH BẢN 1: GỬI TIỀN VÀ RÚT ĐÚNG HẠN (Happy Path)");
  console.log("   📋 Luồng: openDeposit → (chờ đáo hạn) → withdrawAtMaturity\n");

  const dep1Input = await askQuestion("👤 User1: Gửi bao nhiêu USDC? (mặc định 1000): ");
  const dep1Str = dep1Input || "1000";
  const dep1Amt = parseUSDC(dep1Str);

  // Mint đúng số tiền User1 muốn gửi → số dư ban đầu = số tiền gửi
  await token.mint(user1.address, dep1Amt);
  console.log(`\n   📊 Số dư User1 TRƯỚC khi gửi: ${formatUSDC(dep1Amt)} USDC`);
  await token.connect(user1).approve(coreAddr, dep1Amt);
  await core.connect(user1).openDeposit(1, dep1Amt);
  console.log(`   ✅ User1 gửi ${dep1Str} USDC → Nhận NFT Sổ Tiết Kiệm #1`);
  console.log(`   📊 Số dư User1 SAU khi gửi: ${dep1Str} - ${dep1Str} = 0 USDC (toàn bộ đã gửi vào sổ)`);

  await pressEnter(`⏩ Nhấn Enter để tua nhanh ${tenor} ngày (đáo hạn)...`);
  await time.increase(tenor * 24 * 60 * 60);

  const int1 = await core.calculateInterest(1);
  console.log(`   💰 Lãi tích lũy: ${formatUSDC(int1)} USDC`);

  await pressEnter("Nhấn Enter để rút tiền đúng hạn (withdrawAtMaturity)...");
  const bal1Before = await token.balanceOf(user1.address);
  await core.connect(user1).withdrawAtMaturity(1);
  const bal1After = await token.balanceOf(user1.address);

  console.log(`\n   ✅ Rút đúng hạn thành công!`);
  console.log(`   💵 Nhận về: ${formatUSDC(bal1After - bal1Before)} USDC (Gốc ${dep1Str} + Lãi ${formatUSDC(int1)})`);
  console.log(`   🏦 Số dư User1 hiện tại: ${formatUSDC(bal1After)} USDC`);

  // ══════════════════════════════════════
  //  KỊCH BẢN 2: RÚT TRƯỚC HẠN (PHẠT)
  // ══════════════════════════════════════
  separator("KỊCH BẢN 2: RÚT TRƯỚC HẠN - CHỊU PHÍ PHẠT (earlyWithdraw)");
  console.log("   📋 Luồng: openDeposit → (rút sớm) → earlyWithdraw → mất 5% gốc\n");

  const dep2Input = await askQuestion("👤 User1: Gửi bao nhiêu USDC? (mặc định 1000): ");
  const dep2Str = dep2Input || "1000";
  const dep2Amt = parseUSDC(dep2Str);

  await token.mint(user1.address, dep2Amt); // Cấp đúng số tiền cần gửi cho kịch bản này
  console.log(`\n   📊 Số dư User1 TRƯỚC khi gửi: ${formatUSDC(dep2Amt)} USDC`);
  await token.connect(user1).approve(coreAddr, dep2Amt);
  await core.connect(user1).openDeposit(1, dep2Amt);
  console.log(`   ✅ User1 gửi ${dep2Str} USDC → Nhận NFT Sổ Tiết Kiệm #2`);
  console.log(`   📊 Số dư User1 SAU khi gửi: 0 USDC`);

  let earlyDays;
  while (true) {
    const earlyDaysInput = await askQuestion(`⏩ Tua nhanh bao nhiêu ngày? (phải < ${tenor} ngày để rút sớm, mặc định 30): `);
    earlyDays = earlyDaysInput ? parseInt(earlyDaysInput) : 30;
    if (earlyDays < tenor) break;
    console.log(`   ❌ Phải nhỏ hơn ${tenor} ngày! Nếu nhập >= ${tenor} thì sổ đã đáo hạn, không thể rút sớm. Nhập lại.\n`);
  }
  await time.increase(earlyDays * 24 * 60 * 60);

  const penalty = (dep2Amt * 500n) / 10000n;
  console.log(`\n   ℹ️  Phí phạt sẽ bị trừ: 5% x ${dep2Str} = ${formatUSDC(penalty)} USDC`);
  console.log(`   ℹ️  Phí phạt sẽ được gửi đến địa chỉ feeReceiver: ${feeReceiver.address}`);

  await pressEnter("Nhấn Enter để thực hiện rút sớm (earlyWithdraw)...");
  const bal2Before = await token.balanceOf(user1.address);
  const feeReceiverBefore = await token.balanceOf(feeReceiver.address);
  await core.connect(user1).earlyWithdraw(2);
  const bal2After = await token.balanceOf(user1.address);
  const feeReceiverAfter = await token.balanceOf(feeReceiver.address);

  console.log(`\n   ✅ Rút sớm thành công!`);
  console.log(`   💵 User1 nhận về: ${formatUSDC(bal2After - bal2Before)} USDC (Sau khi trừ phạt)`);
  console.log(`   🏦 feeReceiver nhận phí phạt: ${formatUSDC(feeReceiverAfter - feeReceiverBefore)} USDC`);
  console.log(`   📌 Lãi suất = 0 USDC (vì rút sớm, chưa đến hạn)`);

  // ══════════════════════════════════════
  //  KỊCH BẢN 3: BEST-EFFORT PAYOUT
  // ══════════════════════════════════════
  separator("KỊCH BẢN 3: BEST-EFFORT PAYOUT (Két cạn tiền)");
  console.log("   📋 Vấn đề cũ: Nếu Vault thiếu tiền lãi → giao dịch REVERT → giam tiền gốc!");
  console.log("   📋 Giải pháp: withdrawAtMaturity LUÔN trả đủ gốc + trả lãi theo khả năng\n");

  await token.mint(user1.address, parseUSDC(1000)); // Cấp đúng số tiền cần gửi
  console.log(`   📊 Số dư User1 TRƯỚC khi gửi: 1000.0 USDC`);
  await token.connect(user1).approve(coreAddr, parseUSDC(1000));
  await core.connect(user1).openDeposit(1, parseUSDC(1000));
  console.log("   ✅ User1 gửi 1000 USDC → Nhận NFT Sổ Tiết Kiệm #3");
  console.log(`   📊 Số dư User1 SAU khi gửi: 0 USDC`);

  await pressEnter(`⏩ Nhấn Enter để tua nhanh ${tenor} ngày (đáo hạn)...`);
  await time.increase(tenor * 24 * 60 * 60);

  const int3 = await core.calculateInterest(3);
  const int3Str = formatUSDC(int3);
  console.log(`\n   💰 Lãi User1 đáng lẽ nhận: ${int3Str} USDC`);
  console.log(`   ⚠️  Để kích hoạt Best-Effort, chừa lại DƯỚI ${int3Str} USDC trong Két!\n`);

  let leftAmount, leftAmountStr;
  while (true) {
    const drainInput = await askQuestion(`Admin chừa lại bao nhiêu USDC trong Két? (phải < ${int3Str}): `);
    leftAmountStr = drainInput || "0";
    leftAmount = parseUSDC(leftAmountStr);
    if (leftAmount < int3) break;
    console.log(`   ❌ Phải nhỏ hơn ${int3Str} USDC! Nhập lại.\n`);
  }

  const vBal = await vault.vaultBalance();
  if (vBal > leftAmount) await vault.connect(admin).withdrawVault(vBal - leftAmount);

  console.log(`\n   🏦 Két còn lại: ${formatUSDC(await vault.vaultBalance())} USDC`);
  console.log(`   💰 Lãi cần trả: ${int3Str} USDC → Két KHÔNG ĐỦ → Best-Effort sẽ kích hoạt!`);

  await pressEnter("Nhấn Enter để rút tiền (chờ xem Best-Effort Payout hoạt động)...");
  const bal3Before = await token.balanceOf(user1.address);
  await core.connect(user1).withdrawAtMaturity(3);
  const bal3After = await token.balanceOf(user1.address);

  console.log(`\n   ✅ Giao dịch THÀNH CÔNG dù Két không đủ tiền trả lãi!`);
  console.log(`   💵 User1 nhận về: ${formatUSDC(bal3After - bal3Before)} USDC`);
  console.log(`      - Gốc: 1000 USDC (100% luôn được đảm bảo)`);
  console.log(`      - Lãi: ${leftAmountStr} USDC (phần còn lại trong Két)`);
  console.log(`   📡 Hệ thống emit event PartialInterestPaid (expectedInterest=${int3Str}, actualPaid=${leftAmountStr})`);

  // ══════════════════════════════════════
  //  KỊCH BẢN 4: GIA HẠN THỦ CÔNG (renewDeposit)
  // ══════════════════════════════════════
  separator("KỊCH BẢN 4: GIA HẠN SỔ THỦ CÔNG (renewDeposit) - Gộp Lãi vào Gốc");
  console.log("   📋 Luồng: openDeposit → (đáo hạn) → renewDeposit → Gốc mới = Gốc cũ + Lãi\n");

  // Refund vault first for scenario
  await token.mint(admin.address, parseUSDC(10000));
  await token.connect(admin).approve(vaultAddr, parseUSDC(10000));
  await vault.fundVault(parseUSDC(10000));
  console.log(`   🏦 Admin đã nạp lại Két: ${formatUSDC(await vault.vaultBalance())} USDC`);

  await token.mint(user2.address, parseUSDC(1000)); // Cấp đúng số tiền cần gửi
  await token.connect(user2).approve(coreAddr, parseUSDC(1000));
  await core.connect(user2).openDeposit(1, parseUSDC(1000));
  console.log("   ✅ User2 gửi 1000 USDC → Nhận NFT Sổ Tiết Kiệm #4");

  await pressEnter(`⏩ Nhấn Enter để tua nhanh ${tenor} ngày (đáo hạn)...`);
  await time.increase(tenor * 24 * 60 * 60);

  const int4 = await core.calculateInterest(4);
  console.log(`   💰 Lãi tích lũy: ${formatUSDC(int4)} USDC`);
  console.log(`   📌 Gốc mới sẽ là: 1000 + ${formatUSDC(int4)} = ${formatUSDC(parseUSDC(1000) + int4)} USDC`);

  await pressEnter("Nhấn Enter để gia hạn sổ thủ công (renewDeposit)...");
  await core.connect(user2).renewDeposit(4, 1);

  const newDep = await core.getDeposit(5);
  console.log(`\n   ✅ Gia hạn thủ công thành công!`);
  console.log(`   📄 Sổ cũ #4 → trạng thái: ManualRenewed`);
  console.log(`   📄 Sổ mới #5 → Gốc: ${formatUSDC(newDep.principal)} USDC | APR: ${newDep.aprBpsAtOpen / 100n}%`);

  // ══════════════════════════════════════
  //  KỊCH BẢN 5: AUTO-RENEW + CẬP NHẬT LÃI SUẤT THị TRƯỜNG
  // ══════════════════════════════════════
  separator("KỊCH BẢN 5: AUTO-RENEW + CẬP NHẬT LÃI SUẤT THị TRƯỜNG");
  console.log("   📋 Vấn đề cũ: Auto-renew dùng APR cũ (snapshot) → không phản ánh thị trường");
  console.log("   📋 Giải pháp: autoRenewDeposit lấy APR HIỆN TẠI của Gói, không dùng snapshot\n");

  await token.mint(user1.address, parseUSDC(1000)); // Cấp đúng số tiền cần gửi
  await token.connect(user1).approve(coreAddr, parseUSDC(1000));
  await core.connect(user1).openDeposit(1, parseUSDC(1000));
  console.log(`   ✅ User1 gửi 1000 USDC → Sổ #6 | APR snapshot lúc mở: ${apr / 100}%`);

  const newAprInput = await askQuestion(`\nAdmin cập nhật APR Gói #1 thành bao nhiêu %? (mặc định 12): `);
  const newAprPct = newAprInput ? parseInt(newAprInput) : 12;
  const newAprBps = newAprPct * 100;
  await core.connect(admin).updatePlan(1, newAprBps);
  console.log(`   ✅ Admin đã updatePlan: APR Gói #1 = ${newAprPct}% (${newAprBps} bps)`);

  await pressEnter(`⏩ Nhấn Enter để tua nhanh ${tenor} ngày + 3 ngày ân hạn + 1 giây...`);
  await time.increase(tenor * 24 * 60 * 60 + 3 * 24 * 60 * 60 + 1);

  console.log(`   ℹ️  Lãi tính theo APR cũ (${apr / 100}%): ${formatUSDC(await core.calculateInterest(6))} USDC`);
  await pressEnter("Nhấn Enter để bot gọi autoRenewDeposit...");
  await core.connect(user1).autoRenewDeposit(6);

  const newDep2 = await core.getDeposit(7);
  console.log(`\n   ✅ Auto-Renew thành công!`);
  console.log(`   📄 Sổ cũ #6 → trạng thái: AutoRenewed`);
  console.log(`   📄 Sổ mới #7 → Gốc: ${formatUSDC(newDep2.principal)} USDC`);
  console.log(`   📌 APR áp dụng cho Sổ mới: ${newDep2.aprBpsAtOpen / 100n}% (APR HIỆN TẠI, không phải ${apr / 100}% cũ!)`);

  // ══════════════════════════════════════
  //  KỊCH BẢN 6: BẢO VỆ GIỚI HẠN Gửa TỐI ĐA (MAX DEPOSIT GUARD)
  // ══════════════════════════════════════
  separator("KỊCH BẢN 6: BẢO VỆ GIỚI HẠN Gửa TỐI ĐA (Max Deposit Guard)");
  console.log("   📋 Vấn đề: Sau khi gộp lãi, gốc mới có thể vượt maxDeposit → cần chặn");
  console.log("   📋 Giải pháp: autoRenewDeposit revert với AboveMaxDeposit nếu vượt ngưỡng\n");

  // Create a strict plan with maxDeposit = 1000 (exactly at current principal)
  await core.connect(admin).createPlan(tenor, 800, parseUSDC(100), parseUSDC(1000), 500);
  console.log("   ✅ Admin tạo Gói #2: maxDeposit = 1000 USDC (rất chặt)");

  await token.mint(user2.address, parseUSDC(1000)); // Cấp đúng số tiền cần gửi
  await token.connect(user2).approve(coreAddr, parseUSDC(1000));
  await core.connect(user2).openDeposit(2, parseUSDC(1000));
  console.log("   ✅ User2 gửi 1000 USDC vào Gói #2 (đúng bằng maxDeposit) → Sổ #8");
  console.log("   ⚠️  Sau khi cộng lãi: ~1019 USDC > 1000 USDC (maxDeposit) → sẽ bị chặn!");

  await pressEnter(`⏩ Nhấn Enter để tua nhanh ${tenor} ngày + 3 ngày ân hạn + 1 giây...`);
  await time.increase(tenor * 24 * 60 * 60 + 3 * 24 * 60 * 60 + 1);

  await pressEnter("Nhấn Enter để gọi autoRenewDeposit (dự kiến sẽ bị REVERT)...");
  try {
    await core.connect(user2).autoRenewDeposit(8);
    console.log(`   ❌ Không bị revert? Có lỗi logic trong contract!`);
  } catch (error) {
    console.log(`\n   ✅ REVERT đúng như thiết kế!`);
    console.log(`   💬 Lỗi: AboveMaxDeposit - Gốc mới vượt quá maxDeposit (1000 USDC)`);
    console.log(`   📌 User vẫn giữ nguyên Sổ #8, có thể rút thủ công hoặc gia hạn sang Gói khác`);
  }

  // ══════════════════════════════════════
  //  TỔNG KẾT
  // ══════════════════════════════════════
  separator("🎉 TỔNG KẾT DEMO");
  console.log("  Kịch bản 1: openDeposit → withdrawAtMaturity          ✅ Gốc + Lãi đầy đủ");
  console.log("  Kịch bản 2: openDeposit → earlyWithdraw               ✅ Phạt 5%, không lãi");
  console.log("  Kịch bản 3: Best-Effort Payout                        ✅ Két cạn → vẫn rút được");
  console.log("  Kịch bản 4: openDeposit → renewDeposit (thủ công)      ✅ Gốc mới = Gốc + Lãi");
  console.log("  Kịch bản 5: Auto-Renew cập nhật lãi suất thị trường  ✅ APR hiện tại, không dùng snapshot");
  console.log("  Kịch bản 6: Bảo vệ giới hạn gửa tối đa               ✅ Revert nếu vượt maxDeposit\n");

  rl.close();
}

main().catch((error) => {
  console.error(error);
  rl.close();
  process.exitCode = 1;
});
