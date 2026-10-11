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
/// @notice Holds AUSD for what a remittance needs that a plain transfer can't
/// do: claim links for people who don't have an account yet, prepaid standing
/// orders that Chainlink CRE releases on schedule (optionally only once the
/// naira rate reaches a floor), and family pots that several people pay into
/// for one person.
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
        /// NGN per USD (6 decimals) the DON's rate must reach before this pays.
        /// Zero means pay on schedule whatever the rate.
        uint64 minRate;
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
        Mode mode,
        uint256 minRate
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

    // ----------------------------------------------------------------- pots

    /// Several people paying in for one person: Mum's rent, a school term, a
    /// hospital bill. It pays out the moment it reaches its target, or on the
    /// deadline with whatever was raised.
    struct Pot {
        address beneficiary;
        uint40 deadline;
        bool released;
        address organizer;
        uint96 target;
        uint96 raised;
    }

    Pot[] public pots;

    event PotCreated(
        uint256 indexed potId, address indexed organizer, address indexed beneficiary, uint256 target, uint256 deadline
    );
    event PotContributed(uint256 indexed potId, address indexed from, uint256 amount, bytes32 ref);
    event PotReleased(uint256 indexed potId, address indexed beneficiary, uint256 amount);

    error NotOwner();
    error NotReporter();
    error LinkExists();
    error NoLink();
    error BadExpiry();
    error BadSignature();
    error NotExpired();
    error BadOrder();
    error OrderInactive();
    error BadPot();
    error PotClosed();
    error PotNotDue();

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
        uint64 minRate,
        bytes32 salt
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(address(this), "order", recipient, amount, budget, firstDue, period, mode, minRate, salt)
        );
    }

    function createOrder(
        address sender,
        address recipient,
        uint96 amount,
        uint96 budget,
        uint40 firstDue,
        uint32 period,
        Mode mode,
        uint64 minRate,
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
            orderNonce(recipient, amount, budget, firstDue, period, mode, minRate, salt),
            v,
            r,
            s
        );
        orderId = orders.length;
        orders.push(Order(sender, recipient, amount, budget, firstDue, period, mode, minRate));
        emit OrderCreated(orderId, sender, recipient, amount, budget, firstDue, period, mode, minRate);
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
    /// workflow's signed report:
    /// `abi.encode(uint256[] orderIds, uint256 ngnPerUsd, uint256[] potIds)`.
    function onReport(bytes calldata, bytes calldata report) external {
        if (!isReporter[msg.sender]) revert NotReporter();
        (uint256[] memory ids, uint256 ngnPerUsd, uint256[] memory potIds) =
            abi.decode(report, (uint256[], uint256, uint256[]));
        for (uint256 i; i < ids.length; i++) {
            _execute(ids[i], ngnPerUsd);
        }
        for (uint256 i; i < potIds.length; i++) {
            Pot storage pot = pots[potIds[i]];
            // Same rule as releasePot, but a stale id is skipped, not fatal.
            if (!pot.released && block.timestamp >= pot.deadline) _release(potIds[i], pot);
        }
    }

    // ================================================================= pots

    /// What an organizer signs to open a pot, so nobody can open one in their name.
    function potDigest(address beneficiary, uint96 target, uint40 deadline, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        bytes32 inner = keccak256(abi.encode(address(this), block.chainid, "pot", beneficiary, target, deadline, salt));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
    }

    function createPot(
        address organizer,
        address beneficiary,
        uint96 target,
        uint40 deadline,
        bytes32 salt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 potId) {
        if (beneficiary == address(0) || target == 0 || deadline <= block.timestamp) revert BadPot();
        if (ecrecover(potDigest(beneficiary, target, deadline, salt), v, r, s) != organizer) revert BadSignature();
        potId = pots.length;
        pots.push(Pot(beneficiary, deadline, false, organizer, target, 0));
        emit PotCreated(potId, organizer, beneficiary, target, deadline);
    }

    /// The EIP-3009 nonce a contributor signs. `ref` makes each contribution
    /// unique and carries the hash of the note that comes with it.
    function potNonce(uint256 potId, bytes32 ref) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), "pot", potId, ref));
    }

    function contribute(
        uint256 potId,
        address from,
        uint96 amount,
        uint256 validBefore,
        bytes32 ref,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (potId >= pots.length) revert BadPot();
        Pot storage pot = pots[potId];
        if (pot.released || block.timestamp >= pot.deadline) revert PotClosed();
        ausd.receiveWithAuthorization(from, address(this), amount, 0, validBefore, potNonce(potId, ref), v, r, s);
        pot.raised += amount;
        emit PotContributed(potId, from, amount, ref);
        if (pot.raised >= pot.target) _release(potId, pot);
    }

    /// After the deadline anyone may release a pot to its beneficiary.
    function releasePot(uint256 potId) external {
        if (potId >= pots.length) revert BadPot();
        Pot storage pot = pots[potId];
        if (pot.released) revert PotClosed();
        if (block.timestamp < pot.deadline) revert PotNotDue();
        _release(potId, pot);
    }

    /// Pots past their deadline and not yet paid out, for the CRE workflow.
    function duePots(uint256 start, uint256 limit) external view returns (uint256[] memory ids) {
        uint256 end = start + limit;
        if (end > pots.length) end = pots.length;
        uint256[] memory buf = new uint256[](end > start ? end - start : 0);
        uint256 n;
        for (uint256 i = start; i < end; i++) {
            Pot storage pot = pots[i];
            if (!pot.released && block.timestamp >= pot.deadline) buf[n++] = i;
        }
        ids = new uint256[](n);
        for (uint256 i; i < n; i++) ids[i] = buf[i];
    }

    function potsLength() external view returns (uint256) {
        return pots.length;
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
        // Waiting for a better rate: stay due, and try again on the next report.
        if (order.minRate > 0 && ngnPerUsd < order.minRate) return;

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

    function _release(uint256 potId, Pot storage pot) internal {
        pot.released = true;
        uint256 amount = pot.raised;
        if (amount > 0) ausd.transfer(pot.beneficiary, amount);
        emit PotReleased(potId, pot.beneficiary, amount);
    }

    function _close(uint256 orderId, Order storage order) internal {
        uint256 refunded = order.budget;
        order.budget = 0;
        ausd.transfer(order.sender, refunded);
        emit OrderClosed(orderId, order.sender, refunded);
    }
}
