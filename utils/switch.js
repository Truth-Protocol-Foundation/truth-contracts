const { setBridgeToSepolia, restoreBridgeToMainnet } = require('./updateBridge.js');
const { execSync } = require('child_process');

const NETWORKS = ['mainnet', 'sepolia'];

function run() {
  const network = process.argv[2];
  const action = process.argv[3];

  if (!NETWORKS.includes(network)) {
    console.error(`Invalid network: "${network}`);
    process.exit(1);
  }

  console.log(`FORKING ${network.toUpperCase()}`);

  if (network === 'sepolia') {
    process.env.FORK = 'sepolia';
    setBridgeToSepolia();
  }

  try {
    if (action === 'test') execSync(`npx hardhat test`, { stdio: 'inherit' });
    else if (action === 'tune') execSync(`npx hardhat run scripts/relayerTuning.js`, { stdio: 'inherit' });
    else throw new Error(`invalid action: ${action}`);
  } catch (error) {
    console.error(error);
  } finally {
    if (network === 'sepolia') restoreBridgeToMainnet();
  }
}

run();
