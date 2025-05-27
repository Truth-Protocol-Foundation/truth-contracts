const addresses = require('./addresses.js');
const network = hre.network.config.forking.url.includes('mainnet') ? 'mainnet' : 'sepolia';
const REFUND_GAS_COST = addresses[network].usdc.toLowerCase() === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' ? 83700 : 32750;
const TX_PER_REFUND = 20;
const REFUND_CONTRIBUTION = parseInt(REFUND_GAS_COST / TX_PER_REFUND);
const DUMMY_GAS_COST = 1n;

async function costLift(bridge, relayer, amount, permit, user) {
  const args = [DUMMY_GAS_COST, amount, user.address, permit.v, permit.r, permit.s, false];
  return calculateCosts(bridge, relayer, 'relayerLift', args, 140000);
}

async function costLower(bridge, relayer, lowerProof) {
  const args = [DUMMY_GAS_COST, lowerProof, false];
  return calculateCosts(bridge, relayer, 'relayerLower', args, 150000);
}

async function calculateCosts(bridge, relayer, method, args, maxGas) {
  const triggerRefund = Math.random() < 1 / TX_PER_REFUND;
  const data = bridge.interface.encodeFunctionData(method, args);
  const feeData = await ethers.provider.getFeeData();
  const baseFeePerGas = BigInt((await ethers.provider.getBlock('latest')).baseFeePerGas);
  const maxPriorityFeePerGas = BigInt(feeData.maxPriorityFeePerGas);

  let maxFeePerGas = BigInt(feeData.maxFeePerGas);
  if (maxFeePerGas < baseFeePerGas + maxPriorityFeePerGas) {
    maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas;
  }

  maxGas += triggerRefund ? REFUND_GAS_COST : 0;
  const gasLimit = Math.ceil(maxGas * 1.3);

  const traceTx = {
    to: bridge.address,
    data,
    from: relayer.address,
    maxFeePerGas: '0x' + maxFeePerGas.toString(16),
    maxPriorityFeePerGas: '0x' + maxPriorityFeePerGas.toString(16),
    gas: '0x' + gasLimit.toString(16)
  };

  const { gas } = await ethers.provider.send('debug_traceCall', [traceTx, 'latest']);
  const gasEstimate = Number(gas) + 24;
  const gasCost = Math.round((gasEstimate + REFUND_CONTRIBUTION) * 1.0075); // 0.75% buffer

  const effectiveGasPrice = baseFeePerGas + maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : baseFeePerGas + maxPriorityFeePerGas;
  const usdcEth = Number(await bridge.usdcEth());
  const txCostEstimate = Math.floor((gasCost * Number(effectiveGasPrice)) / usdcEth);

  return { gasEstimate, gasCost, gasLimit, refundGas: REFUND_GAS_COST, triggerRefund, txCostEstimate };
}

module.exports = { costLift, costLower };
