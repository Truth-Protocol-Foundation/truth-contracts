const addresses = require('./addresses.js');
const network = hre.network.config.forking.url.includes('mainnet') ? 'mainnet' : 'sepolia';
const REFUND_GAS_COST = addresses[network].usdc.toLowerCase() === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' ? 79770 : 31340;
const TX_PER_REFUND = 20;
const REFUND_CONTRIBUTION = parseInt(REFUND_GAS_COST / TX_PER_REFUND);
const DUMMY_GAS_COST = 1n;

async function costLift(bridge, relayer, amount, permit, user) {
  const args = [DUMMY_GAS_COST, amount, user.address, permit.v, permit.r, permit.s, false];
  return calculateCosts(bridge, relayer, 'relayerLift', args, 120000);
}

async function costLower(bridge, relayer, lowerProof) {
  const args = [DUMMY_GAS_COST, lowerProof, false];
  return calculateCosts(bridge, relayer, 'relayerLower', args, 150000);
}

async function calculateCosts(bridge, relayer, method, args, maxGas) {
  const triggerRefund = Math.random() < 1 / TX_PER_REFUND;
  const data = bridge.interface.encodeFunctionData(method, args);
  const feeData = await ethers.provider.getFeeData();
  const maxFeePerGas = parseInt(feeData.maxFeePerGas);
  const maxPriorityFeePerGas = parseInt(feeData.maxPriorityFeePerGas);
  maxGas += triggerRefund ? REFUND_GAS_COST : 0;
  const gasLimit = parseInt(maxGas * 1.3);
  const { gas } = await ethers.provider.send('debug_traceCall', [
    { to: bridge.address, data, from: relayer.address, maxFeePerGas, maxPriorityFeePerGas, gasLimit },
    'latest'
  ]);
  const gasCost = parseInt((gas + REFUND_CONTRIBUTION) * 1.005); // 0.5% buffer
  const { baseFeePerGas } = await ethers.provider.getBlock('latest');
  const baseFee = parseInt(baseFeePerGas);
  const effectiveGasPrice = baseFee + maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : baseFee + maxPriorityFeePerGas;
  const usdcEth = parseInt(await bridge.usdcEth());
  const estimatedCost = parseInt((gasCost * effectiveGasPrice) / usdcEth);

  return { gasEstimate: gas, gasCost, gasLimit, refundGas: REFUND_CONTRIBUTION, triggerRefund, txCostEstimate: estimatedCost };
}

module.exports = { costLift, costLower };
