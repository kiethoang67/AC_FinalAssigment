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

## 🎓 Teacher-Rules (Custom Requirements)

Three special rules were implemented as per assignment requirements:

### Rule 1 — Best-Effort Payout
> `withdrawAtMaturity` **never reverts** due to insufficient vault funds.
> - ✅ 100% of principal is **always** returned to the user.
> - ✅ Interest is paid **up to whatever is available** in the vault.
> - 📡 Event `PartialInterestPaid` is emitted when vault cannot cover full interest.

### Rule 2 — Auto-Renew Fix APR
> When `autoRenewDeposit` is called, the **new deposit uses the current market APR** of the plan, not the original snapshot — reflecting real market rate changes made by Admin.

### Rule 3 — Auto-Renew Max Deposit Guard
> `autoRenewDeposit` **reverts with `AboveMaxDeposit`** if the compounded new principal (old principal + interest) exceeds the plan's `maxDeposit` limit.

---

## 🗂️ Project Structure

```
AcFinalProject/
├── contracts/
│   ├── MockUSDC.sol        # ERC-20 test token (6 decimals)
│   ├── VaultManager.sol    # Liquidity vault for interest payouts
│   └── SavingCore.sol      # Core banking logic + ERC-721 NFT
├── scripts/
│   └── demo.js             # Interactive CLI demo script
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

### Run the interactive demo
```bash
npx hardhat run scripts/demo.js
```

---

## 🎬 Interactive Demo Scenarios

The `scripts/demo.js` walks through **6 complete scenarios** with step-by-step terminal prompts:

| # | Scenario | Key Function |
|---|---|---|
| 1 | Deposit → wait for maturity → withdraw (Gốc + Lãi) | `openDeposit` → `withdrawAtMaturity` |
| 2 | Deposit → early withdrawal (5% penalty, 0 interest) | `openDeposit` → `earlyWithdraw` |
| 3 | **Teacher-Rule 1**: Vault runs dry → Best-Effort Payout | `withdrawAtMaturity` + `PartialInterestPaid` event |
| 4 | Manual renewal — compound interest into new principal | `openDeposit` → `renewDeposit` |
| 5 | **Teacher-Rule 2**: Auto-renew applies current market APR | `autoRenewDeposit` (new APR, not snapshot) |
| 6 | **Teacher-Rule 3**: Auto-renew blocked if exceeds maxDeposit | `autoRenewDeposit` → revert `AboveMaxDeposit` |

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

---

## 📐 Token Flow

```
User ──(USDC)──► SavingCore      (holds principal)
                     │
                     └──(interest request)──► VaultManager ──(USDC)──► User
                                                   ▲
                                            Admin funds vault
```

---

## 👨‍💻 Tech Stack

- **Solidity** `0.8.28`
- **Hardhat** `^2.22.0`
- **OpenZeppelin Contracts** `^5.6.1` (ERC721, ERC20, SafeERC20, Ownable, Pausable)
- **Ethers.js** `v6`
- **Mocha + Chai** (via `@nomicfoundation/hardhat-toolbox`)
- **solidity-coverage** for test coverage reporting
