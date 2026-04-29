// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

import "./VaultManager.sol";

/**
 * @title SavingCore
 * @notice Core contract for the Online Banking System.
 *
 * @dev Architecture overview:
 *  ┌──────────────────────────────────────────────────────────┐
 *  │  The ERC-721 tokenId IS the depositId (1:1 mapping).    │
 *  │  mapping(uint256 => Deposit) deposits;                  │
 *  │  deposits[tokenId] gives the full deposit record.       │
 *  └──────────────────────────────────────────────────────────┘
 *
 *  Why this design?
 *  - Each deposit is uniquely identified by its NFT tokenId.
 *  - Ownership of the NFT = ownership of the deposit.
 *  - No extra mapping between "depositId" and "tokenId" needed.
 *  - Transferring the NFT transfers the deposit rights.
 *
 *  Token flow:
 *  - Principal: held by SavingCore (this contract).
 *  - Interest:  paid from VaultManager.
 *  - Penalty:   sent to VaultManager.feeReceiver().
 */
contract SavingCore is ERC721, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ══════════════════════════════════════════════
    //  Constants
    // ══════════════════════════════════════════════

    /// @notice Seconds in a year (365 days) — used for interest calculation.
    uint256 public constant SECONDS_PER_YEAR = 365 days; // 31_536_000

    /// @notice Basis-point denominator (10_000 = 100%).
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Grace period before auto-renew is triggered (3 days).
    uint256 public constant GRACE_PERIOD = 3 days;

    // ══════════════════════════════════════════════
    //  Enums & Structs
    // ══════════════════════════════════════════════

    /// @notice Possible statuses of a deposit certificate.
    enum DepositStatus {
        Active,
        Withdrawn,
        ManualRenewed,
        AutoRenewed
    }

    /**
     * @notice A product template created by the admin.
     * @param tenorDays               Lock duration in days.
     * @param aprBps                  Annual Percentage Rate in basis points (800 = 8.00%).
     * @param minDeposit              Minimum deposit amount (0 = no limit).
     * @param maxDeposit              Maximum deposit amount (0 = no limit).
     * @param earlyWithdrawPenaltyBps Penalty rate for early withdrawal in bps (500 = 5%).
     * @param enabled                 Whether new deposits can be opened on this plan.
     */
    struct SavingPlan {
        uint256 tenorDays;
        uint256 aprBps;
        uint256 minDeposit;
        uint256 maxDeposit;
        uint256 earlyWithdrawPenaltyBps;
        bool enabled;
    }

    /**
     * @notice On-chain record of a single deposit, linked to an ERC-721 tokenId.
     *
     * @dev `aprBpsAtOpen` and `penaltyBpsAtOpen` are **snapshots** taken at the
     *      moment the deposit is opened. Subsequent admin changes to the plan
     *      never affect existing deposits.
     *
     * @param planId            The plan this deposit was opened under.
     * @param principal         Amount deposited (in token smallest unit, e.g. 6 decimals).
     * @param startAt           Timestamp when the deposit was created.
     * @param maturityAt        Timestamp when the deposit matures.
     * @param aprBpsAtOpen      Snapshot of the plan's APR at deposit open.
     * @param penaltyBpsAtOpen  Snapshot of the plan's early-withdrawal penalty at open.
     * @param tenorDays         Snapshot of the plan's tenor at open.
     * @param status            Current lifecycle status.
     */
    struct Deposit {
        uint256 planId;
        uint256 principal;
        uint256 startAt;
        uint256 maturityAt;
        uint256 aprBpsAtOpen;
        uint256 penaltyBpsAtOpen;
        uint256 tenorDays;
        DepositStatus status;
    }

    // ══════════════════════════════════════════════
    //  State variables
    // ══════════════════════════════════════════════

    /// @notice The ERC-20 token used for deposits (MockUSDC).
    IERC20 public immutable token;

    /// @notice The VaultManager that pays interest.
    VaultManager public immutable vaultManager;

    /// @notice Auto-incrementing plan counter. First plan ID = 1.
    uint256 public nextPlanId = 1;

    /// @notice Auto-incrementing deposit / NFT token counter. First token ID = 1.
    uint256 public nextDepositId = 1;

    /// @notice Plan ID → plan definition.
    mapping(uint256 => SavingPlan) public plans;

    /**
     * @notice tokenId (= depositId) → deposit data.
     * @dev This is the core mapping: the ERC-721 tokenId directly indexes
     *      the deposit struct, giving a clean 1:1 relationship.
     */
    mapping(uint256 => Deposit) public deposits;

    // ══════════════════════════════════════════════
    //  Events (as required by the assignment)
    // ══════════════════════════════════════════════

    event PlanCreated(uint256 indexed planId, uint256 tenorDays, uint256 aprBps);
    event PlanUpdated(uint256 indexed planId, uint256 newAprBps);
    event PlanToggled(uint256 indexed planId, bool enabled);

    event DepositOpened(
        uint256 indexed depositId,
        address indexed owner,
        uint256 planId,
        uint256 principal,
        uint256 maturityAt,
        uint256 aprBpsAtOpen
    );

    event Withdrawn(
        uint256 indexed depositId,
        address indexed owner,
        uint256 principal,
        uint256 interest,
        bool isEarly
    );

    event Renewed(
        uint256 indexed oldDepositId,
        uint256 indexed newDepositId,
        uint256 newPrincipal,
        uint256 newPlanId
    );

    // @Teacher-Rule Best-Effort Payout: emitted when Vault cannot pay full interest
    event PartialInterestPaid(
        uint256 indexed depositId,
        uint256 expectedInterest,
        uint256 actualPaid
    );

    // ══════════════════════════════════════════════
    //  Errors
    // ══════════════════════════════════════════════

    error PlanNotFound(uint256 planId);
    error PlanDisabled(uint256 planId);
    error InvalidTenor();
    error InvalidAPR();
    error InvalidDepositLimits();
    error BelowMinDeposit(uint256 amount, uint256 min);
    error AboveMaxDeposit(uint256 amount, uint256 max);
    error ZeroAmount();
    error NotDepositOwner(uint256 depositId);
    error DepositNotActive(uint256 depositId);
    error DepositNotMature(uint256 depositId);
    error DepositAlreadyMature(uint256 depositId);
    error GracePeriodNotElapsed(uint256 depositId);

    // ══════════════════════════════════════════════
    //  Constructor
    // ══════════════════════════════════════════════

    /**
     * @param _token        Address of the ERC-20 token (MockUSDC).
     * @param _vaultManager Address of the deployed VaultManager.
     */
    constructor(
        address _token,
        address _vaultManager
    ) ERC721("BankingSavingCertificate", "BSC") Ownable(msg.sender) {
        token = IERC20(_token);
        vaultManager = VaultManager(_vaultManager);
    }

    // ══════════════════════════════════════════════
    //  Admin — Plan management
    // ══════════════════════════════════════════════

    /**
     * @notice Create a new saving plan.
     * @param tenorDays               Lock duration in days (must be > 0).
     * @param aprBps                  APR in basis points (must be > 0).
     * @param minDeposit              Minimum deposit amount (0 = no limit).
     * @param maxDeposit              Maximum deposit amount (0 = no limit).
     * @param earlyWithdrawPenaltyBps Penalty in basis points.
     * @return planId                 The ID of the newly created plan.
     */
    function createPlan(
        uint256 tenorDays,
        uint256 aprBps,
        uint256 minDeposit,
        uint256 maxDeposit,
        uint256 earlyWithdrawPenaltyBps
    ) external onlyOwner returns (uint256 planId) {
        // ── Validation ────────────────────────────
        if (tenorDays == 0) revert InvalidTenor();
        if (aprBps == 0) revert InvalidAPR();
        if (maxDeposit != 0 && minDeposit > maxDeposit) {
            revert InvalidDepositLimits();
        }

        planId = nextPlanId++;

        plans[planId] = SavingPlan({
            tenorDays: tenorDays,
            aprBps: aprBps,
            minDeposit: minDeposit,
            maxDeposit: maxDeposit,
            earlyWithdrawPenaltyBps: earlyWithdrawPenaltyBps,
            enabled: true
        });

        emit PlanCreated(planId, tenorDays, aprBps);
    }

    /**
     * @notice Update the APR of an existing plan. Only affects future deposits.
     * @param planId   ID of the plan to update.
     * @param newAprBps New APR in basis points (must be > 0).
     */
    function updatePlan(uint256 planId, uint256 newAprBps) external onlyOwner {
        if (plans[planId].tenorDays == 0) revert PlanNotFound(planId);
        if (newAprBps == 0) revert InvalidAPR();

        plans[planId].aprBps = newAprBps;
        emit PlanUpdated(planId, newAprBps);
    }

    /// @notice Enable a plan so users can open new deposits.
    function enablePlan(uint256 planId) external onlyOwner {
        if (plans[planId].tenorDays == 0) revert PlanNotFound(planId);
        plans[planId].enabled = true;
        emit PlanToggled(planId, true);
    }

    /// @notice Disable a plan to stop new deposits.
    function disablePlan(uint256 planId) external onlyOwner {
        if (plans[planId].tenorDays == 0) revert PlanNotFound(planId);
        plans[planId].enabled = false;
        emit PlanToggled(planId, false);
    }

    // ══════════════════════════════════════════════
    //  Admin — Pause / Unpause
    // ══════════════════════════════════════════════

    /// @notice Emergency pause — blocks withdrawals and renewals.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume normal operations.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ══════════════════════════════════════════════
    //  User — Open a deposit
    // ══════════════════════════════════════════════

    /**
     * @notice Open a new term deposit and receive an NFT certificate.
     *
     * @dev Flow:
     *  1. Validate plan is enabled and amount is within limits.
     *  2. Transfer tokens from user to this contract (principal).
     *  3. Mint an ERC-721 NFT to the user.
     *  4. Snapshot current plan APR & penalty into the Deposit struct.
     *
     * Edge cases handled:
     *  - Plan must exist (tenorDays > 0) and be enabled.
     *  - Amount must be > 0.
     *  - Amount ≥ minDeposit (if minDeposit > 0).
     *  - Amount ≤ maxDeposit (if maxDeposit > 0).
     *  - Contract must not be paused (prevents new deposits during emergencies).
     *  - User must have approved sufficient token allowance (SafeERC20 reverts).
     *
     * @param planId ID of the saving plan.
     * @param amount Token amount to deposit (in smallest unit).
     * @return depositId The minted NFT tokenId, which is also the deposit ID.
     */
    function openDeposit(
        uint256 planId,
        uint256 amount
    ) external whenNotPaused returns (uint256 depositId) {
        // ── Load & validate plan ──────────────────
        SavingPlan storage plan = plans[planId];
        if (plan.tenorDays == 0) revert PlanNotFound(planId);
        if (!plan.enabled) revert PlanDisabled(planId);

        // ── Validate amount ───────────────────────
        if (amount == 0) revert ZeroAmount();
        if (plan.minDeposit > 0 && amount < plan.minDeposit) {
            revert BelowMinDeposit(amount, plan.minDeposit);
        }
        if (plan.maxDeposit > 0 && amount > plan.maxDeposit) {
            revert AboveMaxDeposit(amount, plan.maxDeposit);
        }

        // ── Transfer principal from user → contract ──
        token.safeTransferFrom(msg.sender, address(this), amount);

        // ── Mint NFT (tokenId = depositId) ────────
        depositId = nextDepositId++;
        _mint(msg.sender, depositId);

        // ── Create deposit record with snapshots ──
        uint256 maturityAt = block.timestamp + plan.tenorDays * 1 days;

        deposits[depositId] = Deposit({
            planId: planId,
            principal: amount,
            startAt: block.timestamp,
            maturityAt: maturityAt,
            aprBpsAtOpen: plan.aprBps,                    // ← snapshot
            penaltyBpsAtOpen: plan.earlyWithdrawPenaltyBps, // ← snapshot
            tenorDays: plan.tenorDays,                    // ← snapshot
            status: DepositStatus.Active
        });

        emit DepositOpened(
            depositId,
            msg.sender,
            planId,
            amount,
            maturityAt,
            plan.aprBps
        );
    }

    // ══════════════════════════════════════════════
    //  User — Withdraw at maturity
    // ══════════════════════════════════════════════

    /**
     * @notice Withdraw principal + interest after the deposit has matured.
     * @dev Teacher-Rule Best-Effort Payout:
     *      Principal is ALWAYS returned to the user.
     *      Interest is paid best-effort: if the Vault has insufficient funds,
     *      only the available portion is paid and PartialInterestPaid is emitted.
     * @param depositId The NFT tokenId / deposit ID.
     */
    function withdrawAtMaturity(uint256 depositId) external whenNotPaused {
        if (ownerOf(depositId) != msg.sender) revert NotDepositOwner(depositId);

        Deposit storage dep = deposits[depositId];
        if (dep.status != DepositStatus.Active) revert DepositNotActive(depositId);
        if (block.timestamp < dep.maturityAt) revert DepositNotMature(depositId);

        dep.status = DepositStatus.Withdrawn;

        // ── Calculate simple interest ─────────────
        uint256 tenorSeconds = dep.tenorDays * 1 days;
        uint256 interest = (dep.principal * dep.aprBpsAtOpen * tenorSeconds)
            / (SECONDS_PER_YEAR * BPS_DENOMINATOR);

        // @Teacher-Rule Best-Effort: principal is ALWAYS returned first
        token.safeTransfer(msg.sender, dep.principal);

        // @Teacher-Rule Best-Effort: interest paid from vault (partial if insufficient)
        uint256 actualPaid = 0;
        if (interest > 0) {
            actualPaid = vaultManager.requestInterest(msg.sender, interest);

            // Emit PartialInterestPaid when vault could not cover full interest
            if (actualPaid < interest) {
                emit PartialInterestPaid(depositId, interest, actualPaid);
            }
        }

        emit Withdrawn(depositId, msg.sender, dep.principal, actualPaid, false);
    }

    // ══════════════════════════════════════════════
    //  User — Early withdrawal
    // ══════════════════════════════════════════════

    /**
     * @notice Withdraw before maturity. No interest is paid; a penalty is
     *         deducted from the principal and sent to the fee receiver.
     * @param depositId The NFT tokenId / deposit ID.
     */
    function earlyWithdraw(uint256 depositId) external whenNotPaused {
        if (ownerOf(depositId) != msg.sender) revert NotDepositOwner(depositId);

        Deposit storage dep = deposits[depositId];
        if (dep.status != DepositStatus.Active) revert DepositNotActive(depositId);
        if (block.timestamp >= dep.maturityAt) revert DepositAlreadyMature(depositId);

        dep.status = DepositStatus.Withdrawn;

        // ── Calculate penalty ─────────────────────
        uint256 penalty = (dep.principal * dep.penaltyBpsAtOpen) / BPS_DENOMINATOR;
        uint256 userReceives = dep.principal - penalty;

        // ── Transfer penalty to feeReceiver ───────
        if (penalty > 0) {
            address receiver = vaultManager.feeReceiver();
            token.safeTransfer(receiver, penalty);
        }

        // ── Transfer remaining principal to user ──
        if (userReceives > 0) {
            token.safeTransfer(msg.sender, userReceives);
        }

        emit Withdrawn(depositId, msg.sender, dep.principal, 0, true);
    }

    // ══════════════════════════════════════════════
    //  User — Manual Renew
    // ══════════════════════════════════════════════

    /**
     * @notice Renew a matured deposit into a new plan.
     * @dev The earned interest is compounded into the new principal.
     *      A new NFT is minted; the old one's status becomes ManualRenewed.
     * @param depositId ID of the matured deposit.
     * @param newPlanId ID of the plan for the new deposit.
     * @return newDepositId The minted NFT tokenId for the new deposit.
     */
    function renewDeposit(
        uint256 depositId,
        uint256 newPlanId
    ) external whenNotPaused returns (uint256 newDepositId) {
        if (ownerOf(depositId) != msg.sender) revert NotDepositOwner(depositId);

        Deposit storage dep = deposits[depositId];
        if (dep.status != DepositStatus.Active) revert DepositNotActive(depositId);
        if (block.timestamp < dep.maturityAt) revert DepositNotMature(depositId);

        // ── Validate new plan ─────────────────────
        SavingPlan storage newPlan = plans[newPlanId];
        if (newPlan.tenorDays == 0) revert PlanNotFound(newPlanId);
        if (!newPlan.enabled) revert PlanDisabled(newPlanId);

        // ── Calculate interest on old deposit ─────
        uint256 tenorSeconds = dep.tenorDays * 1 days;
        uint256 interest = (dep.principal * dep.aprBpsAtOpen * tenorSeconds)
            / (SECONDS_PER_YEAR * BPS_DENOMINATOR);

        // ── New principal = old principal + interest
        uint256 newPrincipal = dep.principal + interest;

        // ── Validate new principal against new plan limits
        if (newPlan.minDeposit > 0 && newPrincipal < newPlan.minDeposit) {
            revert BelowMinDeposit(newPrincipal, newPlan.minDeposit);
        }
        if (newPlan.maxDeposit > 0 && newPrincipal > newPlan.maxDeposit) {
            revert AboveMaxDeposit(newPrincipal, newPlan.maxDeposit);
        }

        // ── Close old deposit ─────────────────────
        dep.status = DepositStatus.ManualRenewed;

        // ── Request interest transfer from vault into this contract ──
        if (interest > 0) {
            vaultManager.requestInterest(address(this), interest);
        }

        // ── Mint new NFT ──────────────────────────
        newDepositId = nextDepositId++;
        _mint(msg.sender, newDepositId);

        uint256 newMaturityAt = block.timestamp + newPlan.tenorDays * 1 days;

        deposits[newDepositId] = Deposit({
            planId: newPlanId,
            principal: newPrincipal,
            startAt: block.timestamp,
            maturityAt: newMaturityAt,
            aprBpsAtOpen: newPlan.aprBps,
            penaltyBpsAtOpen: newPlan.earlyWithdrawPenaltyBps,
            tenorDays: newPlan.tenorDays,
            status: DepositStatus.Active
        });

        emit Renewed(depositId, newDepositId, newPrincipal, newPlanId);
    }

    // ══════════════════════════════════════════════
    //  Bot — Auto Renew
    // ══════════════════════════════════════════════

    /**
     * @notice Auto-renew a deposit after the grace period expires.
     * @dev Rules (updated per teacher requirements):
     *  - Same tenor as the original deposit.
     *  - Teacher-Rule Fix APR: uses CURRENT plan APR & penalty (not original snapshot)
     *    to reflect market changes.
     *  - Teacher-Rule Max Deposit: reverts if newPrincipal > plan.maxDeposit.
     *  - New principal = old principal + interest.
     *  - Can only be triggered after maturityAt + GRACE_PERIOD.
     * @param depositId ID of the matured deposit.
     * @return newDepositId The minted NFT tokenId for the renewed deposit.
     */
    function autoRenewDeposit(
        uint256 depositId
    ) external whenNotPaused returns (uint256 newDepositId) {
        Deposit storage dep = deposits[depositId];
        if (dep.status != DepositStatus.Active) revert DepositNotActive(depositId);
        if (block.timestamp < dep.maturityAt + GRACE_PERIOD) {
            revert GracePeriodNotElapsed(depositId);
        }

        address depositOwner = ownerOf(depositId);

        // @Teacher-Rule Fix APR: load current plan rates for the new deposit
        SavingPlan storage plan = plans[dep.planId];

        // ── Calculate interest on old deposit (using OLD snapshot APR) ─────
        uint256 tenorSeconds = dep.tenorDays * 1 days;
        uint256 interest = (dep.principal * dep.aprBpsAtOpen * tenorSeconds)
            / (SECONDS_PER_YEAR * BPS_DENOMINATOR);

        uint256 newPrincipal = dep.principal + interest;

        // @Teacher-Rule Max Deposit: prevent compounding past plan limit
        if (plan.maxDeposit > 0 && newPrincipal > plan.maxDeposit) {
            revert AboveMaxDeposit(newPrincipal, plan.maxDeposit);
        }

        // ── Close old deposit ─────────────────────
        dep.status = DepositStatus.AutoRenewed;

        // ── Request interest from vault ───────────
        if (interest > 0) {
            vaultManager.requestInterest(address(this), interest);
        }

        // ── Mint new NFT to the original owner ────
        newDepositId = nextDepositId++;
        _mint(depositOwner, newDepositId);

        uint256 newMaturityAt = block.timestamp + dep.tenorDays * 1 days;

        // @Teacher-Rule Fix APR: snapshot CURRENT plan APR & penalty (not original)
        deposits[newDepositId] = Deposit({
            planId: dep.planId,
            principal: newPrincipal,
            startAt: block.timestamp,
            maturityAt: newMaturityAt,
            aprBpsAtOpen: plan.aprBps,                    // ← CURRENT plan APR
            penaltyBpsAtOpen: plan.earlyWithdrawPenaltyBps, // ← CURRENT plan penalty
            tenorDays: dep.tenorDays,                     // ← same tenor
            status: DepositStatus.Active
        });

        emit Renewed(depositId, newDepositId, newPrincipal, dep.planId);
    }

    // ══════════════════════════════════════════════
    //  View helpers
    // ══════════════════════════════════════════════

    /**
     * @notice Calculate the interest earned on a deposit (simple interest).
     * @param depositId The deposit / NFT token ID.
     * @return interest The calculated interest amount.
     */
    function calculateInterest(uint256 depositId) external view returns (uint256) {
        Deposit storage dep = deposits[depositId];
        uint256 tenorSeconds = dep.tenorDays * 1 days;
        return (dep.principal * dep.aprBpsAtOpen * tenorSeconds)
            / (SECONDS_PER_YEAR * BPS_DENOMINATOR);
    }

    /**
     * @notice Get full deposit information.
     * @param depositId The deposit / NFT token ID.
     */
    function getDeposit(uint256 depositId) external view returns (Deposit memory) {
        return deposits[depositId];
    }

    /**
     * @notice Get full plan information.
     * @param planId The plan ID.
     */
    function getPlan(uint256 planId) external view returns (SavingPlan memory) {
        return plans[planId];
    }
}
