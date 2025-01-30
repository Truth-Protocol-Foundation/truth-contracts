// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import '../TruthToken.sol';

contract TruthTokenUpgrade is TruthToken {
  function newFunction() external pure returns (string memory) {
    return 'TruthToken upgraded';
  }
}
