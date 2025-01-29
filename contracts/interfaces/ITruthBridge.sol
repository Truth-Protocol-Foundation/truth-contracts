// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ITruthBridge {
  event LogAuthorAdded(address indexed t1Address, bytes32 indexed t2PubKey, uint32 indexed t2TxId);
  event LogAuthorRemoved(address indexed t1Address, bytes32 indexed t2PubKey, uint32 indexed t2TxId);
  event LogLifted(address indexed token, bytes32 indexed t2PubKey, uint256 amount);
  event LogLiftedToPredictionMarket(address indexed token, bytes32 indexed t2PubKey, uint256 amount);
  event LogLowerClaimed(uint32 indexed lowerId);
  event LogRootPublished(bytes32 indexed rootHash, uint32 indexed t2TxId);

  function addAuthor(bytes calldata t1PubKey, bytes32 t2PubKey, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function removeAuthor(bytes32 t2PubKey, bytes calldata t1PubKey, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function publishRoot(bytes32 rootHash, uint256 expiry, uint32 t2TxId, bytes calldata confirmations) external;
  function lift(address token, bytes32 t2PubKey, uint256 amount) external;
  function lift(address token, bytes32 t2PubKey, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
  function liftToPredictionMarket(address token, uint256 amount) external;
  function liftToPredictionMarket(address token, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
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
