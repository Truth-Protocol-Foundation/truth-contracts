// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import '../TruthBridge.sol';

contract TruthBridgeUpgrade is TruthBridge {
  function newFunction() external pure returns (string memory) {
    return 'TruthBridge upgraded';
  }
}
