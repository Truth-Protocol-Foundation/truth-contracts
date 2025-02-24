const fs = require('fs');
const path = require('path');

const mainnet = {
  feed: '0x986b5E1e1755e3C2440e960477f25201B0a8bbD4',
  pool: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
  usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
};

const sepolia = {
  feed: '0xcE4881900850816b459bB9126fC778783835296B',
  pool: '0x3289680dD4d6C10bb19b899729cda5eEF58AEfF1',
  usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  weth: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'
};

const contractPath = path.resolve(__dirname, '../contracts/TruthBridge.sol');

function updateContract() {
  const original = fs.readFileSync(contractPath, 'utf8');
  const updated = Object.entries(mainnet).reduce((acc, [key, mainAddr]) => acc.replaceAll(mainAddr, sepolia[key]), original);
  fs.writeFileSync(contractPath, updated, 'utf8');
  return original;
}

function restoreContract(original) {
  fs.writeFileSync(contractPath, original, 'utf8');
}

module.exports = { updateContract, restoreContract };
