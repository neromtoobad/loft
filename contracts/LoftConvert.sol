// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Turns USDC that arrived on a Loft address (for example from another
/// chain through Aurora Intents) into AUSD, gaslessly. The owner signs one
/// EIP-3009 ReceiveWithAuthorization for the USDC; the relayer submits it; the
/// USDC is swapped in a Trader Joe Liquidity Book pair and the AUSD lands back
/// on the owner's address in the same transaction. The contract never holds
/// funds between calls.
interface IERC3009 {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface ILBPair {
    function getTokenX() external view returns (address);
    function getTokenY() external view returns (address);
    function swap(bool swapForY, address to) external returns (bytes32 amountsOut);
}

contract LoftConvert {
    IERC3009 public immutable usdc;
    IERC3009 public immutable ausd;
    ILBPair public immutable pair;
    /// True when USDC is the pair's token X, so selling it means swapping for Y.
    bool public immutable usdcIsX;

    event Converted(address indexed owner, uint256 usdcIn, uint256 ausdOut, bytes32 salt);

    error WrongPair();
    error Slippage(uint256 out, uint256 minOut);

    constructor(IERC3009 usdc_, IERC3009 ausd_, ILBPair pair_) {
        address x = pair_.getTokenX();
        address y = pair_.getTokenY();
        if (!((x == address(usdc_) && y == address(ausd_)) || (x == address(ausd_) && y == address(usdc_)))) revert WrongPair();
        usdc = usdc_;
        ausd = ausd_;
        pair = pair_;
        usdcIsX = x == address(usdc_);
    }

    /// @notice The EIP-3009 nonce the owner signs. It commits to the minimum
    /// AUSD out, so nobody relaying the signature can loosen the price.
    function convertNonce(address owner, uint256 amount, uint256 minOut, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), "convert", owner, amount, minOut, salt));
    }

    function convert(
        address owner,
        uint256 amount,
        uint256 minOut,
        bytes32 salt,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 out) {
        // receiveWithAuthorization only pays msg.sender, so the signature
        // can't be lifted and pointed anywhere else.
        usdc.receiveWithAuthorization(owner, address(this), amount, 0, validBefore, convertNonce(owner, amount, minOut, salt), v, r, s);
        usdc.transfer(address(pair), amount);
        uint256 before = ausd.balanceOf(owner);
        pair.swap(usdcIsX, owner);
        out = ausd.balanceOf(owner) - before;
        if (out < minOut) revert Slippage(out, minOut);
        emit Converted(owner, amount, out, salt);
    }
}
