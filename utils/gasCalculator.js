const addresses = require('./addresses.js');

const TX_PER_REFUND = 20;
const DUMMY_GAS_COST = 1n;

async function calculateLift(amount, bridge, permit, relayer, usdc, user) {
  const method = bridge.connect(relayer).relayerLift;
  const args = [DUMMY_GAS_COST, amount, user.address, permit.v, permit.r, permit.s, false];

  const fullBalance = (await usdc.balanceOf(user.address)) === amount;
  const firstPermit = (await usdc.nonces(user.address)) === 0n;
  const realUSDC = usdc.address.toLowerCase() === addresses.mainnet.usdc.toLowerCase();

  let overestimationFactor;
  if (fullBalance && firstPermit) overestimationFactor = realUSDC ? 122632n : 126536n;
  else if (fullBalance && !firstPermit) overestimationFactor = realUSDC ? 126533n : 126532n;
  else if (!fullBalance && firstPermit) overestimationFactor = realUSDC ? 117946n : 122625n;
  else overestimationFactor = realUSDC ? 120285n : 126534n;

  return calculateCosts(args, bridge, method, overestimationFactor, usdc);
}

async function calculateLower(bridge, lowerProof, relayer, usdc) {
  const method = bridge.connect(relayer).relayerLower;
  const args = [DUMMY_GAS_COST, lowerProof, false];
  const overestimationFactor = 101543n;
  return calculateCosts(args, bridge, method, overestimationFactor, usdc);
}

async function calculateCosts(args, bridge, method, overestimationFactor, usdc) {
  const refundGas = usdc.address.toLowerCase() === addresses.mainnet.usdc.toLowerCase() ? 83700n : 32750n;
  const triggerRefund = Math.random() < 1 / TX_PER_REFUND;
  const txGasEstimate = await method.estimateGas(...args);
  const methodGas = (txGasEstimate * 100000n) / overestimationFactor;
  const refundContribution = refundGas / BigInt(TX_PER_REFUND);
  let gasCost = methodGas + refundContribution;
  gasCost = (gasCost * 1075n) / 1000n; // 0.75% buffer
  const estimatedCost = await estimateTxCost(bridge, gasCost);
  const gasLimit = triggerRefund === true ? txGasEstimate + refundGas * 2n : txGasEstimate;

  return { estimatedCost, gasCost, gasLimit, methodGas, refundGas, triggerRefund };
}

async function estimateTxCost(bridge, gasCost) {
  const feeData = await ethers.provider.getFeeData();
  const block = await ethers.provider.getBlock('latest');

  const baseFee = block.baseFeePerGas;
  const maxFee = feeData.maxFeePerGas;
  const tip = feeData.maxPriorityFeePerGas;

  const effectiveGasPrice = baseFee + tip > maxFee ? maxFee : baseFee + tip;
  return (gasCost * effectiveGasPrice) / (await bridge.usdcEth());
}

module.exports = { calculateLift, calculateLower };
