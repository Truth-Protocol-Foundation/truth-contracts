const path = require('path');
const fs = require('fs');
const { mainnet, sepolia } = require('./addresses');

const BRIDGE_PATH = path.resolve(__dirname, '../contracts/TruthBridge.sol');

function restoreBridgeToMainnet() {
  fs.writeFileSync(BRIDGE_PATH, mainnetContract, 'utf8');
}

function setBridgeToSepolia() {
  mainnetContract = fs.readFileSync(BRIDGE_PATH, 'utf8');
  const sepoliaContract = Object.entries(mainnet).reduce((acc, [key, address]) => acc.replaceAll(address, sepolia[key]), mainnetContract);
  fs.writeFileSync(BRIDGE_PATH, sepoliaContract, 'utf8');
}

module.exports = {
  restoreBridgeToMainnet,
  setBridgeToSepolia
};
