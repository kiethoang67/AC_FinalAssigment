# 🏦 Online Banking System — Blockchain Final Project

A decentralized **Online Banking System** built with **Solidity 0.8.28** and **Hardhat**, simulating core banking features such as term deposits, interest calculation, early withdrawal penalties, and automated deposit renewal — all powered by ERC-20 tokens and ERC-721 NFT certificates.

---

## 📌 Project Overview

This system consists of **3 smart contracts**:

| Contract | Role |
|---|---|
| `MockUSDC` | ERC-20 token (6 decimals) simulating USDC stablecoin |
| `VaultManager` | Bank's liquidity pool — holds capital to pay interest |
| `SavingCore` | Core banking logic — manages saving plans, deposits (NFT), withdrawals, and renewals |

### 🔑 Key Design
- Each **Saving Certificate** is an **ERC-721 NFT** (`tokenId = depositId`)
- **Principal** is held in `SavingCore`; **Interest** is paid from `VaultManager`
- Ownership of the NFT = ownership of the deposit

---

## 🗂️ Project Structure

```
AcFinalProject/
├── contracts/
│   ├── MockUSDC.sol           # ERC-20 test token (6 decimals)
│   ├── VaultManager.sol       # Liquidity vault for interest payouts
│   └── SavingCore.sol         # Core banking logic + ERC-721 NFT
├── frontend/
│   ├── index.html             # DApp UI (connect wallet, manage deposits)
│   └── app.js                 # Frontend logic (Ethers.js v6)
├── scripts/
│   ├── deploy.js              # Deploy all 3 contracts to localhost
│   └── demo.js                # Interactive CLI demo script
├── test/
│   └── BankingSystem.test.js  # Unit tests (18 test cases, 97%+ coverage)
├── hardhat.config.js
└── package.json
```

---

## ⚙️ Setup & Installation

```bash
# Clone the repository
git clone https://github.com/kiethoang67/AC_FinalAssigment.git
cd AC_FinalAssigment

# Install dependencies
npm install
```

---

## 🚀 How to Run

### Compile contracts
```bash
npx hardhat compile
```

### Run unit tests
```bash
npx hardhat test
```

### Check test coverage (target: > 90%)
```bash
npx hardhat coverage
```

### Run the interactive demo (CLI)
```bash
npx hardhat run scripts/demo.js
```

### Deploy to Hardhat Localhost
```bash
# Terminal 1: start local node
npx hardhat node

# Terminal 2: deploy contracts
npx hardhat run scripts/deploy.js --network localhost

# Terminal 3: serve frontend
npx serve frontend
```
Then open `http://localhost:3000` in your browser.

---

## 🎬 Interactive Demo Scenarios

The `scripts/demo.js` walks through **6 complete scenarios** with step-by-step terminal prompts:

| # | Scenario | Key Function |
|---|---|---|
| 1 | Deposit → wait for maturity → withdraw (Gốc + Lãi) | `openDeposit` → `withdrawAtMaturity` |
| 2 | Deposit → early withdrawal (5% penalty, 0 interest) | `openDeposit` → `earlyWithdraw` |
| 3 | **Best-Effort Payout**: Vault runs dry → still succeeds | `withdrawAtMaturity` + `PartialInterestPaid` event |
| 4 | Manual renewal — compound interest into new principal | `openDeposit` → `renewDeposit` |
| 5 | **Auto-Renew Fix APR**: applies current market APR | `autoRenewDeposit` (new APR, not snapshot) |
| 6 | **Max Deposit Guard**: auto-renew blocked if exceeds limit | `autoRenewDeposit` → revert `AboveMaxDeposit` |

---

## 🧪 Test Coverage Results

```
--------------------|---------|---------|---------|---------|
File                |  Stmts  | Branch  |  Funcs  |  Lines  |
--------------------|---------|---------|---------|---------|
 MockUSDC.sol       |   100%  |  100%   |  100%   |  100%   |
 SavingCore.sol     |  98.8%  |  63.3%  |  93.3%  |  97.2%  |
 VaultManager.sol   |  96.3%  |  61.9%  |  100%   |  100%   |
--------------------|---------|---------|---------|---------|
 All files          |  98.2%  |  62.9%  |  96.4%  |  97.9%  |
--------------------|---------|---------|---------|---------|
```


## 👨‍💻 Tech Stack

- **Solidity** `0.8.28`
- **Hardhat** `^2.22.0`
- **OpenZeppelin Contracts** `^5.6.1` (ERC721, ERC20, SafeERC20, Ownable, Pausable)
- **Ethers.js** `v6`
- **solidity-coverage** for test coverage reporting
