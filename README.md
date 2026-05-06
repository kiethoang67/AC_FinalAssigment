# 🏦 Online Banking System — Blockchain DApp

A decentralized **term deposit system** built for EVM-compatible blockchains. Users lock tokens in saving plans, earn interest, and withdraw at maturity. The system uses **ERC-721 NFTs** as deposit certificates and a dedicated **VaultManager** for interest payments.

---

## 1. Features

### 👤 User (Depositor)
- **View Plans**: Browse available saving plans with different tenors and APRs.
- **Open Deposit**: Approve USDC and open a deposit to mint a unique NFT certificate.
- **Withdraw at Maturity**: Claim principal + accrued interest once the term ends.
- **Early Withdrawal**: Withdraw before maturity (principal minus penalty, zero interest).
- **Manual Renew**: Compound interest into a new principal and roll over into a new plan.
- **Auto Renew**: System automatically renews matured deposits past a 3-day grace period.

### 🔐 Admin
- **Manage Plans**: Create, update APR, enable, or disable saving plans.
- **Vault Control**: Fund the interest vault or withdraw liquidity.
- **Emergency Stop**: Pause/Unpause the entire system to protect funds.
- **Fee Management**: Set a fee receiver for early withdrawal penalties.

---

## 2. System Architecture

The project follows a modular architecture to separate logic from liquidity:

| Contract | Purpose |
|----------|---------|
| `MockUSDC.sol` | Simulates a fiat-pegged stablecoin (6 decimals). |
| `VaultManager.sol` | Holds the bank's capital; handles interest payouts and fee collection. |
| `SavingCore.sol` | Handles core logic: plan management, NFT minting, and interest calculation. |

### Business Rules
1. **APR Snapshotting**: Interest rates are locked at the moment of deposit. Admin changes to a plan do not affect existing deposits.
2. **Simple Interest**: Calculations are based on simple interest over the tenor period.
3. **Best-Effort Payout**: Principal is always guaranteed. If the vault has insufficient funds for interest, the system tracks it as "User Debt" to be claimed later.
4. **Auto-Renew Protection**: Preserves the **original APR** to protect users from rate decreases.

---

## 3. Tech Stack

- **Smart Contracts**: Solidity `0.8.28`, OpenZeppelin `5.1.x`
- **Development**: Hardhat, Ethers.js `v6`
- **Frontend**: Vanilla HTML/JS, CSS3 (Modern Glassmorphism Design)
- **Testing**: Mocha/Chai (`npx hardhat test`), Solidity-Coverage

---

## 4. Local Setup & Deployment

### Prerequisites
- Node.js `v18+`
- MetaMask browser extension

### Installation
```bash
# 1. Install root dependencies
npm install

# 2. Setup environment variables
cp .env.example .env
# Fill in your PRIVATE_KEY and SEPOLIA_RPC_URL (optional)
```

### Running Locally (3 Terminals)

**Terminal 1: Start Local Node**
```bash
npx hardhat node
```

**Terminal 2: Deploy Contracts**
```bash
npm run deploy:local
```

**Terminal 3: Serve Frontend**
```bash
npm run serve
```
Visit `http://localhost:8080` in your browser.

---

## 5. Testing

The project includes a comprehensive test suite covering 18+ scenarios:
- Plan creation & management.
- Deposit opening (limits, validation).
- Withdrawal (maturity, early, partial interest).
- Renewal (manual, auto with APR preservation).
- Emergency pause & vault management.

Run tests with:
```bash
npm test
```

To check contract sizes:
```bash
npm run size
```

---

## 📄 License
This project is for educational purposes under the **ISC License**.
