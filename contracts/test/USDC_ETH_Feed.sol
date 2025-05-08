// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import '../interfaces/IChainlinkV3Aggregator.sol';
import '../interfaces/IUniswapV3Pool.sol';

// DEPLOYED TO SEPOLIA AT 0xcE4881900850816b459bB9126fC778783835296B

contract USDC_ETH_Feed is IChainlinkV3Aggregator {
  IUniswapV3Pool pool = IUniswapV3Pool(0x3289680dD4d6C10bb19b899729cda5eEF58AEfF1);

  function latestAnswer() external view returns (int256 answer) {
    (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();
    uint256 price = (uint256(sqrtPriceX96) ** 2) >> 192;
    answer = int256(price * 1e6);
  }
}
