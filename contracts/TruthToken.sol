// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract TruthToken is Initializable, ERC20Upgradeable, ERC20PermitUpgradeable, Ownable2StepUpgradeable, UUPSUpgradeable {
  function initialize(string calldata name, uint256 tokenSupply) public initializer {
    __Ownable_init(msg.sender);
    __Ownable2Step_init();
    __UUPSUpgradeable_init();
    __ERC20_init(name, name);
    __ERC20Permit_init(name);
    _mint(msg.sender, tokenSupply * 10 ** decimals());
  }

  function decimals() public pure override returns (uint8) {
    return 10;
  }

  function _authorizeUpgrade(address) internal override onlyOwner {}
}
