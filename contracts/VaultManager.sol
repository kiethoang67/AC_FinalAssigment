// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title VaultManager
 * @notice Manages the liquidity pool (vault) that pays interest to depositors.
 * @dev
 *  - The vault holds tokens separately from principal held in SavingCore.
 *  - Only the linked SavingCore contract may call `requestInterest`.
 *  - The admin (owner) funds/withdraws the vault and controls pause state.
 *  - When paused, interest requests are blocked (SavingCore enforces pause on
 *    its own withdrawals, but the vault adds an extra safety layer).
 */
contract VaultManager is Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    /// @notice The ERC-20 token used by the system (MockUSDC).
    IERC20 public immutable token;

    /// @notice Address that receives early-withdrawal penalty fees.
    address public feeReceiver;

    /// @notice Address of the linked SavingCore contract.
    address public savingCore;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event VaultFunded(address indexed funder, uint256 amount);
    event VaultWithdrawn(address indexed to, uint256 amount);
    event FeeReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event SavingCoreUpdated(address indexed savingCore);
    event InterestPaid(address indexed to, uint256 amount);

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientVaultBalance(uint256 requested, uint256 available);
    error OnlySavingCore();
    error SavingCoreAlreadySet();

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlySavingCore() {
        if (msg.sender != savingCore) revert OnlySavingCore();
        _;
    }

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    /**
     * @param _token       Address of the ERC-20 token (MockUSDC).
     * @param _feeReceiver Initial fee receiver for early-withdrawal penalties.
     */
    constructor(
        address _token,
        address _feeReceiver
    ) Ownable(msg.sender) {
        if (_token == address(0)) revert ZeroAddress();
        if (_feeReceiver == address(0)) revert ZeroAddress();

        token = IERC20(_token);
        feeReceiver = _feeReceiver;
    }

    // ──────────────────────────────────────────────
    //  Admin — Vault funding
    // ──────────────────────────────────────────────

    /**
     * @notice Deposit tokens into the vault to cover future interest payments.
     * @param amount Amount of tokens to deposit (in smallest unit).
     */
    function fundVault(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit VaultFunded(msg.sender, amount);
    }

    /**
     * @notice Withdraw tokens from the vault.
     * @dev Admin should ensure the vault retains enough to cover committed obligations.
     * @param amount Amount of tokens to withdraw.
     */
    function withdrawVault(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        uint256 balance = token.balanceOf(address(this));
        if (amount > balance) {
            revert InsufficientVaultBalance(amount, balance);
        }
        token.safeTransfer(msg.sender, amount);
        emit VaultWithdrawn(msg.sender, amount);
    }

    // ──────────────────────────────────────────────
    //  Admin — Configuration
    // ──────────────────────────────────────────────

    /**
     * @notice Update the fee receiver address.
     * @param _feeReceiver New fee receiver address.
     */
    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        if (_feeReceiver == address(0)) revert ZeroAddress();
        address old = feeReceiver;
        feeReceiver = _feeReceiver;
        emit FeeReceiverUpdated(old, _feeReceiver);
    }

    /**
     * @notice Link the SavingCore contract. Can only be called once.
     * @param _savingCore Address of the SavingCore contract.
     */
    function setSavingCore(address _savingCore) external onlyOwner {
        if (_savingCore == address(0)) revert ZeroAddress();
        if (savingCore != address(0)) revert SavingCoreAlreadySet();
        savingCore = _savingCore;
        emit SavingCoreUpdated(_savingCore);
    }

    // ──────────────────────────────────────────────
    //  Admin — Pause / Unpause
    // ──────────────────────────────────────────────

    /// @notice Pause vault operations (emergency stop).
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause vault operations.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ──────────────────────────────────────────────
    //  SavingCore — Interest payout
    // ──────────────────────────────────────────────

    /**
     * @notice Transfer interest from the vault to a user (best-effort).
     * @dev Only callable by the linked SavingCore contract.
     *      Teacher-Rule Best-Effort Payout: pays min(amount, vaultBalance)
     *      instead of reverting when the vault is short. Returns actual paid.
     * @param to     Recipient of the interest.
     * @param amount Interest amount requested.
     * @return actualPaid The amount actually transferred (may be less than requested).
     */
    function requestInterest(
        address to,
        uint256 amount
    ) external onlySavingCore whenNotPaused returns (uint256 actualPaid) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) return 0; // no-op for zero interest

        uint256 balance = token.balanceOf(address(this));

        // @Teacher-Rule Best-Effort: pay whatever is available, never revert
        actualPaid = amount > balance ? balance : amount;

        if (actualPaid > 0) {
            token.safeTransfer(to, actualPaid);
        }

        emit InterestPaid(to, actualPaid);
    }

    // ──────────────────────────────────────────────
    //  View helpers
    // ──────────────────────────────────────────────

    /// @notice Returns the current vault balance.
    function vaultBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
