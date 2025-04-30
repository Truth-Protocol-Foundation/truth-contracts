const REFUND_GAS_COST = 83730n;
const TX_PER_REFUND = 20;

async function calcLiftGas(usdc, bridge, amount, user, permit, relayer) {
  const method = bridge.connect(relayer).relayerLift;
  const args = [1n, amount, user.address, permit.v, permit.r, permit.s, false];
  let overestimationFactor;

  const fullBalance = (await usdc.balanceOf(user.address)) === amount;
  const firstPermit = (await usdc.nonces(user.address)) === 0n;

  if (fullBalance && firstPermit) overestimationFactor = 122632n;
  else if (fullBalance && !firstPermit) overestimationFactor = 126533n;
  else if (!fullBalance && firstPermit) overestimationFactor = 117946n;
  else overestimationFactor = 120285n;

  return calcGas(method, bridge, args, overestimationFactor);
}

async function calcLowerGas(bridge, lowerProof, relayer) {
  const method = bridge.connect(relayer).relayerLower;
  const args = [1n, lowerProof, false];
  const overestimationFactor = 101543n;
  return calcGas(method, bridge, args, overestimationFactor);
}

async function calcGas(method, bridge, args, overestimationFactor) {
  const doRefund = Math.random() < 1 / TX_PER_REFUND;
  const gasEstimate = await method.estimateGas(...args);
  const methodGas = (gasEstimate * 100000n) / overestimationFactor;
  const refundContribution = REFUND_GAS_COST / BigInt(TX_PER_REFUND);
  const gas = ((methodGas + refundContribution)  * 1005n) / 1000n; // 0.5% buffer
  const txCostEstimate = await estimateTxCost(bridge, gas);
  const gasLimit = doRefund ? gasEstimate + REFUND_GAS_COST * 2n : gasEstimate;

  return { gas, methodGas, gasLimit, txCostEstimate, doRefund };
}

async function estimateTxCost(bridge, gas) {
  const feeData = await ethers.provider.getFeeData();
  const block = await ethers.provider.getBlock('latest');

  const baseFee = block.baseFeePerGas;
  const maxFee = feeData.maxFeePerGas;
  const tip = feeData.maxPriorityFeePerGas;

  const effectiveGasPrice = baseFee + tip > maxFee ? maxFee : baseFee + tip;
  return (gas * effectiveGasPrice) / (await bridge.usdcEth());
}

module.exports = { calcLiftGas, calcLowerGas };
