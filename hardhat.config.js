require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-ledger');
require('@openzeppelin/hardhat-upgrades');
require('hardhat-gas-reporter');
require('hardhat-contract-sizer');
require('dotenv').config();
const { setBridgeToSepolia, restoreBridgeToMainnet } = require('./utils/updateBridge.js');

const FORK = process.env.FORK || 'mainnet';
const FORKING_URL = FORK === 'sepolia' ? process.env.SEPOLIA_ALCHEMY_OR_INFURA_URL : process.env.MAINNET_ALCHEMY_OR_INFURA_URL;

const TOKEN_NAME = 'Truth';
const TOKEN_SYMBOL = 'TRUU';
const TOKEN_SUPPLY = 100000000000n;

task('implementation')
  .addPositionalParam('contractType')
  .setAction(async (args, hre) => {
    const { ethers, network } = hre;
    if (sepoliaBridge(network, args)) setBridgeToSepolia();
    await hre.run('compile');

    try {
      const [signer] = await ethers.getSigners();
      const signerBalance = await ethers.provider.getBalance(signer.address);
      const contractName = getContractName(args.contractType);
      console.log(`\nDeploying ${contractName} implementation on ${network.name} using account ${signer.address}...`);
      const contractFactory = await ethers.getContractFactory(contractName);
      const implementation = await contractFactory.deploy();
      const impAddress = await implementation.getAddress();
      const cost = ethers.formatEther(signerBalance - (await ethers.provider.getBalance(signer.address)));
      console.log(`\nDeployed ${contractName} implementation at ${impAddress} for ${cost} ETH\n`);
      await delay(20);
      await verify(hre, impAddress);
    } finally {
      if (sepoliaBridge(network, args)) restoreBridgeToMainnet();
    }
  });

task('deploy')
  .addPositionalParam('contractType')
  .addOptionalParam('env')
  .addOptionalParam('token')
  .addOptionalParam('owner')
  .setAction(async (args, hre) => {
    const { ethers, upgrades, network } = hre;
    if (sepoliaBridge(network, args)) setBridgeToSepolia();
    await hre.run('compile');

    try {
      const [signer] = await ethers.getSigners();
      const signerBalance = await ethers.provider.getBalance(signer.address);
      const contractName = getContractName(args.contractType);
      const initArgs = getInitArgs(args, network, signer);

      console.log(`\nDeploying ${contractName} on ${network.name} using account ${signer.address}...`);
      const contractFactory = await ethers.getContractFactory(contractName);
      const proxy = await upgrades.deployProxy(contractFactory, initArgs, { kind: 'uups' });
      const proxyAddress = await proxy.getAddress();
      const cost = ethers.formatEther(signerBalance - (await ethers.provider.getBalance(signer.address)));
      console.log(`\nDeployed ${contractName} at ${proxyAddress} for ${cost} ETH\n`);

      await delay(30);
      await verify(hre, await upgrades.erc1967.getImplementationAddress(proxyAddress));
      await verify(hre, proxyAddress);
    } finally {
      if (sepoliaBridge(network, args)) restoreBridgeToMainnet();
    }
  });

task('manifest')
  .addPositionalParam('contractType')
  .addPositionalParam('proxyAddress')
  .setAction(async (args, hre) => {
    const { ethers, network } = hre;
    if (sepoliaBridge(network, args)) setBridgeToSepolia();
    await hre.run('compile');

    try {
      const contractName = getContractName(args.contractType);
      const contractFactory = await ethers.getContractFactory(contractName);
      console.log(`Updating ${contractName} manifest for ${args.proxyAddress} on ${network.name}`);
      await upgrades.forceImport(args.proxyAddress, contractFactory);
    } finally {
      if (sepoliaBridge(network, args)) restoreBridgeToMainnet();
    }
  });

task('validate')
  .addPositionalParam('contractType')
  .addPositionalParam('proxyAddress')
  .setAction(async (args, hre) => {
    const { ethers, network } = hre;
    if (sepoliaBridge(network, args)) setBridgeToSepolia();
    await hre.run('compile');

    try {
      const contractName = getContractName(args.contractType);
      const contractFactory = await ethers.getContractFactory(contractName);

      console.log(`\nValidating new ${contractName} implementation...`);
      await upgrades.validateImplementation(contractFactory);

      console.log(`\nValidating upgrade safety for proxy at ${args.proxyAddress}...`);
      await upgrades.validateUpgrade(args.proxyAddress, contractFactory);

      console.log('\nResult: Safe for upgrade');
    } catch (error) {
      console.error('\nResult:', error);
    } finally {
      if (sepoliaBridge(network, args)) restoreBridgeToMainnet();
    }
  });

function getInitArgs(args, network, signer) {
  let owner;

  if (args.owner === undefined) {
    if (network.name === 'mainnet') {
      console.log('\nMust specify "--owner" for mainnet, exiting.');
      process.exit(1);
    } else {
      owner = signer.address;
      console.log(`\nNo owner specified, owner will be deployer: ${owner}`);
    }
  } else owner = args.owner;

  if (args.contractType === 'token') {
    return [TOKEN_NAME, TOKEN_SYMBOL, TOKEN_SUPPLY, owner];
  } else if (args.contractType === 'bridge') {
    const authors = require('./authors.json')[args.env];
    return [
      args.token,
      authors.map(author => author.ethAddress),
      authors.map(author => '0x' + author.ethUncompressedPublicKey.slice(4, 68)),
      authors.map(author => '0x' + author.ethUncompressedPublicKey.slice(68, 132)),
      authors.map(author => author.t2PublicKey),
      owner
    ];
  } else {
    throw new Error(`Invalid contract: ${contract}`);
  }
}

function getContractName(contract) {
  return 'Truth' + contract[0].toUpperCase() + contract.slice(1).toLowerCase();
}

function sepoliaBridge(network, args) {
  return network.name === 'sepolia' && args.contractType === 'bridge';
}

function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function verify(hre, address) {
  try {
    await hre.run('verify:verify', { address });
  } catch (error) {
    console.log('ignoring supposed verify "error"');
  }
}

module.exports = {
  mocha: {
    timeout: 100000000000
  },
  solidity: {
    compilers: [
      {
        version: '0.8.30',
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000000,
            details: { yul: true }
          }
        }
      }
    ]
  },
  networks: {
    hardhat: {
      forking: {
        url: FORKING_URL
      }
    },
    sepolia: {
      url: process.env.SEPOLIA_ALCHEMY_OR_INFURA_URL || '',
      accounts: process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY ? [process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY] : undefined,
      ledgerAccounts: process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY
        ? undefined
        : [process.env.SEPOLIA_DEPLOYER_LEDGER_ADDRESS || '0x0000000000000000000000000000000000000000'],
      type: 2,
      maxFeePerGas: 20000000000, // 20 Gwei
      maxPriorityFeePerGas: 2000000000, // 2 Gwei
      timeout: 1200000,
      pollingInterval: 4000
    },
    mainnet: {
      url: process.env.MAINNET_ALCHEMY_OR_INFURA_URL || '',
      accounts: process.env.MAINNET_DEPLOYER_PRIVATE_KEY ? [process.env.MAINNET_DEPLOYER_PRIVATE_KEY] : undefined,
      ledgerAccounts: process.env.MAINNET_DEPLOYER_PRIVATE_KEY
        ? undefined
        : [process.env.MAINNET_DEPLOYER_LEDGER_ADDRESS || '0x0000000000000000000000000000000000000000'],
      type: 2,
      maxFeePerGas: 30000000000, // 30 Gwei
      maxPriorityFeePerGas: 2000000000, // 2 Gwei
      timeout: 1200000,
      pollingInterval: 4000
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || ''
  },
  gasReporter: {
    enabled: true,
    showMethodSig: true
  }
};
