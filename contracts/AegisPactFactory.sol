// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AegisPact.sol";

/**
 * @title AegisPactFactory
 * @dev Deploys and tracks AegisPact contracts for users.
 */
contract AegisPactFactory {
    // --- State Variables ---

    // The single trusted address for the AI Warden agent.
    address public immutable warden;

    // A list of all pacts created by this factory.
    address[] public deployedPacts;

    // Mapping to track pacts by owner for on-chain discovery.
    mapping(address => address[]) public pactsOf;

    // --- Events ---
    event PactCreated(address indexed owner, address indexed pactAddress, address indexed beneficiary);

    // --- Constructor ---
    constructor(address _warden) {
        if (_warden == address(0)) {
            // Reuse error type defined on AegisPact for consistency
            revert AegisPact.ZeroAddressNotAllowed();
        }
        warden = _warden;
    }

    /**
     * @dev Creates and deploys a new AegisPact contract for the caller.
     * @param _beneficiary The user's chosen beneficiary address (non-zero).
     * @param _checkInInterval The user's chosen check-in interval in seconds (must be > 0).
     * @param _protectedToken The address of the ERC20 token to protect (non-zero).
     * @return pactAddress The address of the newly created pact contract.
     */
    function createPact(
        address _beneficiary,
        uint256 _checkInInterval,
        address _protectedToken
    ) external returns (address pactAddress) {
        // Validate inputs up-front to avoid wasted gas on failed constructor
        if (_beneficiary == address(0) || _protectedToken == address(0)) {
            revert AegisPact.ZeroAddressNotAllowed();
        }
        if (_checkInInterval == 0) {
            revert AegisPact.ZeroIntervalNotAllowed();
        }

        // Deploy new AegisPact with msg.sender as the owner
        AegisPact newPact = new AegisPact(
            msg.sender,        // owner
            _beneficiary,
            warden,
            _checkInInterval,
            _protectedToken
        );

        pactAddress = address(newPact);

        // Store and index
        deployedPacts.push(pactAddress);
        pactsOf[msg.sender].push(pactAddress);

        emit PactCreated(msg.sender, pactAddress, _beneficiary);
        return pactAddress;
    }

    /**
     * @dev Helper function to get the number of pacts created overall.
     */
    function getPactCount() external view returns (uint256) {
        return deployedPacts.length;
    }

    /**
     * @dev Helper: get pacts for an owner (on-chain).
     */
    function getPactsOf(address _owner) external view returns (address[] memory) {
        return pactsOf[_owner];
    }
}