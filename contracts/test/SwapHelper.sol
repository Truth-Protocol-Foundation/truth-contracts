// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import '../interfaces/IUniswapV3Pool.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract SwapHelper {
  uint160 private constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;
  uint160 private constant MIN_SQRT_RATIO = 4295128739;

  address private usdc;
  address private weth;
  address public pool;
  bool private transferUSDC;

  constructor(address _pool, address _usdc, address _weth) {
    pool = _pool;
    usdc = _usdc;
    weth = _weth;
  }

  function swapToUSDC(int256 amountIn) external {
    transferUSDC = false;
    IUniswapV3Pool(pool).swap(address(this), false, amountIn, MAX_SQRT_RATIO - 1, '');
  }

  function swapToWETH(int256 amountIn) external {
    transferUSDC = true;
    IUniswapV3Pool(pool).swap(address(this), true, amountIn, MIN_SQRT_RATIO + 1, '');
  }

  function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata /* data */) external {
    if (transferUSDC) IERC20(usdc).transfer(msg.sender, uint256(amount0Delta));
    else IERC20(weth).transfer(msg.sender, uint256(amount1Delta));
  }

  function currentPrice() external view returns (uint256 price) {
    (uint160 sqrtPriceX96, , , , , , ) = IUniswapV3Pool(pool).slot0();
    uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
    price = priceX192 >> 192;
  }
}
