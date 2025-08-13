// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "src/BaseOption.sol";
import "src/OptionFactory.sol";
import "src/beacon/MarketMakerBeacon.sol";

/**
 * @title OptionBook
 * @dev A decentralized limit order book for options trading that complements OptionFactory
 *
 * Key Features:
 * 1. Standing Orders: Makers post signed orders that takers can execute against
 * 2. Efficient Grouping: Orders are grouped by collateral type and direction (long/short)
 * 3. Short Duration Protection: Orders expire quickly (30-60s) to prevent stale prices
 * 4. Partial Fills: Takers can partially fill orders up to maker's max collateral
 * 5. EIP-712 Signing: Prevents cross-chain replay and provides human-readable orders
 * 6. Implementation Agnostic: No whitelist, allowing frontend-based verification
 *
 * Order Lifecycle:
 * 1. Maker signs order parameters (excluding numContracts for partial fills)
 * 2. Order is stored off-chain until filled or expired
 * 3. Taker submits order with signature and desired numContracts
 * 4. Contract validates and executes the trade
 *
 * Nonce Design:
 * - Computed from maker + core parameters (collateral, direction, etc.)
 * - Groups related offers together for efficient tracking
 * - Natural expiry through orderExpiryTimestamp
 * - Tracks remaining collateral/premium available for the order set
 *
 * Fee Structure:
 * - Matches OptionFactory (0.06% base rate of numContracts)
 * - Fees deducted entirely from premium (priced into maker's offer)
 * - For quote collateral (e.g., USDC), fee adjusted by asset price
 * - For base collateral (e.g., ETH), fee calculated directly
 *
 * Security Considerations:
 * 1. No pre-deposits required - assets checked at execution
 * 2. Implementation verification delegated to frontends
 * 3. Short order expiry prevents stale prices
 * 4. Partial fills limited by maxCollateralUsable
 *
 * @notice This contract allows market makers to create standing orders that
 * anyone can take, with efficient tracking and settlement
 */
contract OptionBook is EIP712 {
    using ECDSA for bytes32;
    using Clones for address;
    using SafeERC20 for IERC20;

    // Type hashes for EIP-712 signing
    bytes32 public constant LIMIT_ORDER_TYPEHASH = keccak256(
        "Order(address maker,uint256 orderExpiryTimestamp,address collateral,bool isCall,address priceFeed,address implementation,bool isLong,uint256 maxCollateralUsable,uint256[] strikes,uint256 expiry,uint256 price)"
    );

    // State variables
    mapping(uint256 => uint256) public amountFilled; // nonce => amount filled

    OptionFactory public immutable factory;
    uint256 public constant PRICE_DECIMALS = 1e8;

    // Events
    event OrderFilled(
        uint256 indexed nonce, address indexed maker, address indexed token, address optionAddress, uint256 amount
    );
    event OrderCancelled(uint256 indexed nonce, address indexed maker);

    struct Order {
        address maker;
        uint256 orderExpiryTimestamp;
        address collateral;
        bool isCall;
        address priceFeed;
        address implementation;
        bool isLong;
        uint256 maxCollateralUsable;
        uint256[] strikes;
        uint256 expiry;
        uint256 price;
        uint256 numContracts;
    }

    constructor(address _factory) EIP712("OptionBook", "1.0") {
        factory = OptionFactory(_factory);
    }

    /**
     * @dev Computes the nonce for an order set
     * @param order The order parameters
     * @return The computed nonce
     * @notice Nonce groups related offers by maker, collateral, and direction
     * Each nonce represents a set of orders with shared maxCollateralUsable
     */
    function computeNonce(Order memory order) public pure returns (uint256) {
        return uint256(
            keccak256(
                abi.encode(
                    order.maker,
                    order.orderExpiryTimestamp,
                    order.collateral,
                    order.isCall,
                    order.priceFeed,
                    order.implementation,
                    order.isLong,
                    order.maxCollateralUsable
                )
            )
        );
    }

    function hashOrder(Order memory order) public view returns (bytes32) {
        bytes32 strikesHash = keccak256(abi.encodePacked(order.strikes));

        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LIMIT_ORDER_TYPEHASH,
                    order.maker,
                    order.orderExpiryTimestamp,
                    order.collateral,
                    order.isCall,
                    order.priceFeed,
                    order.implementation,
                    order.isLong,
                    order.maxCollateralUsable,
                    strikesHash,
                    order.expiry,
                    order.price
                )
            )
        );
    }

    /**
     * @dev Fills an order (partial fills allowed)
     * @param order The order parameters including maker's signed parameters and taker's numContracts
     * @param signature The maker's EIP-712 signature
     * @notice numContracts is not part of signed data to enable partial fills
     * Fills are limited by maxCollateralUsable tracked per nonce
     */
    function fillOrder(Order calldata order, bytes calldata signature) public returns (address optionAddress) {
        // Validate order and get nonce
        uint256 nonce = _validateOrder(order, signature);

        // Create option contract and handle transfers
        optionAddress = _createOption(order, nonce);
    }
    function swapAndFillOrder(
        Order calldata order, 
        bytes calldata signature, 
        address swapRouter, 
        bytes calldata swapData
    ) external returns (address optionAddress) {
        // Validate router is whitelisted
        require(factory.authorizedRouters(swapRouter), "Router not authorized");
        
        // Execute swap through router
        (bool success,) = swapRouter.call(swapData);
        require(success, "Swap failed");

        return fillOrder(order, signature);
    }

    function _validateOrder(Order calldata order, bytes calldata signature) internal view returns (uint256) {
        // Compute nonce and validate basic order params
        uint256 nonce = computeNonce(order);
        require(block.timestamp <= order.orderExpiryTimestamp, "Order expired");
        require(amountFilled[nonce] != type(uint256).max, "Order cancelled");

        // Verify signature
        bytes32 orderHash = hashOrder(order);
        address recoveredSigner = orderHash.recover(signature);

        // Allow either the maker itself or an authorized operator
        if (recoveredSigner != order.maker) {
            require(order.maker.code.length > 0, "Signer not authorized");
            require(
                MarketMakerBeacon(order.maker).hasRole(MarketMakerBeacon(order.maker).OPERATOR_ROLE(), recoveredSigner),
                "Contract owner not authorized"
            );
        }

        return nonce;
    }

    /**
     * @dev Validates collateral or premium usage against nonce limits
     * @param nonce The order set nonce
     * @param collateralOrPremiumAmount Amount being used (collateral if short, premium if long)
     * @param maxCollateralUsable Maximum amount allowed for this nonce
     * @notice Tracks different amounts based on order direction:
     * - For maker shorts: tracks collateral used
     * - For maker longs: tracks premium used
     */
    function _validateCollateralLimits(uint256 nonce, uint256 collateralOrPremiumAmount, uint256 maxCollateralUsable)
        internal
    {
        uint256 currentFilled = amountFilled[nonce];
        require(currentFilled + collateralOrPremiumAmount <= maxCollateralUsable, "Exceeds max collateral");
        amountFilled[nonce] = currentFilled + collateralOrPremiumAmount;
    }

    /**
     * @dev Creates option contract and handles asset transfers
     * @param order The order parameters
     * @param nonce The computed nonce
     * @notice Handles both maker long and short scenarios:
     * - Maker long: maker pays premium, taker provides collateral
     * - Maker short: maker provides collateral, taker pays premium
     * Fees are always deducted from premium amount
     */
    function _createOption(Order calldata order, uint256 nonce) internal returns (address optionAddress) {
        // Create option contract
        optionAddress = order.implementation.clone();
        BaseOption option = BaseOption(optionAddress);

        // Calculate amounts based on whether maker is long or short
        uint256 collateralAmount;
        uint256 premiumAmount = (order.price * order.numContracts) / PRICE_DECIMALS;

        collateralAmount =
            BaseOption(order.implementation).calculateRequiredCollateral(order.strikes, order.numContracts);

        // Validate against collateral limits
        _validateCollateralLimits(nonce, !order.isLong ? collateralAmount : premiumAmount, order.maxCollateralUsable);

        // Calculate fees
        (bool isQuoteCollateral,,,) = BaseOption(order.implementation).unpackOptionType();
        uint256 fee;
        if (isQuoteCollateral) {
            (, int256 price,, uint256 updatedAt,) = AggregatorProxy(order.priceFeed).latestRoundData();
            if (price <= 0) revert OptionFactory.PriceMustBePositive();
            if (updatedAt <= 0) revert OptionFactory.PriceFeedStale();
            if (AggregatorProxy(order.priceFeed).decimals() != 8) revert OptionFactory.InvalidPriceFeedDecimals();
            fee = factory.calculateFee(order.numContracts, premiumAmount, uint256(price));
        } else {
            fee = factory.calculateFee(order.numContracts, premiumAmount, 1e8);
        }

        address longHolder;
        address shortHolder;

        if (order.isLong) {
            // Maker is buying options (long)
            longHolder = order.maker;
            shortHolder = msg.sender;
        } else {
            // Maker is selling options (short)
            longHolder = msg.sender;
            shortHolder = order.maker;
        }

        // Transfer premium from long holder to short holder
        IERC20(order.collateral).safeTransferFrom(longHolder, shortHolder, premiumAmount - fee);

        // Transfer fee from long holder to this contract
        IERC20(order.collateral).safeTransferFrom(longHolder, address(this), fee);

        // Transfer collateral from short holder to this contract
        IERC20(order.collateral).safeTransferFrom(shortHolder, address(this), collateralAmount);

        // Approve collateral transfer from this contract to the option contract
        IERC20(order.collateral).safeApprove(optionAddress, collateralAmount);

        // Initialize option contract
        bytes memory optionData = abi.encode(order.strikes, order.expiry);
        option.initialize(
            BaseOption.OptionParams({
                collateralToken: order.collateral,
                chainlinkPriceFeed: order.priceFeed,
                historicalTWAPConsumer: address(factory.historicalTWAPConsumer()),
                buyer: longHolder,
                seller: shortHolder,
                strikes: order.strikes,
                expiryTimestamp: order.expiry,
                twapPeriod: factory.TWAP_PERIOD(),
                numContracts: order.numContracts,
                collateralAmount: collateralAmount,
                rescueAddress: factory.owner(),
                factoryAddress: address(factory),
                extraOptionData: optionData
            })
        );

        emit OrderFilled(nonce, order.maker, order.collateral, optionAddress, collateralAmount);
    }

    /**
     * @notice Allows a maker to cancel their order
     * @param order The order to cancel
     * @dev Sets the filled amount to max uint256 to mark as cancelled
     */
    function cancelOrder(Order calldata order) external {
        require(msg.sender == order.maker, "Only maker can cancel");
        uint256 nonce = computeNonce(order);
        amountFilled[nonce] = type(uint256).max;
        emit OrderCancelled(nonce, msg.sender);
    }

    /**
     * @notice Allows factory owner to sweep accumulated fees
     * @param token The token address to sweep fees for
     * @dev Sweeps entire token balance since only fees should be present
     * This also allows recovery of any accidentally sent tokens
     */
    function sweepFees(address token) external {
        require(msg.sender == factory.owner(), "Only factory owner can sweep fees");
        IERC20(token).safeTransfer(msg.sender, IERC20(token).balanceOf(address(this)));
    }
}
