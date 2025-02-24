const { updateContract, restoreContract } = require('./updateContractToSepolia');
const { execSync } = require('child_process');

function run() {
  const originalContract = updateContract();
  process.env.FORK = 'sepolia';
  try {
    execSync(`npx hardhat test`, { stdio: 'inherit' });
  } catch (error) {
    console.error('Error running tests:', error);
  } finally {
    restoreContract(originalContract);
  }
}

run();
