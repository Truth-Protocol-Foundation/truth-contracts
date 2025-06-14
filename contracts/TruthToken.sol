// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract TruthToken is Initializable, ERC20Upgradeable, ERC20PermitUpgradeable, Ownable2StepUpgradeable, UUPSUpgradeable {
  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  function initialize(string calldata name, string calldata symbol_, uint256 supply, address owner_) public initializer {
    __ERC20_init(name, symbol_);
    __ERC20Permit_init(name);
    __Ownable_init(owner_);
    __Ownable2Step_init();
    __UUPSUpgradeable_init();
    _mint(owner_, supply * 10 ** decimals());
  }

  function decimals() public pure override returns (uint8) {
    return 10;
  }

  function symbol() public pure override returns (string memory) {
    return 'TRUU';
  }

  function _authorizeUpgrade(address) internal override onlyOwner {}
}
