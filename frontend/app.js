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
];

const ABI_CORE = [
  "function owner() external view returns (address)",
  "function nextPlanId() external view returns (uint256)",
  "function nextDepositId() external view returns (uint256)",
  "function getPlan(uint256 planId) external view returns (tuple(uint256 tenorDays,uint256 aprBps,uint256 minDeposit,uint256 maxDeposit,uint256 earlyWithdrawPenaltyBps,bool enabled))",
  "function getDeposit(uint256 depositId) external view returns (tuple(uint256 planId,uint256 principal,uint256 startAt,uint256 maturityAt,uint256 aprBpsAtOpen,uint256 penaltyBpsAtOpen,uint256 tenorDays,uint8 status))",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function calculateInterest(uint256 depositId) external view returns (uint256)",
  "function createPlan(uint256 tenorDays,uint256 aprBps,uint256 minDeposit,uint256 maxDeposit,uint256 earlyWithdrawPenaltyBps) external returns (uint256)",
  "function openDeposit(uint256 planId,uint256 amount) external returns (uint256)",
  "function withdrawAtMaturity(uint256 depositId) external",
  "function earlyWithdraw(uint256 depositId) external",
  "function renewDeposit(uint256 depositId,uint256 newPlanId) external returns (uint256)",
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
  if (!pk) return toast("Nhập Private Key!", "error");
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
    toast("Kết nối thành công! Địa chỉ: " + userAddr.slice(0,10) + "...", "success");
  } catch(e) { toast("Lỗi: " + e.message, "error"); }
}

// ─── WALLET ───────────────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) return toast("Vui lòng cài MetaMask!", "error");
  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
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

    await refreshStats();
    await loadPlans();
    await checkAdmin();
    toast("Kết nối ví thành công!", "success");

    window.ethereum.on("accountsChanged", () => location.reload());
  } catch(e) {
    toast("Lỗi kết nối: " + e.message, "error");
  }
}

// ─── STATS ────────────────────────────────────────────────────
async function refreshStats() {
  try {
    const [bal, vault, nextPlan, nextDep] = await Promise.all([
      usdcContract.balanceOf(userAddr),
      vaultContract.vaultBalance(),
      coreContract.nextPlanId(),
      coreContract.nextDepositId(),
    ]);
    document.getElementById("myBalance").textContent = fmtUSDC(bal) + " USDC";
    document.getElementById("vaultBal").textContent  = fmtUSDC(vault) + " USDC";
    document.getElementById("totalPlans").textContent = Number(nextPlan) - 1;
    document.getElementById("myDeposits").textContent = "—";
  } catch(e) { console.error(e); }
}

// ─── CHECK ADMIN ──────────────────────────────────────────────
async function checkAdmin() {
  try {
    const owner = await coreContract.owner();
    if (owner.toLowerCase() === userAddr.toLowerCase()) {
      document.getElementById("adminGuard").classList.add("hidden");
      document.getElementById("adminContent").classList.remove("hidden");
      document.getElementById("ownerAddr").textContent = userAddr;
    }
  } catch(e) {}
}

// ─── PLANS ────────────────────────────────────────────────────
async function loadPlans() {
  if (!coreContract) return;
  const container = document.getElementById("plansList");
  container.innerHTML = '<div class="empty"><div>⏳ Đang tải...</div></div>';
  try {
    const nextId = Number(await coreContract.nextPlanId());
    if (nextId <= 1) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div>Chưa có gói nào. Admin hãy tạo gói mới!</div></div>';
      return;
    }
    let html = "";
    for (let i = 1; i < nextId; i++) {
      const p = await coreContract.getPlan(i);
      html += `<div class="plan-card" onclick="selectPlan(${i})">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div><div style="font-size:12px;color:var(--muted)">GÓI #${i}</div><div style="font-weight:700;font-size:16px">${p.tenorDays} Ngày</div></div>
          <span class="badge ${p.enabled ? 'badge-green' : 'badge-red'}">${p.enabled ? "Đang mở" : "Đóng"}</span>
        </div>
        <div class="plan-apr">${(Number(p.aprBps)/100).toFixed(2)}%</div>
        <div style="font-size:12px;color:var(--muted);margin-top:4px">Lãi suất/năm</div>
        <hr style="margin:12px 0">
        <div style="font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div><span style="color:var(--muted)">Tối thiểu:</span> ${fmtUSDC(p.minDeposit)} USDC</div>
          <div><span style="color:var(--muted)">Tối đa:</span> ${fmtUSDC(p.maxDeposit)} USDC</div>
          <div><span style="color:var(--muted)">Phạt rút sớm:</span> ${Number(p.earlyWithdrawPenaltyBps)/100}%</div>
        </div>
        <div style="margin-top:14px"><button class="btn btn-primary btn-sm" style="width:100%" onclick="event.stopPropagation();selectPlan(${i})">Gửi tiền vào gói này</button></div>
      </div>`;
    }
    container.innerHTML = html;
  } catch(e) { container.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div>' + e.message + '</div></div>'; }
}

function selectPlan(id) {
  document.getElementById("openPlanId").value = id;
  document.getElementById("openAmount").focus();
}

// ─── DEPOSITS ─────────────────────────────────────────────────
async function loadDeposits() {
  if (!coreContract) return toast("Kết nối ví trước!", "error");
  const container = document.getElementById("depositsList");
  container.innerHTML = '<div class="empty"><div>⏳ Đang tải...</div></div>';
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
      container.innerHTML = '<div class="empty"><div class="empty-icon">📂</div><div>Bạn chưa có sổ tiết kiệm nào</div></div>';
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    container.innerHTML = '<div class="grid">' + items.map(({ id, d, interest }) => {
      const isMature = now >= Number(d.maturityAt);
      const status = STATUS[d.status];
      const isActive = d.status === 0n;
      const pct = Math.min(100, ((now - Number(d.startAt)) / (Number(d.maturityAt) - Number(d.startAt))) * 100);
      return `<div class="dep-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <div style="font-weight:700;font-size:16px">Sổ #${id}</div>
          <span class="badge ${isActive ? (isMature ? 'badge-blue' : 'badge-green') : 'badge-grey'}">${isActive ? (isMature ? "Đã đáo hạn" : "Đang gửi") : status}</span>
        </div>
        <div class="dep-row"><span class="key">Gốc</span><span style="font-weight:600">${fmtUSDC(d.principal)} USDC</span></div>
        <div class="dep-row"><span class="key">Lãi suất</span><span>${(Number(d.aprBpsAtOpen)/100).toFixed(2)}%/năm</span></div>
        <div class="dep-row"><span class="key">Lãi dự tính</span><span style="color:var(--teal)">${fmtUSDC(interest)} USDC</span></div>
        <div class="dep-row"><span class="key">Mở ngày</span><span>${fmtDate(d.startAt)}</span></div>
        <div class="dep-row"><span class="key">Đáo hạn</span><span>${fmtDate(d.maturityAt)}</span></div>
        ${isActive ? `<div class="progress"><div class="progress-bar" style="width:${pct.toFixed(1)}%"></div></div><div style="font-size:11px;color:var(--muted);margin-top:4px;text-align:right">${pct.toFixed(0)}% thời gian</div>` : ""}
        ${isActive ? `<div class="dep-actions">
          ${isMature ? `<button class="btn btn-primary btn-sm" onclick="withdrawMature(${id})">✅ Rút đúng hạn</button>
          <button class="btn btn-outline btn-sm" onclick="promptRenew(${id})">🔄 Gia hạn</button>` :
          `<button class="btn btn-danger btn-sm" onclick="earlyWithdraw(${id})">⚡ Rút sớm (phạt ${Number(d.penaltyBpsAtOpen)/100}%)</button>`}
        </div>` : ""}
      </div>`;
    }).join("") + "</div>";
  } catch(e) { container.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div>' + e.message + '</div></div>'; }
}

// ─── ACTIONS ──────────────────────────────────────────────────
async function mintForAdmin() {
  const amount = document.getElementById("mintAdminAmount").value || "100000";
  try {
    toast(`Đang mint ${amount} USDC cho Admin...`);
    const tx = await usdcContract.mint(userAddr, USDC(amount));
    await tx.wait();
    await refreshStats();
    toast(`Mint ${amount} USDC thành công! Giờ nhấn "Nạp Vault".`, "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function mintUSDC() {
  if (!signer) return toast("Kết nối ví trước!", "error");
  try {
    toast("Đang mint 10,000 USDC...");
    const tx = await usdcContract.mint(userAddr, USDC(10000));
    await tx.wait();
    await refreshStats();
    toast("Mint 10,000 USDC thành công!", "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function openDeposit() {
  if (!signer) return toast("Kết nối ví trước!", "error");
  const planId = document.getElementById("openPlanId").value;
  const amount = document.getElementById("openAmount").value;
  if (!planId || !amount) return toast("Nhập đủ thông tin!", "error");
  try {
    toast("Đang approve USDC...");
    const approveTx = await usdcContract.approve(ADDRESSES.core, USDC(amount));
    await approveTx.wait();
    toast("Đang mở sổ tiết kiệm...");
    const tx = await coreContract.openDeposit(planId, USDC(amount));
    await tx.wait();
    await refreshStats();
    toast("Mở sổ thành công! Chuyển sang tab 'Sổ Của Tôi' để xem.", "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function withdrawMature(id) {
  try {
    toast("Đang rút tiền đúng hạn...");
    const tx = await coreContract.withdrawAtMaturity(id);
    await tx.wait();
    await refreshStats();
    await loadDeposits();
    toast("Rút tiền đúng hạn thành công!", "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function earlyWithdraw(id) {
  if (!confirm("Bạn sẽ bị trừ phí phạt khi rút sớm. Xác nhận?")) return;
  try {
    toast("Đang rút sớm...");
    const tx = await coreContract.earlyWithdraw(id);
    await tx.wait();
    await refreshStats();
    await loadDeposits();
    toast("Rút sớm thành công!", "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function promptRenew(id) {
  const newPlan = prompt("Nhập Plan ID muốn gia hạn sang (nhấn Cancel để huỷ):", "1");
  if (!newPlan) return;
  try {
    toast("Đang gia hạn sổ...");
    const tx = await coreContract.renewDeposit(id, newPlan);
    await tx.wait();
    await loadDeposits();
    toast("Gia hạn thành công!", "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function fundVault() {
  const amount = document.getElementById("fundAmount").value;
  if (!amount) return toast("Nhập số tiền!", "error");
  try {
    toast("Đang approve USDC...");
    const approveTx = await usdcContract.approve(ADDRESSES.vault, USDC(amount));
    await approveTx.wait();
    toast("Đang nạp vault...");
    const tx = await vaultContract.fundVault(USDC(amount));
    await tx.wait();
    await refreshStats();
    toast(`Nạp ${amount} USDC vào Vault thành công!`, "success");
  } catch(e) { toast(parseErr(e), "error"); }
}

async function createPlan() {
  const tenor   = document.getElementById("pTenor").value;
  const apr     = document.getElementById("pApr").value;
  const min     = document.getElementById("pMin").value;
  const max     = document.getElementById("pMax").value;
  const penalty = document.getElementById("pPenalty").value;
  if (!tenor || !apr || !min || !max || !penalty) return toast("Nhập đủ thông tin!", "error");
  try {
    toast("Đang tạo gói tiết kiệm...");
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
    toast("Tạo gói thành công!", "success");
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
  toast("Đã copy địa chỉ!", "success");
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
  if (e.message?.includes("DepositNotMature")) return "Sổ chưa đến hạn!";
  if (e.message?.includes("DepositAlreadyMature")) return "Sổ đã đáo hạn, không rút sớm được!";
  if (e.message?.includes("NotDepositOwner")) return "Bạn không phải chủ sổ này!";
  if (e.message?.includes("BelowMinDeposit")) return "Số tiền dưới mức tối thiểu!";
  if (e.message?.includes("AboveMaxDeposit")) return "Số tiền vượt mức tối đa!";
  if (e.message?.includes("PlanDisabled")) return "Gói tiết kiệm đã đóng!";
  return e.message?.slice(0, 100) || "Lỗi không xác định";
}

// ─── LOAD ETHERS ──────────────────────────────────────────────
const script = document.createElement("script");
script.src = "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.7.0/ethers.umd.min.js";
script.onload = () => console.log("✅ Ethers.js v6 loaded");
document.head.appendChild(script);
