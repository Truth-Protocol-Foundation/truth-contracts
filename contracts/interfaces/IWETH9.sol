// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import '@openzeppelin/contracts/interfaces/IERC20.sol';

interface IWETH9 is IERC20 {
  function withdraw(uint256 amount) external;
  function deposit() external payable;
}
