// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.28;

import '../interfaces/ITruthBridge.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

contract ReentrantToken is ERC20 {
  enum ReentryPoint {
    ClaimLower,
    Lift,
    LiftPermit,
    LiftPM,
    LiftPMPermit
  }

  ReentryPoint private _reentryPoint;
  ITruthBridge private _bridge;

  bytes private _proof;
  address private _token;
  bytes32 private _t2PubKey;
  uint256 private _amount;
  uint256 private _deadline;
  uint8 private _v;
  bytes32 private _r;
  bytes32 private _s;

  constructor(ITruthBridge bridge) ERC20('R20', 'R20') {
    _mint(msg.sender, 100000000000000000);
    _bridge = bridge;
  }

  // Overridden for testing to trigger a re-entry attempt upon transfer
  function transferFrom(address sender, address recipient, uint256 amount) public virtual override returns (bool) {
    super.transferFrom(sender, recipient, amount);
    _attemptReentry();
    return true;
  }

  function setReentryPoint(ReentryPoint reentryPoint) external {
    _reentryPoint = reentryPoint;
  }

  function _attemptReentry() private {
    if (_reentryPoint == ReentryPoint.ClaimLower) _bridge.claimLower(_proof);
    else if (_reentryPoint == ReentryPoint.Lift) _bridge.lift(_token, _t2PubKey, _amount);
    else if (_reentryPoint == ReentryPoint.LiftPermit) _bridge.lift(_token, _t2PubKey, _amount, _deadline, _v, _r, _s);
    else if (_reentryPoint == ReentryPoint.LiftPM) _bridge.liftToPredictionMarket(_token, _amount);
    else if (_reentryPoint == ReentryPoint.LiftPMPermit) _bridge.liftToPredictionMarket(_token, _amount, _deadline, _v, _r, _s);
  }
}
