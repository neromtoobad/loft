// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// Agora's AUSD implements EIP-3009 and ERC-2612, which is what lets every
/// Loft flow be gasless for the people sending and receiving money.
interface IAUSD {
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

    function balanceOf(address account) external view returns (uint256);
}

/// @title LoftEscrow
/// @notice Holds AUSD for two things a remittance needs that a plain transfer
/// can't do: claim links for people who don't have an account yet, and
/// prepaid standing orders that Chainlink CRE releases on schedule.
///
/// Every deposit goes through `receiveWithAuthorization`, and the EIP-3009
/// nonce the sender signs is derived from the deposit's parameters. A relayer
/// can therefore submit the deposit but cannot change who it is for, when it
/// expires, or how it is paid out.
contract LoftEscrow {
    IAUSD public immutable ausd;
    address public immutable owner;

    /// Chainlink CRE forwarders allowed to deliver reports, plus any keeper
    /// the owner trusts as a fallback.
    mapping(address => bool) public isReporter;

    // ---------------------------------------------------------------- sends

    /// A direct payment between two people. `ref` is the hash of the sealed
    /// note that travels with it (or a random value when there is none), so
    /// the note a recipient reads can be checked against the chain.
    event Sent(address indexed from, address indexed to, uint256 amount, bytes32 indexed ref);

    // ---------------------------------------------------------------- links

    struct Link {
        address sender;
        uint96 amount;
        uint40 expiry;
    }

    /// Keyed by the claim key's address. The link's private key travels in
    /// the URL fragment and never reaches a server.
    mapping(address => Link) public links;

    event LinkCreated(address indexed claimKey, address indexed sender, uint256 amount, uint256 expiry);
    event LinkClaimed(address indexed claimKey, address indexed sender, address indexed recipient, uint256 amount);
    event LinkRefunded(address indexed claimKey, address indexed sender, uint256 amount);

    // --------------------------------------------------------------- orders

    enum Mode {
        Fixed, // send `amount` every period
        TopUp // bring the recipient's balance up to `amount` every period
    }

    struct Order {
        address sender;
        address recipient;
        uint96 amount;
        uint96 budget; // AUSD still held for this order
        uint40 nextDue;
        uint32 period;
        Mode mode;
    }

    Order[] public orders;

    event OrderCreated(
        uint256 indexed orderId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 budget,
        uint256 firstDue,
        uint256 period,
        Mode mode
    );
    /// `ngnPerUsd` is the naira rate the DON agreed on, with 6 decimals, so a
    /// receipt can say what the transfer was worth where it landed.
    event Remitted(
        uint256 indexed orderId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 ngnPerUsd
    );
    event OrderSkipped(uint256 indexed orderId, uint256 ngnPerUsd);
    event OrderClosed(uint256 indexed orderId, address indexed sender, uint256 refunded);
    event ReporterSet(address indexed reporter, bool allowed);

    error NotOwner();
    error NotReporter();
    error LinkExists();
    error NoLink();
    error BadExpiry();
    error BadSignature();
    error NotExpired();
    error BadOrder();
    error OrderInactive();

    constructor(IAUSD ausd_, address forwarder) {
        ausd = ausd_;
        owner = msg.sender;
        if (forwarder != address(0)) {
            isReporter[forwarder] = true;
            emit ReporterSet(forwarder, true);
        }
    }

    function setReporter(address reporter, bool allowed) external {
        if (msg.sender != owner) revert NotOwner();
        isReporter[reporter] = allowed;
        emit ReporterSet(reporter, allowed);
    }

    // ================================================================ sends

    /// The EIP-3009 nonce a sender signs for a direct payment.
    function sendNonce(address to, bytes32 ref) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), "send", to, ref));
    }

    /// Pays `to` straight away. It passes through the escrow only so the
    /// payment is recognisably a Loft one onchain.
    function send(
        address from,
        address to,
        uint96 amount,
        uint256 validBefore,
        bytes32 ref,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        ausd.receiveWithAuthorization(from, address(this), amount, 0, validBefore, sendNonce(to, ref), v, r, s);
        ausd.transfer(to, amount);
        emit Sent(from, to, amount, ref);
    }

    // ================================================================ links

    /// The EIP-3009 nonce a sender signs to fund a link.
    function linkNonce(address claimKey, uint40 expiry) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), "link", claimKey, expiry));
    }

    /// The message a claim key signs to release a link to `recipient`.
    function claimDigest(address claimKey, address recipient) public view returns (bytes32) {
        bytes32 inner = keccak256(abi.encode(address(this), block.chainid, claimKey, recipient));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
    }

    function createLink(
        address sender,
        uint96 amount,
        uint256 validBefore,
        address claimKey,
        uint40 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (links[claimKey].sender != address(0)) revert LinkExists();
        if (expiry <= block.timestamp) revert BadExpiry();
        ausd.receiveWithAuthorization(
            sender, address(this), amount, 0, validBefore, linkNonce(claimKey, expiry), v, r, s
        );
        links[claimKey] = Link(sender, amount, expiry);
        emit LinkCreated(claimKey, sender, amount, expiry);
    }

    /// Anyone may submit this, since the claim key's signature fixes the
    /// recipient. The sender can cancel a link by claiming it to themselves.
    function claim(address claimKey, address recipient, uint8 v, bytes32 r, bytes32 s) external {
        Link memory link = links[claimKey];
        if (link.amount == 0) revert NoLink();
        if (ecrecover(claimDigest(claimKey, recipient), v, r, s) != claimKey) revert BadSignature();
        links[claimKey].amount = 0;
        ausd.transfer(recipient, link.amount);
        emit LinkClaimed(claimKey, link.sender, recipient, link.amount);
    }

    /// After expiry anyone can send an unclaimed link back to its sender.
    function refund(address claimKey) external {
        Link memory link = links[claimKey];
        if (link.amount == 0) revert NoLink();
        if (block.timestamp < link.expiry) revert NotExpired();
        links[claimKey].amount = 0;
        ausd.transfer(link.sender, link.amount);
        emit LinkRefunded(claimKey, link.sender, link.amount);
    }

    // =============================================================== orders

    /// The EIP-3009 nonce a sender signs to prepay a standing order.
    function orderNonce(
        address recipient,
        uint96 amount,
        uint96 budget,
        uint40 firstDue,
        uint32 period,
        Mode mode,
        bytes32 salt
    ) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), "order", recipient, amount, budget, firstDue, period, mode, salt));
    }

    function createOrder(
        address sender,
        address recipient,
        uint96 amount,
        uint96 budget,
        uint40 firstDue,
        uint32 period,
        Mode mode,
        bytes32 salt,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 orderId) {
        if (recipient == address(0) || amount == 0 || budget < amount || period == 0) revert BadOrder();
        ausd.receiveWithAuthorization(
            sender,
            address(this),
            budget,
            0,
            validBefore,
            orderNonce(recipient, amount, budget, firstDue, period, mode, salt),
            v,
            r,
            s
        );
        orderId = orders.length;
        orders.push(Order(sender, recipient, amount, budget, firstDue, period, mode));
        emit OrderCreated(orderId, sender, recipient, amount, budget, firstDue, period, mode);
    }

    /// The message a sender signs to close an order and take back its budget.
    function closeDigest(uint256 orderId) public view returns (bytes32) {
        bytes32 inner = keccak256(abi.encode(address(this), block.chainid, "close", orderId));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
    }

    function closeOrder(uint256 orderId, uint8 v, bytes32 r, bytes32 s) external {
        Order storage order = orders[orderId];
        if (order.budget == 0) revert OrderInactive();
        if (ecrecover(closeDigest(orderId), v, r, s) != order.sender) revert BadSignature();
        _close(orderId, order);
    }

    /// Orders a report may act on right now. Bounded so a CRE EVM read stays
    /// cheap no matter how many orders exist.
    function dueOrders(uint256 start, uint256 limit) external view returns (uint256[] memory ids) {
        uint256 end = start + limit;
        if (end > orders.length) end = orders.length;
        uint256[] memory buf = new uint256[](end > start ? end - start : 0);
        uint256 n;
        for (uint256 i = start; i < end; i++) {
            Order storage order = orders[i];
            if (order.budget > 0 && order.nextDue <= block.timestamp) buf[n++] = i;
        }
        ids = new uint256[](n);
        for (uint256 i; i < n; i++) ids[i] = buf[i];
    }

    function ordersLength() external view returns (uint256) {
        return orders.length;
    }

    /// Chainlink CRE entry point, called by the KeystoneForwarder with the
    /// workflow's signed report: `abi.encode(uint256[] orderIds, uint256 ngnPerUsd)`.
    function onReport(bytes calldata, bytes calldata report) external {
        if (!isReporter[msg.sender]) revert NotReporter();
        (uint256[] memory ids, uint256 ngnPerUsd) = abi.decode(report, (uint256[], uint256));
        for (uint256 i; i < ids.length; i++) {
            _execute(ids[i], ngnPerUsd);
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        // IReceiver (onReport) and IERC165
        return interfaceId == 0x805f2132 || interfaceId == 0x01ffc9a7;
    }

    function _execute(uint256 orderId, uint256 ngnPerUsd) internal {
        if (orderId >= orders.length) return;
        Order storage order = orders[orderId];
        // A late or duplicate report must not pay twice, so anything not yet
        // due is skipped rather than reverting the whole batch.
        if (order.budget == 0 || order.nextDue > block.timestamp) return;

        uint256 payout = order.amount;
        if (order.mode == Mode.TopUp) {
            uint256 balance = ausd.balanceOf(order.recipient);
            payout = balance >= order.amount ? 0 : order.amount - balance;
        }
        if (payout > order.budget) payout = order.budget;

        order.nextDue += order.period;
        if (payout == 0) {
            emit OrderSkipped(orderId, ngnPerUsd);
            return;
        }
        order.budget -= uint96(payout);
        ausd.transfer(order.recipient, payout);
        emit Remitted(orderId, order.sender, order.recipient, payout, ngnPerUsd);
        if (order.budget == 0) emit OrderClosed(orderId, order.sender, 0);
    }

    function _close(uint256 orderId, Order storage order) internal {
        uint256 refunded = order.budget;
        order.budget = 0;
        ausd.transfer(order.sender, refunded);
        emit OrderClosed(orderId, order.sender, refunded);
    }
}
