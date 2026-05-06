// ─── CONFIG ──────────────────────────────────────────────────
const ADDRESSES = {
  usdc:    "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  vault:   "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  core:    "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
};

const ABI_USDC = [
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

const ABI_VAULT = [
  "function vaultBalance() external view returns (uint256)",
  "function fundVault(uint256 amount) external",
  "function withdrawVault(address to, uint256 amount) external",
];

const ABI_CORE = [
  "function owner() external view returns (address)",
  "function paused() external view returns (bool)",
  "function pause() external",
  "function unpause() external",
  "function nextPlanId() external view returns (uint256)",
  "function nextDepositId() external view returns (uint256)",
  "function getPlan(uint256 planId) external view returns (tuple(uint256 tenorDays,uint256 aprBps,uint256 minDeposit,uint256 maxDeposit,uint256 earlyWithdrawPenaltyBps,bool enabled))",
  "function getDeposit(uint256 depositId) external view returns (tuple(uint256 planId,uint256 principal,uint256 startAt,uint256 maturityAt,uint256 aprBpsAtOpen,uint256 penaltyBpsAtOpen,uint256 tenorDays,uint8 status))",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function calculateInterest(uint256 depositId) external view returns (uint256)",
  "function createPlan(uint256 tenorDays,uint256 aprBps,uint256 minDeposit,uint256 maxDeposit,uint256 earlyWithdrawPenaltyBps) external returns (uint256)",
  "function updatePlan(uint256 planId,uint256 newAprBps) external",
  "function openDeposit(uint256 planId,uint256 amount) external returns (uint256)",
  "function withdrawAtMaturity(uint256 depositId) external",
  "function earlyWithdraw(uint256 depositId) external",
  "function renewDeposit(uint256 depositId,uint256 newPlanId) external returns (uint256)",
  "function autoRenewDeposit(uint256 depositId) external returns (uint256)",
  "function userDebt(address user) external view returns (uint256)",
  "function claimDebt() external",
];

// ─── STATE ────────────────────────────────────────────────────
let provider, signer, userAddr;
let usdcContract, vaultContract, coreContract;
const USDC = (n) => ethers.parseUnits(String(n), 6);
const fmtUSDC = (n) => parseFloat(ethers.formatUnits(n, 6)).toLocaleString("vi-VN", {maximumFractionDigits: 4});
const fmtDate = (ts) => new Date(Number(ts) * 1000).toLocaleDateString("vi-VN", {day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
const STATUS = ["Active","Withdrawn","ManualRenewed","AutoRenewed"];

// ─── MODAL ────────────────────────────────────────────────────
function openConnectModal() { document.getElementById("connectModal").style.display = "flex"; }
function closeModal() { document.getElementById("connectModal").style.display = "none"; }
function fillPK() {
  const v = document.getElementById("presetAccount").value;
  if (v) document.getElementById("pkInput").value = v;
}

async function connectWithPK() {
  const pk = document.getElementById("pkInput").value.trim();
  if (!pk) return toast("Enter Private Key!", "error");
  try {
    provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const wallet = new ethers.Wallet(pk, provider);
    signer   = wallet;
    userAddr = wallet.address;

    usdcContract  = new ethers.Contract(ADDRESSES.usdc,  ABI_USDC,  signer);
    vaultContract = new ethers.Contract(ADDRESSES.vault, ABI_VAULT, signer);
    coreContract  = new ethers.Contract(ADDRESSES.core,  ABI_CORE,  signer);

    const btn = document.getElementById("walletBtn");
    btn.textContent = userAddr.slice(0,6) + "..." + userAddr.slice(-4);
    btn.classList.add("connected");
    document.getElementById("networkBadge").classList.remove("hidden");
    closeModal();

    await refreshStats();
    await loadPlans();
    await checkAdmin();
    toast("Connected successfully! Address: " + userAddr.slice(0,10) + "...", "success");
  } catch(e) { toast("Error: " + e.message, "error"); }
}

// ─── WALLET ───────────────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) return toast("Please install MetaMask! (Make sure you are not opening the file directly via file://. Use a local server!)", "error");
  try {
    // Bước 1: Yêu cầu kết nối tài khoản
    await window.ethereum.request({ method: "eth_requestAccounts" });

    // Bước 2: Ép buộc MetaMask chuyển sang mạng Localhost (chainId 31337 = 0x7a69)
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (chainId !== "0x7a69") {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x7a69" }], // 0x7a69 = 31337 (Hardhat Localhost)
        });
      } catch (switchErr) {
        // Nếu người dùng chưa thêm mạng Localhost, yêu cầu thêm vào
        if (switchErr.code === 4902) {
          try {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: "0x7a69",
                  chainName: "Hardhat Localhost",
                  rpcUrls: ["http://127.0.0.1:8545"],
                  nativeCurrency: { name: "GO", symbol: "GO", decimals: 18 },
                },
              ],
            });
          } catch (addError) {
            return toast("Không thể tự động thêm mạng Localhost!", "error");
          }
        } else {
          return toast("Vui lòng tự chuyển sang mạng Localhost trên MetaMask!", "error");
        }
      }
    }

    // Bước 3: Khởi tạo provider và signer
    provider = new ethers.BrowserProvider(window.ethereum);
    signer   = await provider.getSigner();
    userAddr = await signer.getAddress();

    usdcContract  = new ethers.Contract(ADDRESSES.usdc,  ABI_USDC,  signer);
    vaultContract = new ethers.Contract(ADDRESSES.vault, ABI_VAULT, signer);
    coreContract  = new ethers.Contract(ADDRESSES.core,  ABI_CORE,  signer);

    const btn = document.getElementById("walletBtn");
    btn.textContent = userAddr.slice(0,6) + "..." + userAddr.slice(-4);
    btn.classList.add("connected");
    document.getElementById("networkBadge").classList.remove("hidden");
    closeModal();

    await refreshStats();
    await loadPlans();
    await checkAdmin();
    toast("MetaMask connected successfully!", "success");

    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged",    () => location.reload());
  } catch(e) {
    toast("Connection error: " + (e.message || e), "error");
  }
}

// ─── STATS ────────────────────────────────────────────────────
async function refreshStats() {
  try {
    const [bal, vault, nextPlan, nextDep, debt] = await Promise.all([
      usdcContract.balanceOf(userAddr),
      vaultContract.vaultBalance(),
      coreContract.nextPlanId(),
      coreContract.nextDepositId(),
      coreContract.userDebt(userAddr)
    ]);
    document.getElementById("myBalance").textContent = fmtUSDC(bal) + " USDC";
    document.getElementById("vaultBal").textContent  = fmtUSDC(vault) + " USDC";
    document.getElementById("totalPlans").textContent = Number(nextPlan) - 1;
    document.getElementById("myDeposits").textContent = "—";
    
    if (document.getElementById("myDebt")) {
      document.getElementById("myDebt").innerHTML = `${fmtUSDC(debt)} USDC`;
      const claimBtn = document.getElementById("claimDebtBtn");
      if (claimBtn) {
        if (debt > 0n && vault > 0n) {
           claimBtn.classList.remove("hidden");
        } else {
           claimBtn.classList.add("hidden");
        }
      }
    }
  } catch(e) { console.error(e); }
}

// ─── CHECK ADMIN & APPLY ROLE UI ─────────────────────────────
async function checkAdmin() {
  try {
    const owner = await coreContract.owner();
    const isAdmin = owner.toLowerCase() === userAddr.toLowerCase();

    // DEBUG - xóa sau khi fix
    console.log("🔍 owner()   :", owner);
    console.log("🔍 userAddr  :", userAddr);
    console.log("🔍 isAdmin   :", isAdmin);
    toast(`Owner: ${owner.slice(0,8)}... | You: ${userAddr.slice(0,8)}... | Admin: ${isAdmin}`, isAdmin ? "success" : "error");

    if (isAdmin) {
      // ADMIN: show admin tab, hide deposit panel & sổ tab
      document.getElementById("adminTabBtn").classList.remove("hidden");
      document.getElementById("depositsTabBtn").classList.add("hidden");
      document.getElementById("openDepositPanel").classList.add("hidden");
      document.getElementById("adminGuard").classList.add("hidden");
      document.getElementById("adminContent").classList.remove("hidden");
      document.getElementById("ownerAddr").textContent = userAddr;
      await refreshPauseStatus();
    } else {
      // USER: hide admin tab, show deposit panel & sổ tab
      document.getElementById("adminTabBtn").classList.add("hidden");
      document.getElementById("depositsTabBtn").classList.remove("hidden");
      document.getElementById("openDepositPanel").classList.remove("hidden");
    }
  } catch(e) { console.error(e); }
}

// ─── PLANS ────────────────────────────────────────────────────
async function loadPlans() {
  if (!coreContract) return;
  const container = document.getElementById("plansList");
  container.innerHTML = '<div class="empty"><div>⏳ Loading...</div></div>';
  try {
    const nextId = Number(await coreContract.nextPlanId());
    if (nextId <= 1) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div>No plans available. Admin should create a new plan!</div></div>';
      return;
    }
    let html = "";
    for (let i = 1; i < nextId; i++) {
      const p = await coreContract.getPlan(i);
      html += `<div class="plan-card" onclick="selectPlan(${i})">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div><div style="font-size:12px;color:var(--muted)">PLAN #${i}</div><div style="font-weight:700;font-size:16px">${p.tenorDays} Days</div></div>
          <span class="badge ${p.enabled ? 'badge-green' : 'badge-red'}">${p.enabled ? "Active" : "Disabled"}</span>
        </div>
        <div class="plan-apr">${(Number(p.aprBps)/100).toFixed(2)}%</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">Interest/Year</div>
        <hr style="margin:12px 0">
        <div style="font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div><span style="color:var(--muted)">Min:</span> ${fmtUSDC(p.minDeposit)} USDC</div>
          <div><span style="color:var(--muted)">Max:</span> ${fmtUSDC(p.maxDeposit)} USDC</div>
          <div><span style="color:var(--muted)">Early Penalty:</span> ${Number(p.earlyWithdrawPenaltyBps)/100}%</div>
        </div>
        <div style="margin-top:14px"><button class="btn btn-primary btn-sm" style="width:100%" onclick="event.stopPropagation();selectPlan(${i})">Deposit to this plan</button></div>
      </div>`;
    }
    container.innerHTML = html;
  } catch(e) { container.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div>' + e.message + '</div></div>'; }
}

function selectPlan(id) {
  document.getElementById("openPlanId").value = id;
  document.getElementById("openAmount").focus();
}

// ─── GET CHAIN TIMESTAMP ─────────────────────────────────────
async function getChainTimestamp() {
  try {
    const res = await hardhatRpc("eth_getBlockByNumber", ["latest", false]);
    return parseInt(res.result.timestamp, 16);
  } catch {
    return Math.floor(Date.now() / 1000); // fallback về giờ máy
  }
}

// ─── DEPOSITS ───────────────────────────────────────────────────────
async function loadDeposits() {
  if (!coreContract) return toast("Connect wallet first!", "error");
  const container = document.getElementById("depositsList");
  container.innerHTML = '<div class="empty"><div>⏳ Loading...</div></div>';
  try {
    const nextId = Number(await coreContract.nextDepositId());
    const items = [];
    for (let i = 1; i < nextId; i++) {
      try {
        const owner = await coreContract.ownerOf(i);
        if (owner.toLowerCase() !== userAddr.toLowerCase()) continue;
        const d = await coreContract.getDeposit(i);
        const interest = await coreContract.calculateInterest(i);
        items.push({ id: i, d, interest });
      } catch {}
    }
    document.getElementById("myDeposits").textContent = items.length;
    if (!items.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">📂</div><div>You don\'t have any deposits</div></div>';
      return;
    }
    const now = await getChainTimestamp(); // dùng giờ blockchain sau khi tua
    container.innerHTML = '<div class="grid">' + items.map(({ id, d, interest }) => {
      const isMature = now >= Number(d.maturityAt);
      const status = STATUS[d.status];
      const isActive = d.status === 0n;
      const pct = Math.min(100, Math.max(0, ((now - Number(d.startAt)) / (Number(d.maturityAt) - Number(d.startAt))) * 100));
      return `<div class="dep-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div style="font-weight:700;font-size:16px">Deposit #${id}</div>
          <span class="badge ${isActive ? (isMature ? 'badge-blue' : 'badge-green') : 'badge-grey'}">${isActive ? (isMature ? "Matured" : "Active") : status}</span>
        </div>
        <div class="dep-row"><span class="key">Principal</span><span style="font-weight:600">${fmtUSDC(d.principal)} USDC</span></div>
        <div class="dep-row"><span class="key">Interest Rate</span><span>${(Number(d.aprBpsAtOpen)/100).toFixed(2)}%/year</span></div>
        <div class="dep-row"><span class="key">Est. Interest</span><span style="color:var(--teal)">${fmtUSDC(interest)} USDC</span></div>
        <div class="dep-row"><span class="key">Opened</span><span>${fmtDate(d.startAt)}</span></div>
        <div class="dep-row"><span class="key">Maturity</span><span>${fmtDate(d.maturityAt)}</span></div>
        ${isActive ? `<div class="progress"><div class="progress-bar" style="width:${pct.toFixed(1)}%"></div></div><div style="font-size:11px;color:var(--muted);margin-top:4px;text-align:right">${pct.toFixed(0)}% time elapsed</div>` : ""}
        ${isActive ? `<div class="dep-actions">
          ${isMature ? `<button class="btn btn-primary btn-sm" onclick="withdrawMature(${id})">✅ Withdraw</button>
          <button class="btn btn-outline btn-sm" onclick="renewSamePlan(${id})">🔄 Renew</button>` :
          `<button class="btn btn-danger btn-sm" onclick="earlyWithdraw(${id})">⚡ Early Withdraw (Penalty ${Number(d.penaltyBpsAtOpen)/100}%)</button>`}
        </div>` : ""}
      </div>`;
    }).join("") + "</div>";
  } catch(e) { container.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div>' + e.message + '</div></div>'; }
}

// ─── ACTIONS ──────────────────────────────────────────────────
async function mintForAdmin() {
  const amount = document.getElementById("mintAdminAmount").value || "100000";
  try {
    toast(`Minting ${amount} USDC for Admin...`);
    const tx = await usdcContract.mint(userAddr, USDC(amount));
    await tx.wait();
    await refreshStats();
    toast(`Minted ${amount} USDC successfully! Now click "Fund Vault".`, "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function mintUSDC() {
  if (!signer) return toast("Connect wallet first!", "error");
  try {
    toast("Minting 10,000 USDC...");
    const tx = await usdcContract.mint(userAddr, USDC(10000));
    await tx.wait();
    await refreshStats();
    toast("Minted 10,000 USDC successfully!", "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function openDeposit() {
  if (!signer) return toast("Connect wallet first!", "error");
  const planId = document.getElementById("openPlanId").value;
  const amount = document.getElementById("openAmount").value;
  if (!planId || !amount) return toast("Please fill all fields!", "error");
  try {
    toast("Approving USDC...");
    const approveTx = await usdcContract.approve(ADDRESSES.core, USDC(amount));
    await approveTx.wait();
    toast("Opening deposit...");
    const tx = await coreContract.openDeposit(planId, USDC(amount));
    await tx.wait();
    await refreshStats();
    toast("Deposit opened! Check 'My Deposits' tab.", "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function withdrawMature(id) {
  try {
    const interest = await coreContract.calculateInterest(id);
    const vaultBal = await vaultContract.vaultBalance();
    const debt = await coreContract.userDebt(userAddr);
    const totalOwed = interest + debt;
    
    if (totalOwed > 0 && vaultBal < totalOwed) {
      const proceed = confirm("Vault is insufficient to pay full interest. Do you still want to withdraw? Unpaid interest will be saved as debt and paid next time.");
      if (!proceed) return;
    }

    toast("Withdrawing...");
    const tx = await coreContract.withdrawAtMaturity(id);
    await tx.wait();
    await refreshStats();
    await loadDeposits();
    toast("Withdrawal successful!", "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function claimDebt() {
  try {
    toast("Claiming debt...");
    const tx = await coreContract.claimDebt();
    await tx.wait();
    await refreshStats();
    toast("Debt claimed successfully!", "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function earlyWithdraw(id) {
  if (!confirm("You will be penalized for early withdrawal. Confirm?")) return;
  try {
    toast("Withdrawing early...");
    const tx = await coreContract.earlyWithdraw(id);
    await tx.wait();
    await refreshStats();
    await loadDeposits();
    toast("Early withdrawal successful!", "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function renewSamePlan(id) {
  try {
    toast("Fetching previous plan info...");
    const dep = await coreContract.getDeposit(id);
    const oldPlanId = dep.planId;
    
    toast(`Renewing deposit to Plan #${oldPlanId}...`);
    const tx = await coreContract.renewDeposit(id, oldPlanId);
    await tx.wait();
    await loadDeposits();
    toast("Renewal successful!", "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function fundVault() {
  const amount = document.getElementById("fundAmount").value;
  if (!amount) return toast("Enter amount!", "error");
  try {
    toast("Approving USDC...");
    const approveTx = await usdcContract.approve(ADDRESSES.vault, USDC(amount));
    await approveTx.wait();
    toast("Funding vault...");
    const tx = await vaultContract.fundVault(USDC(amount));
    await tx.wait();
    await refreshStats();
    toast(`Funded ${amount} USDC to Vault!`, "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function createPlan() {
  const tenor   = document.getElementById("pTenor").value;
  const apr     = document.getElementById("pApr").value;
  const min     = document.getElementById("pMin").value;
  const max     = document.getElementById("pMax").value;
  const penalty = document.getElementById("pPenalty").value;
  if (!tenor || !apr || !min || !max || !penalty) return toast("Please fill all fields!", "error");
  try {
    toast("Creating saving plan...");
    const tx = await coreContract.createPlan(
      tenor,
      Math.round(parseFloat(apr) * 100),
      USDC(min),
      USDC(max),
      Math.round(parseFloat(penalty) * 100)
    );
    await tx.wait();
    await loadPlans();
    await refreshStats();
    toast("Plan created successfully!", "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function updatePlanApr() {
  const planId = document.getElementById("updatePlanId").value;
  const apr    = document.getElementById("updateApr").value;
  if (!planId || !apr) return toast("Enter Plan ID and new APR!", "error");
  try {
    toast("Updating APR...");
    const tx = await coreContract.updatePlan(planId, Math.round(parseFloat(apr) * 100));
    await tx.wait();
    await loadPlans();
    toast(`APR for Plan #${planId} updated successfully to ${apr}%!`, "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function togglePause() {
  try {
    const isPaused = await coreContract.paused();
    toast(isPaused ? "Unpausing system..." : "Pausing system...");
    const tx = isPaused ? await coreContract.unpause() : await coreContract.pause();
    await tx.wait();
    await refreshPauseStatus();
    toast(isPaused ? "System UNPAUSED ✅" : "System PAUSED ⏸️", "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function refreshPauseStatus() {
  try {
    const isPaused = await coreContract.paused();
    const statusEl = document.getElementById("pauseStatus");
    const btnEl    = document.getElementById("pauseBtn");
    if (isPaused) {
      statusEl.textContent = "Paused ⏸️";
      statusEl.style.color = "var(--red)";
      btnEl.textContent    = "▶️ Unpause System";
    } else {
      statusEl.textContent = "Active ✅";
      statusEl.style.color = "var(--teal)";
      btnEl.textContent    = "⏸️ Pause System";
    }
  } catch(e) {}
}

async function adminWithdrawVault() {
  const amount = prompt("How much USDC to withdraw from Vault?");
  if (!amount) return;
  try {
    toast("Withdrawing from Vault...");
    const tx = await vaultContract.withdrawVault(userAddr, USDC(amount));
    await tx.wait();
    await refreshStats();
    toast(`Withdrew ${amount} USDC from Vault!`, "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

// ─── DEVELOPER TOOLS ──────────────────────────────────────────
async function hardhatRpc(method, params = []) {
  const res = await fetch("http://127.0.0.1:8545", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

async function fastForward() {
  const days = parseInt(document.getElementById("fastForwardDays").value) || 91;
  const seconds = days * 24 * 60 * 60;
  try {
    await hardhatRpc("evm_increaseTime", [seconds]);
    await hardhatRpc("evm_mine");
    await checkChainTime(); // tự cập nhật timestamp sau khi tua
    toast(`⏩ Fast forwarded ${days} days! Check deposit status below.`, "success");
    if (coreContract) await loadDeposits();
  } catch(e) { toast("Time travel error: " + e.message, "error"); }
}

async function checkChainTime() {
  try {
    const res = await hardhatRpc("eth_getBlockByNumber", ["latest", false]);
    const ts = parseInt(res.result.timestamp, 16);
    const date = new Date(ts * 1000).toLocaleString("vi-VN");
    document.getElementById("chainTimestamp").textContent = date;
  } catch(e) {}
}

async function adminViewDeposit() {
  const id = document.getElementById("viewDepositId").value;
  if (!id) return toast("Enter Deposit ID!", "error");
  const infoEl = document.getElementById("adminDepositInfo");
  try {
    const d = await coreContract.getDeposit(id);
    const owner = await coreContract.ownerOf(id);
    const interest = await coreContract.calculateInterest(id);
    const chainNow = await getChainTimestamp();
    const isMature = chainNow >= Number(d.maturityAt);
    const STATUS = ["Active ✅","Withdrawn 💸","ManualRenewed 🔄","AutoRenewed 🔁"];
    infoEl.style.display = "block";
    infoEl.innerHTML = `
      <div style="margin-bottom:6px"><b>Deposit #${id}</b> — ${STATUS[d.status]}</div>
      <div>👤 Owner: <code>${owner.slice(0,10)}...</code></div>
      <div>💰 Principal: ${fmtUSDC(d.principal)} USDC</div>
      <div>📈 Est. Interest: <span style="color:var(--teal)">${fmtUSDC(interest)} USDC</span></div>
      <div>📅 Opened: ${fmtDate(d.startAt)}</div>
      <div>⏰ Maturity: ${fmtDate(d.maturityAt)} ${isMature ? "<span style='color:#2ecc71'>✅ MATURED</span>" : "<span style='color:#e67e22'>⏳ Not Matured</span>"}</div>
    `;
  } catch(e) { infoEl.style.display = "block"; infoEl.innerHTML = `<span style="color:var(--red)">Deposit #${id} not found</span>`; }
}

async function mineBlock() {
  try {
    await hardhatRpc("evm_mine");
    toast("⛏️ Đã mine 1 block!", "success");
  } catch(e) { toast("Lỗi: " + e.message, "error"); }
}

async function doAutoRenew() {
  const depositId = document.getElementById("autoRenewId").value;
  if (!depositId) return toast("Enter Deposit ID!", "error");
  try {
    toast(`Auto renewing deposit #${depositId}...`);
    const tx = await coreContract.autoRenewDeposit(depositId);
    const receipt = await tx.wait();
    toast(`🔄 Auto Renewed deposit #${depositId} successfully!`, "success");
    await loadDeposits();
  } catch(e) { toast(parseErr(e), "error"); }
}

// ─── UTILS ────────────────────────────────────────────────────
function showTab(name, el) {
  ["plans","deposits","admin"].forEach(t => document.getElementById("tab-"+t).classList.add("hidden"));
  document.getElementById("tab-"+name).classList.remove("hidden");
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  if (name === "deposits" && coreContract) loadDeposits();
}

function copy(text) {
  navigator.clipboard.writeText(text);
  toast("Address copied!", "success");
}

let toastTimer;
function toast(msg, type = "info") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  clearTimeout(toastTimer);
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = (type === "success" ? "✅ " : type === "error" ? "❌ " : "ℹ️ ") + msg;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 4000);
}

function parseErr(e) {
  if (e.reason) return e.reason;
  if (e.message?.includes("DepositNotMature")) return "Deposit not mature!";
  if (e.message?.includes("DepositAlreadyMature")) return "Deposit already mature, cannot withdraw early!";
  if (e.message?.includes("NotDepositOwner")) return "You are not the owner of this deposit!";
  if (e.message?.includes("BelowMinDeposit")) return "Amount below minimum!";
  if (e.message?.includes("AboveMaxDeposit")) return "Amount above maximum!";
  if (e.message?.includes("PlanDisabled")) return "Plan is disabled!";
  return e.message?.slice(0, 100) || "Unknown error";
}

// ─── LOAD ETHERS ──────────────────────────────────────────────
const script = document.createElement("script");
script.src = "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.umd.min.js";
script.onload = () => console.log("✅ Ethers.js v6 loaded");
document.head.appendChild(script);
