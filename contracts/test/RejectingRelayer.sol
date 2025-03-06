// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.28;

import '../interfaces/ITruthBridge.sol';

contract RejectingRelayer {
  ITruthBridge _bridge;

  constructor(ITruthBridge bridge) {
    _bridge = bridge;
  }

  receive() external payable {
    revert();
  }

  function completeOnRamp(uint256 amount, address user, uint8 v, bytes32 r, bytes32 s) external {
    _bridge.completeOnRamp(amount, user, v, r, s);
  }

  function recoverCosts() external {
    _bridge.recoverCosts();
  }
}
