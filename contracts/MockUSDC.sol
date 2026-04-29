// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice A mock USDC token for testing the Online Banking System.
 * @dev Uses 6 decimals to match the real USDC standard.
 *      The mint function is public so anyone can mint in a test environment.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    /**
     * @notice Returns 6 decimals, matching the real USDC token.
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @notice Mint tokens to any address (for testing only).
     * @param to   The address to receive minted tokens.
     * @param amount The amount of tokens (in smallest unit, 1 USDC = 1_000_000).
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
