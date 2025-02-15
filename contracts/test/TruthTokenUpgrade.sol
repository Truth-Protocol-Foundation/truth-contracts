// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import '../TruthToken.sol';

contract TruthTokenUpgrade is TruthToken {
  function newFunction() external pure returns (string memory) {
    return 'TruthToken upgraded';
  }
  // Override the symbol function to return 'TRUU'
  function symbol() public pure override returns (string memory) {
    return 'TRUU';
  }
}
