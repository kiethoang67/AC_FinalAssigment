# 🏦 Online Banking System — Blockchain DApp

A decentralized **Online Banking System** built with **Solidity 0.8.28** and **Hardhat**, simulating core banking features such as term deposits, interest calculation, early withdrawal penalties, and automated deposit renewal.

---

## 1. Project Overview & Architecture

The project aims to bring traditional term-deposit banking logic into a decentralized environment (DeFi). Users can deposit stablecoins (USDC) into predefined savings plans and earn interest over time. 

**Key Architectural Decisions:**
- **ERC-721 as Certificates:** Every deposit created by a user mints a unique NFT (ERC-721). The `tokenId` acts directly as the `depositId`. Owning the NFT means owning the principal and the accrued interest.
- **Segregation of Funds:** 
  - **Principal** is locked securely in the core banking contract.
  - **Interest** is paid out from a separate Vault contract, simulating a bank's liquidity pool.
- **Role-Based Access Control (RBAC):** The system distinguishes between the `Admin/Deployer` (who manages the vault, creates plans, and controls the system pause state) and normal `Users` (who open and manage deposits).

---

## 2. Components & Smart Contract Architecture

The system is powered by **3 core smart contracts**:

| Component | Role in Architecture |
|---|---|
| `MockUSDC.sol` | **The Currency:** An ERC-20 token (with 6 decimals) simulating a fiat-pegged stablecoin like USDC. Used for all deposits and payouts. |
| `VaultManager.sol` | **The Liquidity Pool:** Holds the bank's capital to pay out interest. It is controlled by the Admin, but only the core contract can request funds from it to pay users upon maturity. |
| `SavingCore.sol` | **The Core Logic:** Inherits from `ERC721`, `Ownable`, and `Pausable`. It manages the creation of savings plans, handles user deposits (minting NFTs), calculates compound interest, and executes withdrawals/renewals. |

**Smart Contract Data Flow:**
1. **Deposit:** User transfers USDC to `SavingCore` → `SavingCore` mints an NFT certificate to the user.
2. **Withdrawal (Maturity):** User burns NFT → `SavingCore` returns Principal → `SavingCore` requests Interest from `VaultManager` → User receives Principal + Interest.
3. **Withdrawal (Early):** User burns NFT → `SavingCore` deducts penalty → `SavingCore` sends penalty to `VaultManager` fee receiver → User receives remaining Principal.

---

## 3. Front-End & How to Run

### Front-End Implementation
The front-end is built using vanilla HTML/CSS and Javascript, communicating with the blockchain via **Ethers.js v6**. 
- **Admin Dashboard:** Automatically appears when the deployer account connects. It allows the admin to mint USDC, fund the vault, create/update savings plans, trigger an emergency pause, and use "Developer Tools" to time-travel (manipulate the blockchain timestamp) for testing maturity.
- **User Dashboard:** Allows users to view available savings plans, deposit funds, track time elapsed via a progress bar, and choose to withdraw or renew their deposits.

### 🚀 How to Run the Project locally

**Step 1: Install Dependencies**
```bash
npm install
```

**Step 2: Start the Local Blockchain Node**
Open a terminal and start the Hardhat network:
```bash
npx hardhat node
```

**Step 3: Deploy the Smart Contracts**
Open a **second terminal** and deploy the contracts to the local node. (This script also auto-updates the frontend with the new contract addresses).
```bash
npx hardhat run scripts/deploy.js --network localhost
```

**Step 4: Serve the Front-End**
In the same or a **third terminal**, run the frontend server:
```bash
npx serve frontend
```
Then open `http://localhost:3000` in your web browser. 

*(Tip: In the DApp, choose "Account #0" from the dropdown to access the Admin Panel, or "Account #1" to act as a normal user).*

---

## 👨‍💻 Tech Stack

- **Smart Contracts:** Solidity `0.8.28`, OpenZeppelin Contracts `^5.6.1`
- **Development Environment:** Hardhat `^2.22.0`
- **Front-End:** HTML5, CSS3, JavaScript, Ethers.js `v6`
- **Testing:** Mocha/Chai (`npx hardhat test`), Solidity-Coverage
