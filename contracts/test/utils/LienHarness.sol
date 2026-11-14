// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IReactive} from "reactive-lib/interfaces/IReactive.sol";
import {IPayable} from "reactive-lib/interfaces/IPayable.sol";
import {ISystemContract} from "reactive-lib/interfaces/ISystemContract.sol";
import {ClearingHouse} from "../../src/ClearingHouse.sol";
import {CollateralVault} from "../../src/CollateralVault.sol";
import {CreditMarket} from "../../src/CreditMarket.sol";
import {MockToken} from "../../src/mocks/MockToken.sol";
import {MockPriceFeed} from "../../src/mocks/MockPriceFeed.sol";
import {IERC20Min} from "../../src/interfaces/ILien.sol";
import {MockSystem} from "./MockSystem.sol";

abstract contract LienHarness is Test {
    struct QLog {
        uint256 chainId;
        address emitter;
        bytes32[] topics;
        bytes data;
    }

    address internal constant SYSTEM_ADDR = 0x8888888888888888888888888888888888888888;
    address internal constant BASE_PROXY = 0x476F44b11F5C942c58f4c8E3d0300E5710743585;
    address internal constant UNI_PROXY = 0x775c9B990ADe401060B78D0e98684eEf8d2466C1;
    uint256 internal constant BASE = 84532;
    uint256 internal constant UNI = 1301;
    uint256 internal constant PRICE0 = 2_000e8;

    MockSystem internal sys;
    MockToken internal weth;
    MockToken internal usdc;
    MockPriceFeed internal feed;
    CollateralVault internal vault;
    CreditMarket internal market;
    ClearingHouse internal ch;

    QLog[] internal baseQ;
    QLog[] internal uniQ;
    uint256 internal baseHead;
    uint256 internal uniHead;
    ISystemContract.CallbackConfiguration_V_1_0[] internal cbQ;
    uint256 internal logNonce;

    function setUp() public virtual {
        MockSystem impl = new MockSystem();
        vm.etch(SYSTEM_ADDR, address(impl).code);
        sys = MockSystem(payable(SYSTEM_ADDR));

        weth = new MockToken("Wrapped Ether", "WETH", 18, type(uint256).max);
        usdc = new MockToken("USD Coin", "USDC", 6, type(uint256).max);
        feed = new MockPriceFeed(PRICE0);
        ch = new ClearingHouse();
        vault = new CollateralVault(IPayable(payable(BASE_PROXY)), address(ch), IERC20Min(address(weth)));
        market = new CreditMarket(IPayable(payable(UNI_PROXY)), address(ch), IERC20Min(address(usdc)));
        ch.configure(BASE, address(vault), address(feed), UNI, address(market), PRICE0);

        usdc.mint(address(this), 10_000_000e6);
        usdc.approve(address(market), type(uint256).max);
        market.supply(10_000_000e6);

        vm.recordLogs();
    }

    function _capture() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            address e = logs[i].emitter;
            if (e == address(vault) || e == address(feed)) {
                _push(baseQ, BASE, logs[i]);
            } else if (e == address(market)) {
                _push(uniQ, UNI, logs[i]);
            } else if (e == SYSTEM_ADDR && logs[i].topics[0] == MockSystem.CallbackRequested.selector) {
                (uint256 chainId, address recipient, uint64 gasLimit, bytes memory payload) =
                    abi.decode(logs[i].data, (uint256, address, uint64, bytes));
                ISystemContract.CallbackConfiguration_V_1_0 storage s = cbQ.push();
                s.chainId = chainId;
                s.recipient = recipient;
                s.gasLimit = gasLimit;
                s.payload = payload;
            }
        }
    }

    function _push(QLog[] storage q, uint256 chainId, Vm.Log memory l) internal {
        QLog storage s = q.push();
        s.chainId = chainId;
        s.emitter = l.emitter;
        s.topics = l.topics;
        s.data = l.data;
    }

    function _pendingBase() internal view returns (uint256) {
        return baseQ.length - baseHead;
    }

    function _pendingUni() internal view returns (uint256) {
        return uniQ.length - uniHead;
    }

    function _deliverBase() internal returns (bool) {
        if (_pendingBase() == 0) return false;
        _deliverLog(baseQ[baseHead++]);
        return true;
    }

    function _deliverBaseMeasured() internal returns (uint256 gasUsed) {
        require(_pendingBase() > 0, "no base log queued");
        gasUsed = _deliverLog(baseQ[baseHead++]);
    }

    function _deliverUni() internal returns (bool) {
        if (_pendingUni() == 0) return false;
        _deliverLog(uniQ[uniHead++]);
        return true;
    }

    function _deliverLog(QLog storage q) internal returns (uint256 gasUsed) {
        IReactive.LogRecord memory r;
        r.chainId = q.chainId;
        r.contractAddress = q.emitter;
        uint256 n = q.topics.length;
        r.opCode = n;
        if (n > 0) r.topic0 = uint256(q.topics[0]);
        if (n > 1) r.topic1 = uint256(q.topics[1]);
        if (n > 2) r.topic2 = uint256(q.topics[2]);
        if (n > 3) r.topic3 = uint256(q.topics[3]);
        r.data = q.data;
        r.blockNumber = block.number;
        r.txHash = uint256(keccak256(abi.encode(q.chainId, ++logNonce)));
        vm.prank(SYSTEM_ADDR);
        uint256 before = gasleft();
        ch.react(r);
        gasUsed = before - gasleft();
        _capture();
    }

    function _deliverCallback(uint256 i) internal returns (bool) {
        if (i >= cbQ.length) return false;
        ISystemContract.CallbackConfiguration_V_1_0 memory c = cbQ[i];
        for (uint256 j = i; j + 1 < cbQ.length; j++) {
            cbQ[j] = cbQ[j + 1];
        }
        cbQ.pop();

        bytes memory p = c.payload;
        address rvm = address(ch);
        assembly {
            mstore(add(p, 36), rvm)
        }
        address proxy = c.chainId == BASE ? BASE_PROXY : UNI_PROXY;
        vm.prank(proxy);
        (bool ok,) = c.recipient.call{gas: c.gasLimit}(p);
        assertTrue(ok, "callback reverted");
        _capture();
        return true;
    }

    function _settleAll() internal {
        for (uint256 guard = 0; guard < 2_000; guard++) {
            if (_deliverBase()) continue;
            if (_deliverUni()) continue;
            if (_deliverCallback(0)) continue;
            return;
        }
        revert("settle did not converge");
    }

    function _deposit(address u, uint256 amount) internal {
        weth.mint(u, amount);
        vm.startPrank(u);
        weth.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
        _capture();
    }

    function _borrow(address u, uint256 amount) internal returns (bool ok) {
        vm.prank(u);
        try market.borrow(amount) {
            ok = true;
        } catch {
            ok = false;
        }
        _capture();
    }

    function _repay(address u, uint256 amount) internal {
        usdc.mint(u, amount);
        vm.startPrank(u);
        usdc.approve(address(market), amount);
        market.repay(u, amount);
        vm.stopPrank();
        _capture();
    }

    function _requestWithdraw(address u, uint256 amount) internal returns (uint256 reqId) {
        vm.prank(u);
        reqId = vault.requestWithdraw(amount);
        _capture();
    }

    function _cancel(address u, uint256 reqId) internal {
        vm.prank(u);
        vault.cancelWithdraw(reqId);
        _capture();
    }

    function _setPrice(uint256 p) internal {
        feed.setPrice(p);
        _capture();
    }

    function _liquidate(address liquidator, address user, uint256 amount) internal returns (uint256 liqId) {
        usdc.mint(liquidator, amount);
        vm.startPrank(liquidator);
        usdc.approve(address(market), amount);
        liqId = market.liquidate(user, amount);
        vm.stopPrank();
        _capture();
    }

    function _valueAt(uint256 p, uint256 coll) internal pure returns (uint256) {
        return coll * p * 1e6 / (1e18 * 1e8);
    }
}
