const { MerkleTree } = require('merkletreejs');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const PROXY_LOWER_PROOF_LENGTH = 131;
const PROXY_LOWER_ID = '0x5900';
const LOWER_ID = '0x5702';
const DIRECT_LOWER_NUM_BYTES = 2;
const PROXY_LOWER_NUM_BYTES = 133;
const EXPIRY_WINDOW = 60;
const MIN_AUTHORS = 4;

let additionalTx = [];
let accounts = [];
let authors = [];

async function deployTruthBridge(truth) {
  const initArgs = [
    truth.address,
    authors.map(author => author.t1Address),
    authors.map(author => author.t1PubKeyLHS),
    authors.map(author => author.t1PubKeyRHS),
    authors.map(author => author.t2PubKey)
  ];
  const contract = await ethers.getContractFactory('TruthBridge');
  const bridge = await upgrades.deployProxy(contract, initArgs, { kind: 'uups' });
  bridge.address = await bridge.getAddress();
  return bridge;
}

async function deployTruthToken() {
  const contract = await ethers.getContractFactory('TruthToken');
  const name = '$TRUTH';
  const supply = 100000000000n;
  const token = await upgrades.deployProxy(contract, [name, supply], { kind: 'uups' });
  token.address = await token.getAddress();
  return token;
}

async function getPermit(token, account, spender, amount) {
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  const domain = {
    name: await token.name(),
    version: '1',
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

async function init(numAuthors, largeTree) {
  [owner] = await ethers.getSigners();
  accounts.push(owner);

  for (i = 0; i < 10 + numAuthors; i++) {
    const account = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({ to: account.address, value: ethers.parseEther('10') });

    if (i < numAuthors) {
      const publicKey = account.signingKey.publicKey;
      authors.push({
        account: account,
        t1Address: account.address,
        t1PubKey: '0x' + publicKey.slice(4, 132),
        t1PubKeyLHS: '0x' + publicKey.slice(4, 68),
        t1PubKeyRHS: '0x' + publicKey.slice(68, 132),
        t2PubKey: randomBytes32()
      });
    } else accounts.push(account);
  }

  const randomTxHash = randomBytes32();
  additionalTx = largeTree ? new Array(4194305).fill(randomTxHash) : [randomTxHash];
}

function printErrorCodes() {
  [
    'AddressMismatch()',
    'AlreadyAdded()',
    'BadConfirmations()',
    'CannotChangeT2Key(bytes32)',
    'InvalidProof()',
    'InvalidT1Key()',
    'LiftFailed()',
    'LiftLimitHit()',
    'LowerIsUsed()',
    'MissingKeys()',
    'NotAnAuthor()',
    'NotEnoughAuthors()',
    'RootHashIsUsed()',
    'T1AddressInUse(address)',
    'T2KeyInUse(bytes32)',
    'TxIdIsUsed()',
    'WindowExpired()'
  ].forEach(error => console.log(`error ${error}; // ${ethers.keccak256(ethers.toUtf8Bytes(error)).slice(0, 10)}`));
}

function randomHex(length) {
  const bytes = ethers.randomBytes(length);
  return ethers.hexlify(bytes);
}

function randomBytes32() {
  return randomHex(32);
}

// Keep alphabetical.
module.exports = {
  accounts: () => accounts,
  deployTruthBridge,
  deployTruthToken,
  getPermit,
  init,
  printErrorCodes,
  randomBytes32
};
