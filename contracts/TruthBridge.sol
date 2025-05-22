// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 * @dev Bridging contract between Truth Network and Ethereum.
 * Enables Author nodes to periodically publish T2 transactional state.
 * Allows Authors to be added and removed from participation in consensus.
 * "lifts" tokens from Ethereum addresses to Truth Network accounts.
 * "lowers" tokens from Truth Network accounts to Ethereum addresses.
 * Enables gasless lifting of USDC funds via relayers.
 * Accepts optional ERC-2612 permits for lifting.
 * Proxy upgradeable implementation utilising EIP-1822.
 */

import './interfaces/ITruthBridge.sol';
import './interfaces/IChainalysis.sol';
import './interfaces/IChainlinkV3Aggregator.sol';
import './interfaces/IUniswapV3Callback.sol';
import './interfaces/IUniswapV3Pool.sol';
import './interfaces/IWETH9.sol';
import '@openzeppelin/contracts/interfaces/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract TruthBridge is
  ITruthBridge,
  IUniswapV3Callback,
  Initializable,
  Ownable2StepUpgradeable,
  PausableUpgradeable,
  ReentrancyGuardUpgradeable,
  UUPSUpgradeable
{
  using SafeERC20 for IERC20;

  string private constant ESM_PREFIX = '\x19Ethereum Signed Message:\n32';
  uint256 private constant LOWER_DATA_LENGTH = 20 + 32 + 20 + 4; // token address + amount + recipient address + lower ID
  uint256 private constant MINIMUM_AUTHOR_SET = 4;
  uint256 private constant SIGNATURE_LENGTH = 65;
  uint256 private constant T2_TOKEN_LIMIT = type(uint128).max;
  uint256 private constant MINIMUM_PROOF_LENGTH = LOWER_DATA_LENGTH + SIGNATURE_LENGTH * 2;
  uint160 private constant MIN_SQRT_RATIO = 4295128739;
  int8 private constant TX_SUCCEEDED = 1;
  int8 private constant TX_PENDING = 0;
  int8 private constant TX_FAILED = -1;

  address private constant feed = 0x986b5E1e1755e3C2440e960477f25201B0a8bbD4;
  address private constant pool = 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640;
  address private constant usdc = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
  address private constant weth = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
  address private constant sanctions = 0x40C57923924B5c5c5455c48D93317139ADDaC8fb;

  // Authors
  mapping(uint256 => bool) public isAuthor;
  mapping(uint256 => bool) public authorIsActive;
  mapping(address => uint256) public t1AddressToId;
  mapping(bytes32 => uint256) public t2PubKeyToId;
  mapping(uint256 => address) public idToT1Address;
  mapping(uint256 => bytes32) public idToT2PubKey;
  mapping(bytes32 => bool) public isPublishedRootHash;
  mapping(uint256 => bool) public isUsedT2TxId;
  mapping(bytes32 => bool) public hasLowered;
  uint256 public numActiveAuthors;
  uint256 public nextAuthorId;
  address public truth;

  // Relayers
  mapping(address => int256) public relayerBalance;
  /// @custom:oz-renamed-from onRampGas
  uint256 private _unused;

  error AddressBlocked(address); // 0x71fa9c99
  error AddressMismatch(); // 0x4cd87fb5
  error AlreadyAdded(); // 0xf411c327
  error AmountTooLow(); // 0x1fbaba35
  error BadConfirmations(); // 0x409c8aac
  error CannotChangeT2Key(bytes32); // 0x140c6815
  error InvalidCaller(); // 0x48f5c3ed
  error InvalidProof(); // 0x09bde339
  error InvalidT1Key(); // 0x4b0218a8
  error InvalidT2Key(); // 0xf4fc87a4
  error InvalidToken(); // 0xc1ab6dc1
  error LiftFailed(); // 0xb19ed519
  error LiftLimitHit(); // 0xc36d2830
  error LowerIsUsed(); // 0x24c1c1ce
  error MissingKeys(); // 0x097ec09e
  error MissingTruth(); // 0xd1585e94
  error NotAnAuthor(); // 0x157b0512
  error NotEnoughAuthors(); // 0x3a6a875c
  error NoRefundDue(); // 0x56b6c1ab
  error RelayerOnly(); // 0x7378cebb
  error RootHashIsUsed(); // 0x2c8a3b6e
  error T1AddressInUse(address); // 0x78f22dd1
  error T2KeyInUse(bytes32); // 0x02f3935c
  error TxIdIsUsed(); // 0x7edd16f0
  error WindowExpired(); // 0x7bbfb6fe

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  modifier checkAddress(address _address) {
    if (IChainalysis(sanctions).isSanctioned(_address)) revert AddressBlocked(_address);
    _;
  }

  modifier withinCallWindow(uint256 expiry) {
    if (block.timestamp > expiry) revert WindowExpired();
    _;
  }

  function initialize(
    address _truth,
    address[] calldata t1Addresses,
    bytes32[] calldata t1PubKeysLHS,
    bytes32[] calldata t1PubKeysRHS,
    bytes32[] calldata t2PubKeys,
    address owner_
  ) public initializer {
    __Ownable_init(owner_);
    __Ownable2Step_init();
    __Pausable_init();
    __ReentrancyGuard_init();
    __UUPSUpgradeable_init();
    if (_truth == address(0)) revert MissingTruth();
    truth = _truth;
    nextAuthorId = 1;
    _initialiseAuthors(t1Addresses, t1PubKeysLHS, t1PubKeysRHS, t2PubKeys);
  }

  function pause() external onlyOwner whenNotPaused {
    _pause();
  }

  function unpause() external onlyOwner whenPaused {
    _unpause();
  }

  /**
   * @dev Enables authors to add a new author, permanently linking their T1 and T2 keys.
   * Author activation will occur upon the first confirmation received from them.
   * Can also be used to reactivate an author.
   */
  function addAuthor(
    bytes calldata t1PubKey,
    bytes32 t2PubKey,
    uint256 expiry,
    uint32 t2TxId,
    bytes calldata confirmations
  ) external whenNotPaused withinCallWindow(expiry) {
    if (t1PubKey.length != 64) revert InvalidT1Key();
    address t1Address = _toAddress(t1PubKey);
    uint256 id = t1AddressToId[t1Address];
    if (isAuthor[id]) revert AlreadyAdded();

    _verifyConfirmations(false, keccak256(abi.encode(t1PubKey, t2PubKey, expiry, t2TxId)), confirmations);
    _storeT2TxId(t2TxId);

    if (id == 0) {
      _addNewAuthor(t1Address, t2PubKey);
    } else {
      if (t2PubKey != idToT2PubKey[id]) revert CannotChangeT2Key(idToT2PubKey[id]);
      isAuthor[id] = true;
    }

    emit LogAuthorAdded(t1Address, t2PubKey, t2TxId);
  }

  /**
   * @dev Enables authors to remove an author, immediately revoking their authority in the contract.
   */
  function removeAuthor(
    bytes32 t2PubKey,
    bytes calldata t1PubKey,
    uint256 expiry,
    uint32 t2TxId,
    bytes calldata confirmations
  ) external whenNotPaused withinCallWindow(expiry) {
    if (t1PubKey.length != 64) revert InvalidT1Key();
    uint256 id = t2PubKeyToId[t2PubKey];
    if (!isAuthor[id]) revert NotAnAuthor();

    isAuthor[id] = false;

    if (numActiveAuthors <= MINIMUM_AUTHOR_SET) revert NotEnoughAuthors();

    if (authorIsActive[id]) {
      authorIsActive[id] = false;
      unchecked {
        --numActiveAuthors;
      }
    }

    _verifyConfirmations(false, keccak256(abi.encode(t2PubKey, t1PubKey, expiry, t2TxId)), confirmations);
    _storeT2TxId(t2TxId);

    emit LogAuthorRemoved(idToT1Address[id], t2PubKey, t2TxId);
  }

  /**
   * @dev Enables authors to publish a Merkle root summarising the latest set of T2 extrinsic calls.
   */
  function publishRoot(bytes32 rootHash, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external whenNotPaused withinCallWindow(expiry) {
    if (isPublishedRootHash[rootHash]) revert RootHashIsUsed();
    _verifyConfirmations(false, keccak256(abi.encode(rootHash, expiry, t2TxId)), confirmations);
    _storeT2TxId(t2TxId);
    isPublishedRootHash[rootHash] = true;
    emit LogRootPublished(rootHash, t2TxId);
  }

  /**
   * @dev Enables the caller to lift an amount of ERC20 tokens to the specified T2 recipient, provided they have first been approved.
   */
  function lift(address token, bytes calldata t2PubKey, uint256 amount) external whenNotPaused nonReentrant checkAddress(msg.sender) {
    if (t2PubKey.length != 32) revert InvalidT2Key();
    emit LogLifted(token, bytes32(t2PubKey), _lift(msg.sender, token, amount));
  }

  /**
   * @dev lift variant accepting an ERC-2612 permit in place of prior token approval.
   */
  function permitLift(
    address token,
    bytes32 t2PubKey,
    uint256 amount,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external whenNotPaused nonReentrant checkAddress(msg.sender) {
    if (t2PubKey == bytes32(0)) revert InvalidT2Key();
    IERC20Permit(token).permit(msg.sender, address(this), amount, deadline, v, r, s);
    emit LogLifted(token, t2PubKey, _lift(msg.sender, token, amount));
  }

  /**
   * @dev Lifts tokens to the derived T2 account of the caller on the prediction market, provided they have first been approved.
   */
  function predictionMarketLift(address token, uint256 amount) external whenNotPaused nonReentrant checkAddress(msg.sender) {
    emit LogLiftedToPredictionMarket(token, deriveT2PublicKey(msg.sender), _lift(msg.sender, token, amount));
  }

  /**
   * @dev Prediction market lift variant accepting an ERC-2612 permit in place of prior approval.
   */
  function predictionMarketPermitLift(
    address token,
    uint256 amount,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external whenNotPaused nonReentrant checkAddress(msg.sender) {
    IERC20Permit(token).permit(msg.sender, address(this), amount, deadline, v, r, s);
    emit LogLiftedToPredictionMarket(token, deriveT2PublicKey(msg.sender), _lift(msg.sender, token, amount));
  }

  /**
   * @dev Lifts tokens to the specified T2 account on the prediction market, provided they have first been approved.
   */
  function predictionMarketRecipientLift(address token, bytes32 t2PubKey, uint256 amount) external whenNotPaused nonReentrant checkAddress(msg.sender) {
    if (t2PubKey == bytes32(0)) revert InvalidT2Key();
    emit LogLiftedToPredictionMarket(token, t2PubKey, _lift(msg.sender, token, amount));
  }

  /**
   * @dev Registers a relayer for proxying user on-ramp completions
   */
  function registerRelayer(address relayer) external onlyOwner {
    if (relayerBalance[relayer] == 0) {
      relayerBalance[relayer] = 1; // minimizes storage R/W by using trace balance to denote a registered relayer
      emit LogRelayerRegistered(relayer);
    } else revert(); // relayer already registered
  }

  /**
   * @dev Deregisters an existing relayer
   */
  function deregisterRelayer(address relayer) external onlyOwner {
    int256 balance = relayerBalance[relayer];
    if (balance == 0) revert(); // no such relayer
    relayerBalance[relayer] = 0;
    if (balance > 1) IERC20(usdc).transfer(relayer, uint256(balance - 1)); // transfer any unclaimed USDC
    emit LogRelayerDeregistered(relayer);
  }

  /**
   * @dev Enables a relayer to lift USDC to the prediciton market on behalf of a user and extract the tx cost from the USDC
   */
  function relayerLift(uint256 gasCost, uint256 amount, address user, uint8 v, bytes32 r, bytes32 s, bool triggerRefund) external checkAddress(user) {
    int256 balance = relayerBalance[msg.sender];
    if (balance < 1) revert RelayerOnly();

    uint256 txCost = (gasCost * tx.gasprice) / usdcEth();
    if (txCost > amount) revert AmountTooLow();

    IERC20Permit(usdc).permit(user, address(this), amount, type(uint256).max, v, r, s);
    IERC20(usdc).transferFrom(user, address(this), amount);

    unchecked {
      amount -= txCost;
      balance += int256(txCost);
    }

    if (triggerRefund) _attemptRelayerRefund(balance);
    else relayerBalance[msg.sender] = balance;

    emit LogLiftedToPredictionMarket(usdc, deriveT2PublicKey(user), amount);
  }

  /**
   * @dev Enables a relayer to lower USDC on behalf of a user and extract the tx cost from the USDC
   */
  function relayerLower(uint256 gasCost, bytes calldata proof, bool triggerRefund) external {
    int256 balance = relayerBalance[msg.sender];
    if (balance < 1) revert RelayerOnly();
    (address token, uint256 amount, address user, uint32 lowerId) = _extractLowerData(proof);
    if (token != usdc) revert InvalidToken();

    uint256 txCost = (gasCost * tx.gasprice) / usdcEth();
    if (txCost > amount) revert AmountTooLow();

    _processLower(token, amount, user, lowerId, proof);

    unchecked {
      amount -= txCost;
      balance += int256(txCost);
    }

    IERC20(usdc).transfer(user, amount);

    if (triggerRefund) _attemptRelayerRefund(balance);
    else relayerBalance[msg.sender] = balance;

    emit LogRelayerLowered(lowerId, amount);
  }

  /**
   * @dev Returns the current Wei value of 1 USDC
   */
  function usdcEth() public view returns (uint256 price) {
    unchecked {
      price = uint256(IChainlinkV3Aggregator(feed).latestAnswer()) / 1e6;
    }
  }

  /**
   * @dev Only callable by the Uniswap pool to complete the swap in relayerRefund
   */
  function uniswapV3SwapCallback(int256 amount0Delta, int256 /* amount1Delta */, bytes calldata /* data */) external {
    if (msg.sender != pool) revert InvalidCaller();
    IERC20(usdc).transfer(msg.sender, uint256(amount0Delta));
  }

  // Allows the contract to receive ETH (from WETH withdrawal).
  receive() external payable {}

  /** @dev Checks a lower proof. Returns the details, proof validity, and claim status.
   * For unclaimed lowers, if the required confirmations exceeds those provided the proof will need to be regenerated.
   */
  function checkLower(
    bytes calldata proof
  )
    external
    view
    returns (
      address token,
      uint256 amount,
      address recipient,
      uint32 lowerId,
      uint256 confirmationsRequired,
      uint256 confirmationsProvided,
      bool proofIsValid,
      bool lowerIsClaimed
    )
  {
    if (proof.length < MINIMUM_PROOF_LENGTH) return (address(0), 0, address(0), 0, 0, 0, false, false);

    token = address(bytes20(proof[0:20]));
    amount = uint256(bytes32(proof[20:52]));
    recipient = address(bytes20(proof[52:72]));
    lowerId = uint32(bytes4(proof[72:LOWER_DATA_LENGTH]));
    bytes32 lowerHash = keccak256(abi.encodePacked(token, amount, recipient, lowerId));
    uint256 numConfirmations = (proof.length - LOWER_DATA_LENGTH) / SIGNATURE_LENGTH;
    bool[] memory confirmed = new bool[](nextAuthorId);
    bytes32 prefixedMsgHash = keccak256(abi.encodePacked(ESM_PREFIX, lowerHash));
    uint256 confirmationsOffset;

    lowerIsClaimed = hasLowered[lowerHash];
    confirmationsProvided = numConfirmations;
    confirmationsRequired = _requiredConfirmations();
    assembly {
      confirmationsOffset := add(proof.offset, LOWER_DATA_LENGTH)
    }

    for (uint256 i; i < numConfirmations; ++i) {
      uint256 id = _recoverAuthorId(prefixedMsgHash, confirmationsOffset, i);
      if (authorIsActive[id] && !confirmed[id]) confirmed[id] = true;
      else confirmationsProvided--;
    }

    proofIsValid = confirmationsProvided >= confirmationsRequired;
  }

  /**
   * @dev Claims the funds due to the recipient specified in the proof.
   */
  function claimLower(bytes calldata proof) external whenNotPaused nonReentrant {
    (address token, uint256 amount, address recipient, uint32 lowerId) = _extractLowerData(proof);
    _processLower(token, amount, recipient, lowerId, proof);
    IERC20(token).safeTransfer(recipient, amount);

    emit LogLowerClaimed(lowerId);
  }

  /**
   * @dev Confirms the existence of a T2 extrinsic call within a published root.
   */
  function confirmTransaction(bytes32 leafHash, bytes32[] calldata merklePath) external view returns (bool) {
    bytes32 node;
    uint256 i;

    do {
      node = merklePath[i];
      leafHash = leafHash < node ? keccak256(abi.encode(leafHash, node)) : keccak256(abi.encode(node, leafHash));
      unchecked {
        ++i;
      }
    } while (i < merklePath.length);

    return isPublishedRootHash[leafHash];
  }

  /**
   * @dev Checks the status of an author transaction.
   */
  function corroborate(uint32 t2TxId, uint256 expiry) external view returns (int8) {
    if (isUsedT2TxId[t2TxId]) return TX_SUCCEEDED;
    else if (block.timestamp > expiry) return TX_FAILED;
    else return TX_PENDING;
  }

  /**
   * @dev Returns the T2 public key derived from the T1 address.
   */
  function deriveT2PublicKey(address t1Address) public pure returns (bytes32) {
    return keccak256(abi.encodePacked(t1Address));
  }

  /**
   * @dev Disabled function
   */
  function renounceOwnership() public view override onlyOwner {
    revert('Disabled');
  }

  function _authorizeUpgrade(address) internal override onlyOwner {}

  function _activateAuthor(uint256 id) private {
    authorIsActive[id] = true;
    unchecked {
      ++numActiveAuthors;
    }
  }

  function _addNewAuthor(address t1Address, bytes32 t2PubKey) private returns (uint256 id) {
    unchecked {
      id = nextAuthorId++;
    }
    if (t2PubKeyToId[t2PubKey] != 0) revert T2KeyInUse(t2PubKey);
    idToT1Address[id] = t1Address;
    idToT2PubKey[id] = t2PubKey;
    t1AddressToId[t1Address] = id;
    t2PubKeyToId[t2PubKey] = id;
    isAuthor[id] = true;
  }

  function _attemptRelayerRefund(int256 balance) private {
    try this.__refundRelayer(msg.sender, balance - 1) {
      relayerBalance[msg.sender] = 1; // reset to trace balance on success
    } catch {
      emit LogRefundFailed(msg.sender, balance);
    }
  }

  function _extractLowerData(bytes calldata proof) private pure returns (address token, uint256 amount, address recipient, uint32 lowerId) {
    if (proof.length < MINIMUM_PROOF_LENGTH) revert InvalidProof();
    assembly {
      token := shr(96, calldataload(proof.offset))
      amount := calldataload(add(proof.offset, 20))
      recipient := shr(96, calldataload(add(proof.offset, 52)))
      lowerId := shr(224, calldataload(add(proof.offset, 72)))
    }
  }

  function _initialiseAuthors(
    address[] calldata t1Addresses,
    bytes32[] calldata t1PubKeysLHS,
    bytes32[] calldata t1PubKeysRHS,
    bytes32[] calldata t2PubKeys
  ) private {
    uint256 numAuth = t1Addresses.length;
    if (numAuth < MINIMUM_AUTHOR_SET) revert NotEnoughAuthors();
    if (t1PubKeysLHS.length != numAuth || t1PubKeysRHS.length != numAuth || t2PubKeys.length != numAuth) revert MissingKeys();

    bytes memory t1PubKey;
    address t1Address;
    uint256 i;

    do {
      t1Address = t1Addresses[i];
      t1PubKey = abi.encode(t1PubKeysLHS[i], t1PubKeysRHS[i]);
      if (_toAddress(t1PubKey) != t1Address) revert AddressMismatch();
      if (t1AddressToId[t1Address] != 0) revert T1AddressInUse(t1Address);
      _activateAuthor(_addNewAuthor(t1Address, t2PubKeys[i]));
      unchecked {
        ++i;
      }
    } while (i < numAuth);
  }

  function _lift(address lifter, address token, uint256 amount) private returns (uint256) {
    uint256 existingBalance = IERC20(token).balanceOf(address(this));
    IERC20(token).safeTransferFrom(lifter, address(this), amount);
    uint256 newBalance = IERC20(token).balanceOf(address(this));
    if (newBalance <= existingBalance) revert LiftFailed();
    if (newBalance > T2_TOKEN_LIMIT) revert LiftLimitHit();
    return newBalance - existingBalance;
  }

  function _processLower(address token, uint256 amount, address recipient, uint32 lowerId, bytes calldata proof) private {
    bytes32 lowerHash = keccak256(abi.encodePacked(token, amount, recipient, lowerId));
    if (hasLowered[lowerHash]) revert LowerIsUsed();
    hasLowered[lowerHash] = true;
    _verifyConfirmations(true, lowerHash, proof[LOWER_DATA_LENGTH:]);
  }

  function _recoverAuthorId(bytes32 prefixedMsgHash, uint256 confirmationsOffset, uint256 confirmationsIndex) private view returns (uint256 id) {
    bytes32 r;
    bytes32 s;
    uint8 v;

    assembly {
      let sig := add(confirmationsOffset, mul(confirmationsIndex, SIGNATURE_LENGTH))
      r := calldataload(sig)
      s := calldataload(add(sig, 32))
      v := byte(0, calldataload(add(sig, 64)))
    }

    if (v < 27) {
      unchecked {
        v += 27;
      }
    }

    id = v < 29 && uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0 ? t1AddressToId[ecrecover(prefixedMsgHash, v, r, s)] : 0;
  }

  function __refundRelayer(address relayer, int256 balance) external {
    if (msg.sender != address(this)) revert InvalidCaller();
    // triggers uniswapV3SwapCallback:
    (, int256 amount1) = IUniswapV3Pool(pool).swap(address(this), true, balance, MIN_SQRT_RATIO + 1, '');

    unchecked {
      uint256 ethAmount = uint256(amount1 * -1);
      if (ethAmount < (uint256(balance) * usdcEth() * 987) / 1000) revert(); // Allow 1% overhead + 0.3% fee
      IWETH9(weth).withdraw(ethAmount);
      (bool success, ) = relayer.call{ value: ethAmount }('');
      assembly {
        pop(success)
      }
    }
  }

  function _requiredConfirmations() private view returns (uint256 required) {
    required = numActiveAuthors;
    unchecked {
      required -= (required * 2) / 3;
    }
  }

  function _storeT2TxId(uint256 t2TxId) private {
    if (isUsedT2TxId[t2TxId]) revert TxIdIsUsed();
    isUsedT2TxId[t2TxId] = true;
  }

  function _toAddress(bytes memory t1PubKey) private pure returns (address) {
    return address(uint160(uint256(keccak256(t1PubKey))));
  }

  function _verifyConfirmations(bool isLower, bytes32 msgHash, bytes calldata confirmations) private {
    uint256[] memory confirmed = new uint256[](nextAuthorId);
    bytes32 prefixedMsgHash = keccak256(abi.encodePacked(ESM_PREFIX, msgHash));
    uint256 requiredConfirmations = _requiredConfirmations();
    uint256 numConfirmations = confirmations.length / SIGNATURE_LENGTH;
    uint256 confirmationsOffset;
    uint256 confirmationsIndex;
    uint256 validConfirmations;
    uint256 authorId;

    assembly {
      confirmationsOffset := confirmations.offset
    }

    // Setup the first iteration of the do-while loop:
    if (isLower) {
      // For lowers all confirmations are explicit so the first authorId is extracted from the first confirmation
      authorId = _recoverAuthorId(prefixedMsgHash, confirmationsOffset, confirmationsIndex);
      confirmationsIndex = 1;
    } else {
      // For non-lowers there is a high chance the sender is an author and, if so, their confirmation is implicit
      authorId = t1AddressToId[msg.sender];
      unchecked {
        ++numConfirmations;
      }
    }

    do {
      if (!authorIsActive[authorId]) {
        if (isAuthor[authorId]) {
          _activateAuthor(authorId);
          unchecked {
            ++validConfirmations;
          }
          requiredConfirmations = _requiredConfirmations();
          if (validConfirmations == requiredConfirmations) return; // success
          confirmed[authorId] = 1;
        }
      } else if (confirmed[authorId] == 0) {
        unchecked {
          ++validConfirmations;
        }
        if (validConfirmations == requiredConfirmations) return; // success
        confirmed[authorId] = 1;
      }

      // Setup the next iteration of the loop
      authorId = _recoverAuthorId(prefixedMsgHash, confirmationsOffset, confirmationsIndex);
      unchecked {
        ++confirmationsIndex;
      }
    } while (confirmationsIndex <= numConfirmations);

    revert BadConfirmations();
  }
}
