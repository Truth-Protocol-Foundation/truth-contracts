const { impersonateAccount, stopImpersonatingAccount, time } = require('@nomicfoundation/hardhat-network-helpers');
const { MerkleTree } = require('merkletreejs');
const { expect } = require('chai');
const coder = ethers.AbiCoder.defaultAbiCoder();

const USDC = {
  mainnet: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', holder: '0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341' },
  sepolia: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', holder: '0x1C27eAD3265239581C936d880c53b8a7E0590a9f' }
};

const WETH = {
  mainnet: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  sepolia: { address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' }
};

const pool = {
  mainnet: { address: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640' },
  sepolia: { address: '0x3289680dD4d6C10bb19b899729cda5eEF58AEfF1' }
};

const EMPTY_BYTES = '0x';
const EMPTY_BYTES_32 = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const LOWER_ID = '0x5702';
const EXPIRY_WINDOW = 60;
const MIN_AUTHORS = 4;
const ONE_HUNDRED_BILLION = 100000000000n;
const ONE_USDC = 1000000n;

let additionalTx = [];
let accounts = [];
let authors = [];
let lowerId = 0;
let fork;
let usdc;
let weth;

async function createLowerProof(bridge, token, amount, recipient) {
  lowerId++;

  const tokenBytes = ethers.getBytes(token.address);
  const amountBytes = ethers.toBeHex(amount, 32);
  const recipientBytes = ethers.getBytes(recipient.address);
  const lowerIdBytes = ethers.toBeHex(lowerId, 4);
  const lowerDataBytes = ethers.concat([tokenBytes, amountBytes, recipientBytes, lowerIdBytes]);
  const lowerHash = ethers.keccak256(lowerDataBytes);
  const numActiveAuthors = await bridge.numActiveAuthors();
  const supermajorityConfirmations = numActiveAuthors - (await getNumRequiredConfirmations(bridge));

  const confirmations = [];
  for (let i = 1; i <= supermajorityConfirmations; i++) {
    const confirmation = await authors[i].account.signMessage(ethers.getBytes(lowerHash));
    confirmations.push(ethers.getBytes(confirmation));
  }

  const confirmationsBytes = ethers.concat(confirmations);
  const lowerProof = ethers.concat([lowerDataBytes, confirmationsBytes]);
  return [lowerProof, lowerId];
}

function createMerkleTree(dataLeaves) {
  const dataLeaf = dataLeaves[0];
  dataLeaves[0] = ethers.keccak256(dataLeaves[0]);
  dataLeaves = Array.isArray(dataLeaves) ? dataLeaves : [dataLeaves];
  const tree = new MerkleTree(dataLeaves, ethers.keccak256, { hashLeaves: false, sortPairs: true });
  return {
    leafData: dataLeaf,
    leafHash: '0x' + tree.leaves[0].toString('hex'),
    merklePath: tree.getHexProof(tree.leaves[0]),
    rootHash: tree.getHexRoot(),
    leaves: tree.getLeaves(),
    getMerklePath: (leaf, id) => tree.getHexProof(leaf, id)
  };
}

async function createTreeAndPublishRoot(bridge, owner, truth, amount) {
  const t2FromPubKey = strip_0x(randomBytes32());
  const token = strip_0x(truth.address);
  const amountBytes = toLittleEndianBytesStr(amount);
  const t1Address = strip_0x(owner.address);
  const encodedLeaf = getTxLeafMetadata() + strip_0x(LOWER_ID) + t2FromPubKey + token + amountBytes + t1Address;
  const leaves = [encodedLeaf].concat(additionalTx);
  const merkleTree = createMerkleTree(leaves);
  const expiry = await getValidExpiry();
  const t2TxId = randomT2TxId();
  const confirmations = await getConfirmations(bridge, 'publishRoot', merkleTree.rootHash, expiry, t2TxId);
  await bridge.connect(authors[0].account).publishRoot(merkleTree.rootHash, expiry, t2TxId, confirmations);
  return merkleTree;
}

async function deploySwapHelper() {
  const contract = await ethers.getContractFactory('SwapHelper');
  const swapHelper = await contract.deploy(pool[fork].address, USDC[fork].address, WETH[fork].address);
  swapHelper.address = await swapHelper.getAddress();
  return swapHelper;
}

async function deployTruthBridge(truth, owner) {
  const initArgs = [
    truth.address,
    authors.map(author => author.t1Address),
    authors.map(author => author.t1PubKeyLHS),
    authors.map(author => author.t1PubKeyRHS),
    authors.map(author => author.t2PubKey),
    owner.address
  ];
  const contract = await ethers.getContractFactory('TruthBridge');
  const bridge = await upgrades.deployProxy(contract, initArgs, { kind: 'uups' });
  bridge.address = await bridge.getAddress();
  return bridge;
}

async function deployTruthToken(supply, owner) {
  const contract = await ethers.getContractFactory('TruthToken');
  const name = 'Truth';
  const symbol = 'TRUU';
  const token = await upgrades.deployProxy(contract, [name, symbol, supply, owner.address], { kind: 'uups' });
  token.address = await token.getAddress();
  return token;
}

async function getConfirmations(bridge, method, data, expiry, t2TxId, adjustment, startPos) {
  startPos = startPos || 2; // Start from Author 2 as Author 1 always sends the tx
  adjustment = adjustment || 0;
  const numConfirmations = Number(await getNumRequiredConfirmations(bridge)) + adjustment;
  let concatenatedConfirmations = '0x';
  const confirmationHash = toConfirmationHash[method](data, expiry, t2TxId);
  for (i = startPos; i <= numConfirmations; i++) {
    const confirmation = await authors[i].account.signMessage(ethers.getBytes(confirmationHash));
    concatenatedConfirmations += strip_0x(confirmation);
  }
  return concatenatedConfirmations;
}

async function getCurrentBlockTimestamp() {
  const blockNum = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNum);
  return block.timestamp;
}

async function getNumRequiredConfirmations(bridge) {
  const numAuthors = await bridge.numActiveAuthors();
  return numAuthors - (numAuthors * 2n) / 3n;
}

async function getSingleConfirmation(method, data, expiry, t2TxId, author) {
  const confirmationHash = toConfirmationHash[method](data, expiry, t2TxId);
  return await author.account.signMessage(ethers.getBytes(confirmationHash));
}

function getTxLeafMetadata() {
  return (
    '0x1505840050368dd692d19f39657a574ff9b9cc0c584219826ab1141d101f43a19a7f3122010edfa77444027c551df2f3' +
    strip_0x(randomBytes32()) +
    'a6e6eaeff13956b192c9899a9993c16faea458458e35023800'
  );
}

async function getValidExpiry() {
  return (await getCurrentBlockTimestamp()) + EXPIRY_WINDOW;
}

async function getPermit(token, account, spender, amount, deadline) {
  deadline = deadline || Math.floor(Date.now() / 1000) + 3600;

  const domain = {
    name: await token.name(),
    version: typeof token.version === 'function' ? await token.version() : '1',
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: token.address
  };

  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }
    ]
  };

  const message = {
    owner: account.address,
    spender: spender.address,
    value: amount,
    nonce: await token.nonces(account.address),
    deadline
  };

  const signature = await account.signTypedData(domain, types, message);
  const { v, r, s } = ethers.Signature.from(signature);
  return { deadline, v, r, s };
}

async function increaseBlockTimestamp(seconds) {
  const currentBlockTimestamp = await getCurrentBlockTimestamp();
  await time.increaseTo(currentBlockTimestamp + seconds);
}

async function init(numAuthors, largeTree = false) {
  const [owner] = await ethers.getSigners();
  await hre.network.provider.send('hardhat_setBalance', [owner.address, '0xD3C21BCECCEDA1000000']); // Set at 1000 ETH
  fork = hre.network.config.forking.url.includes('mainnet') ? 'mainnet' : 'sepolia';
  console.log(`   ${fork} fork`);
  accounts = [owner];
  authors = [];

  for (let i = 0; i < numAuthors; i++) {
    const account = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({ to: account.address, value: ethers.parseEther('1'), maxFeePerGas: 100000000000n });
    authors.push(toAuthorAccount(account));
  }

  for (let i = 0; i < 20; i++) {
    const account = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({ to: account.address, value: ethers.parseEther('10'), maxFeePerGas: 100000000000n });
    accounts.push(account);
  }

  await owner.sendTransaction({ to: USDC[fork].holder, value: ethers.parseEther('10') });
  usdc = new ethers.Contract(USDC[fork].address, require('../abi/USDC.js'), ethers.provider);
  usdc.address = await usdc.getAddress();
  weth = await ethers.getContractAt('IWETH9', WETH[fork].address);
  weth.address = await weth.getAddress();
  const randomTxHash = randomHex(32);
  additionalTx = largeTree ? Array(4194305).fill(randomTxHash) : [randomTxHash];
}

function printErrorCodes() {
  [
    'AddressMismatch()',
    'AlreadyAdded()',
    'AmountTooLow()',
    'BadConfirmations()',
    'CannotChangeT2Key(bytes32)',
    'ExcessSlippage()',
    'InvalidCaller()',
    'InvalidProof()',
    'InvalidT1Key()',
    'InvalidT2Key()',
    'LiftFailed()',
    'LiftLimitHit()',
    'LowerIsUsed()',
    'MissingKeys()',
    'MissingTruth()',
    'NotAnAuthor()',
    'NotEnoughAuthors()',
    'NoRefundDue()',
    'RelayerOnly()',
    'RootHashIsUsed()',
    'T1AddressInUse(address)',
    'T2KeyInUse(bytes32)',
    'TransferFailed()',
    'TxIdIsUsed()',
    'WindowExpired()'
  ].forEach(error => console.log(`error ${error}; // ${ethers.keccak256(ethers.toUtf8Bytes(error)).slice(0, 10)}`));
}

function randomBytes32() {
  return randomHex(32);
}

const randomHex = (bytes = 32) => ethers.hexlify(ethers.randomBytes(bytes));

function randomT2TxId() {
  return Math.floor(Math.random() * 2 ** 32);
}

async function sendUSDC(recipient, amount) {
  await impersonateAccount(USDC[fork].holder);
  await usdc.connect(await ethers.getSigner(USDC[fork].holder)).transfer(recipient.address, amount);
  await stopImpersonatingAccount(USDC[fork].holder);
}

const strip_0x = bytes => (bytes.startsWith('0x') ? bytes.slice(2) : bytes);

function toAuthorAccount(account) {
  const { publicKey } = account.signingKey;
  const formatPubKey = key => `0x${key}`;
  return {
    account,
    t1Address: account.address,
    t1PubKey: formatPubKey(publicKey.slice(4, 132)),
    t1PubKeyLHS: formatPubKey(publicKey.slice(4, 68)),
    t1PubKeyRHS: formatPubKey(publicKey.slice(68, 132)),
    t2PubKey: randomHex()
  };
}

const toConfirmationHash = {
  addAuthor: function (data, expiry, t2TxId) {
    const encodedParams = coder.encode(['bytes', 'bytes32', 'uint256', 'uint32'], [data[0], data[1], expiry, t2TxId]);
    return ethers.solidityPackedKeccak256(['bytes'], [encodedParams]);
  },
  publishRoot: function (data, expiry, t2TxId) {
    const encodedParams = coder.encode(['bytes32', 'uint256', 'uint32'], [data, expiry, t2TxId]);
    return ethers.solidityPackedKeccak256(['bytes'], [encodedParams]);
  },
  removeAuthor: function (data, expiry, t2TxId) {
    const encodedParams = coder.encode(['bytes32', 'bytes', 'uint256', 'uint32'], [data[0], data[1], expiry, t2TxId]);
    return ethers.solidityPackedKeccak256(['bytes'], [encodedParams]);
  }
};

function toLittleEndianBytesStr(amount) {
  let hexStr = ethers.toBeHex(amount).slice(2);
  hexStr = hexStr.length % 2 === 0 ? hexStr : '0' + hexStr;
  const littleEndian = hexStr
    .match(/.{1,2}/g)
    .reverse()
    .join('');
  return littleEndian.padEnd(64, '0');
}

// Keep alphabetical.
module.exports = {
  createLowerProof,
  createTreeAndPublishRoot,
  deploySwapHelper,
  deployTruthBridge,
  deployTruthToken,
  expect,
  EMPTY_BYTES,
  EMPTY_BYTES_32,
  EXPIRY_WINDOW,
  getAccounts: () => accounts,
  getAuthors: () => authors,
  getConfirmations,
  getCurrentBlockTimestamp,
  getNumRequiredConfirmations,
  getPermit,
  getSingleConfirmation,
  getUSDC: () => usdc,
  getWETH: () => weth,
  getValidExpiry,
  increaseBlockTimestamp,
  init,
  MIN_AUTHORS,
  ONE_HUNDRED_BILLION,
  ONE_USDC,
  randomBytes32,
  randomHex,
  randomT2TxId,
  sendUSDC,
  strip_0x,
  toAuthorAccount,
  ZERO_ADDRESS
};
