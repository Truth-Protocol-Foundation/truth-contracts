// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IUniswap {
  struct ExactInputSingleParams {
    PoolKey key;
    bool zeroForOne;
    uint256 amountIn;
    uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
    bytes hookData;
  }

  struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    bytes hooks;
  }

  function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);

  function execute(bytes calldata commands, bytes[] calldata inputs) external payable returns (bytes[] memory results);
}
