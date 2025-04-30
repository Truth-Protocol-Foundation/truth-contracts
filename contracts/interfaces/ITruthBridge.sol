// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ITruthBridge {
  event LogAuthorAdded(address indexed t1Address, bytes32 indexed t2PubKey, uint32 indexed t2TxId);
  event LogAuthorRemoved(address indexed t1Address, bytes32 indexed t2PubKey, uint32 indexed t2TxId);
  event LogLifted(address indexed token, bytes32 indexed t2PubKey, uint256 amount);
  event LogLiftedToPredictionMarket(address indexed token, bytes32 indexed t2PubKey, uint256 amount);
  event LogLowerClaimed(uint32 indexed lowerId);
  event LogRelayerLowered(uint32 indexed lowerId, uint256 amount);
  event LogRootPublished(bytes32 indexed rootHash, uint32 indexed t2TxId);
  event LogRelayerRegistered(address indexed relayer);
  event LogRelayerDeregistered(address indexed relayer);
  event LogRefundFailed(address indexed relayer, int256 balance);

  function addAuthor(bytes calldata t1PubKey, bytes32 t2PubKey, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function removeAuthor(bytes32 t2PubKey, bytes calldata t1PubKey, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function publishRoot(bytes32 rootHash, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function lift(address token, bytes calldata t2PubKey, uint256 amount) external;
  function permitLift(address token, bytes32 t2PubKey, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
  function predictionMarketLift(address token, uint256 amount) external;
  function predictionMarketRecipientLift(address token, bytes32 t2PubKey, uint256 amount) external;
  function predictionMarketPermitLift(address token, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
  function registerRelayer(address relayer) external;
  function deregisterRelayer(address relayer) external;
  function relayerLift(uint256 gas, uint256 amount, address user, uint8 v, bytes32 r, bytes32 s, bool refund) external;
  function relayerLower(uint256 gas, bytes calldata proof, bool refund) external;
  function usdcEth() external view returns (uint256 price);
  function claimLower(bytes calldata proof) external;
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
    );
  function confirmTransaction(bytes32 leafHash, bytes32[] calldata merklePath) external view returns (bool);
  function corroborate(uint32 t2TxId, uint256 expiry) external view returns (int8);
  function deriveT2PublicKey(address t1Address) external view returns (bytes32);
}
