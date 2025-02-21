const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const mainnet = {
  feed: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  pool: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
}

const sepolia = {
  feed: '0xcE4881900850816b459bB9126fC778783835296B',
  pool: '0x3289680dD4d6C10bb19b899729cda5eEF58AEfF1',
  usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  weth: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
}

function run() {
  const contractPath = path.resolve(__dirname, './contracts/TruthBridge.sol');
  const originalContract = fs.readFileSync(contractPath, 'utf8');
  try {
    const tempContract = Object.entries(mainnet).reduce((acc, [k,v]) => acc.replaceAll(v, sepolia[k]), originalContract);
    fs.writeFileSync(contractPath, tempContract, 'utf8');
    process.env.FORK = 'sepolia';
    execSync(`npx hardhat test`, { stdio: 'inherit' });
  } catch (error) {
    console.error('Error running command:', error);
  } finally {
    fs.writeFileSync(contractPath, originalContract, 'utf8');
  }
}

run();
