// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import '../interfaces/IUniswapV3Callback.sol';
import '../interfaces/IUniswapV3Pool.sol';
import '../interfaces/IWETH9.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract RelayerToken is Initializable, ERC20Upgradeable, ERC20PermitUpgradeable, OwnableUpgradeable, UUPSUpgradeable {
  mapping(address => bool) public validBridge;

  int256 public constant latestAnswer = 200000000000000; // $5000 per ETH
  string public constant version = '1';

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  function initialize(address testnet, address dev) public initializer {
    __Ownable_init(msg.sender);
    __UUPSUpgradeable_init();
    __ERC20_init('RelayerToken', 'rUSDC');
    __ERC20Permit_init('RelayerToken');
    _mint(msg.sender, 100000000000 * 10 ** decimals());
    validBridge[testnet] = true;
    validBridge[dev] = true;
  }

  receive() external payable {}

  function setBridge(address bridge, bool isValid) external onlyOwner {
    validBridge[bridge] = isValid;
  }

  function withdraw(uint256 amount) external {
    if (!validBridge[msg.sender]) revert();
    (bool success, ) = msg.sender.call{ value: amount }('');
    assembly {
      pop(success)
    }
  }

  function swap(address, bool, int256 usdcInAmount, uint160, bytes calldata) external returns (int256, int256) {
    if (!validBridge[msg.sender]) revert();
    int256 ethOutAmount = (-1 * latestAnswer * usdcInAmount * 99) / (100 * 1e6);
    IUniswapV3Callback(msg.sender).uniswapV3SwapCallback(usdcInAmount, 0, '');
    return (0, ethOutAmount);
  }

  function decimals() public pure override returns (uint8) {
    return 6;
  }

  function _authorizeUpgrade(address) internal override onlyOwner {}
}
