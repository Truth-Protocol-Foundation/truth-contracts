require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-ledger');
require('@openzeppelin/hardhat-upgrades');
require('hardhat-gas-reporter');
require('hardhat-contract-sizer');
require('dotenv').config();

task('deploy')
  .addPositionalParam('contractType')
  .setAction(async (args, hre) => {
    await hre.run('compile');
    const { ethers, upgrades, network: { name: network } } = hre;
    const [signer] = await ethers.getSigners();
    const signerBalance = await ethers.provider.getBalance(signer.address);
    const contractName = getContractName(args.contractType);
    const initArgs = getInitArgs(args.contractType, network);

    console.log(`\nDeploying ${contractName} on ${network} using account ${signer.address}...`);
    const contractFactory = await ethers.getContractFactory(contractName);
    const proxy = await upgrades.deployProxy(contractFactory, initArgs, { kind: 'uups' });
    const proxyAddress = await proxy.getAddress();
    const cost = ethers.formatEther(signerBalance - await ethers.provider.getBalance(signer.address));
    console.log(`\nDeployed ${contractName} at ${proxyAddress} for ${cost} ETH\n`);

    await delay(20);
    await hre.run('verify:verify', { address: proxyAddress });
    const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
    await hre.run('verify:verify', { address: implementationAddress });
  });

task('upgrade')
  .addPositionalParam('contractType')
  .addPositionalParam('proxyAddress')
  .setAction(async (args, hre) => {
    await hre.run('compile');
    const { ethers, upgrades, network: { name: network } } = hre;
    const [signer] = await ethers.getSigners();
    const signerBalance = await ethers.provider.getBalance(signer.address);
    const contractName = getContractName(args.contractType);

    console.log(`\nUpgrading ${contractName} on ${network} using account ${signer.address}...`);
    const contractFactory = await ethers.getContractFactory(contractName);
    await upgrades.upgradeProxy(args.proxyAddress, contractFactory);
    const cost = ethers.formatEther(signerBalance - await ethers.provider.getBalance(signer.address));
    console.log(`\nUpgraded ${contractName} at ${args.proxyAddress} for ${cost} ETH\n`);

    await delay(20);
    const implementationAddress = await upgrades.erc1967.getImplementationAddress(args.proxyAddress);
    await hre.run('verify:verify', { address: implementationAddress });
  });

function getInitArgs(contract, network) {
  if (contract === 'token') {
    return ['$TRUTH', 100000000000n];
  } else if (contract === 'bridge') {
    const authors = require('./authors.json')[network];
    return [
      authors.map(author => author.ethAddress),
      authors.map(author => '0x' + author.ethUncompressedPublicKey.slice(4, 68)),
      authors.map(author => '0x' + author.ethUncompressedPublicKey.slice(68, 132)),
      authors.map(author => author.t2PublicKey)
    ];
  } else {
    throw new Error(`Invalid contract: ${contract}`);
  }
}

function getContractName(contract) {
  return 'Truth' + contract[0].toUpperCase() + contract.slice(1).toLowerCase();
}

function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

module.exports = {
  mocha: {
    timeout: 100000000000
  },
  solidity: {
    compilers: [
      {
        version: '0.8.28',
        settings: {
          optimizer: {
            enabled: true,
            runs: 10000,
            details: { yul: true }
          },
          evmVersion: 'cancun'
        }
      }
    ]
  },
  networks: {
    hardhat: {
      // forking: {
      //   url: process.env.MAINNET_ALCHEMY_OR_INFURA_URL || ''
      // }
    },
    sepolia: {
      url: process.env.SEPOLIA_ALCHEMY_OR_INFURA_URL || '',
      accounts: [process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY || '0000000000000000000000000000000000000000000000000000000000000000'],
      type: 2,
      maxFeePerGas: 30000000000, // 30 Gwei
      maxPriorityFeePerGas: 2000000000, // 2 Gwei
      timeout: 1200000,
      pollingInterval: 4000
    },
    mainnet: {
      url: process.env.MAINNET_ALCHEMY_OR_INFURA_URL || '',
      ledgerAccounts: [process.env.LEDGER_MAINNET_DEPLOYER_ADDRESS || '0000000000000000000000000000000000000000000000000000000000000000'],
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
    showMethodSig: true,
  }
};
