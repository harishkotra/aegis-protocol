// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title AegisPact
 * @dev Single-asset Dead Man's Switch.
 * Owner must check in within checkInInterval, otherwise the trusted warden
 * can recover ERC20 tokens (and any ETH) to the beneficiary.
 *
 * Note: constructor now accepts an explicit _owner address so a factory can
 * deploy pacts on behalf of users while assigning ownership correctly.
 */
contract AegisPact is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- State Variables ---

    address public immutable owner;
    address public immutable beneficiary;
    address public immutable warden; // The address of our backend AI agent

    uint256 public lastCheckIn; // Timestamp of the last owner check-in
    uint256 public immutable checkInInterval; // The required duration between check-ins

    IERC20 public immutable protectedToken; // The ERC20 token this pact protects

    // --- Events ---
    event CheckedIn(uint256 timestamp);
    event AssetsRecovered(uint256 amount); // ERC20 recovered
    event AssetsRecoveredETH(uint256 amount); // ETH recovered

    // --- Errors ---
    error NotOwner();
    error NotWarden();
    error CheckInPeriodNotElapsed();
    error ZeroAddressNotAllowed();
    error ZeroIntervalNotAllowed();

    // --- Modifiers ---
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyWarden() {
        if (msg.sender != warden) revert NotWarden();
        _;
    }

    /**
     * @notice Construct a pact.
     * @param _owner The owner (user) of this pact. MUST be non-zero.
     * @param _beneficiary The address to receive the assets upon inactivity. MUST be non-zero.
     * @param _warden The trusted AI agent address that can trigger the recovery. MUST be non-zero.
     * @param _checkInInterval The time in seconds the owner has to check in. MUST be > 0.
     * @param _protectedToken The address of the ERC20 token to safeguard. MUST be non-zero.
     */
    constructor(
        address _owner,
        address _beneficiary,
        address _warden,
        uint256 _checkInInterval,
        address _protectedToken
    ) {
        if (_owner == address(0) || _beneficiary == address(0) || _warden == address(0) || _protectedToken == address(0)) {
            revert ZeroAddressNotAllowed();
        }
        if (_checkInInterval == 0) {
            revert ZeroIntervalNotAllowed();
        }

        owner = _owner;
        beneficiary = _beneficiary;
        warden = _warden;
        checkInInterval = _checkInInterval;
        lastCheckIn = block.timestamp; // initial check-in at deployment
        protectedToken = IERC20(_protectedToken);

        emit CheckedIn(block.timestamp);
    }

    /**
     * @dev Allows the owner to signal their activity, resetting the inactivity timer.
     */
    function checkIn() external onlyOwner {
        lastCheckIn = block.timestamp;
        emit CheckedIn(block.timestamp);
    }

    /**
     * @dev Allows the warden to recover the assets for the beneficiary
     * if the check-in period has elapsed. Transfers both protected ERC20 balance
     * and any ETH balance to the beneficiary.
     *
     * Protected by nonReentrant to avoid reentrancy during transfers.
     */
    function recoverAssets() external onlyWarden nonReentrant {
        if (block.timestamp < lastCheckIn + checkInInterval) {
            revert CheckInPeriodNotElapsed();
        }

        uint256 tokenBalance = protectedToken.balanceOf(address(this));
        if (tokenBalance > 0) {
            protectedToken.safeTransfer(beneficiary, tokenBalance);
            emit AssetsRecovered(tokenBalance);
        }

        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool success, ) = payable(beneficiary).call{value: ethBalance}("");
            require(success, "ETH transfer failed");
            emit AssetsRecoveredETH(ethBalance);
        }
    }

    /**
     * @dev Allow contract to receive ETH.
     */
    receive() external payable {}

    fallback() external payable {}
}