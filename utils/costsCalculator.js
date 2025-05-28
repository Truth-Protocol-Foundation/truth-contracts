const { USDC_ADDRESS } = require('../config');

const RELAYER_REFUND_FREQUENCY = 20; // Average tx between refunds per relayer
const DUMMY_GAS_COST = 1; // Placeholder for estimating gas cost with no refund triggered
const DUMMY_TRIGGER_REFUND = false; // Placeholder for estimating gas cost with no refund triggered
const GAS_LIMIT_MULTIPLIER = 1.3; // Add 30%
const MINOR_GAS_ADJUSTMENT = 24;
const SLIPPAGE_RECOVERY_BUFFER = 1.0075; // Add 0.75% to the gas cost to recover any Uniswap slippage

const isMainnetUSDC = USDC_ADDRESS.toLowerCase() === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const relayerRefundGasUse = isMainnetUSDC ? 83700 : 32820; // The real USDC token uses more gas during refunds

async function costLift(provider, bridge, relayerAddress, innerArgs) {
  return await calculateCosts('relayerLift', provider, bridge, relayerAddress, innerArgs);
}

async function costLower(provider, bridge, relayerAddress, innerArgs) {
  return await calculateCosts('relayerLower', provider, bridge, relayerAddress, innerArgs);
}

async function calculateCosts(method, provider, bridge, relayerAddress, innerArgs) {
  const triggerRefund = Math.random() < 1 / RELAYER_REFUND_FREQUENCY;

  const block = await provider.getBlock('latest');
  const feeData = await provider.getFeeData();
  const maxPriorityFeePerGas = Number(feeData.maxPriorityFeePerGas);
  const totalFeePerGas = Number(block.baseFeePerGas) + maxPriorityFeePerGas;
  const maxFeePerGas = Math.max(Number(feeData.maxFeePerGas), totalFeePerGas);

  const data = bridge.interface.encodeFunctionData(method, [DUMMY_GAS_COST, ...innerArgs, DUMMY_TRIGGER_REFUND]);
  const estimateTx = { to: bridge.address, from: relayerAddress, data };
  const coreGasEstimate = Number(await provider.estimateGas(estimateTx)) + (triggerRefund ? relayerRefundGasUse : 0);

  const gasLimit = Math.ceil(coreGasEstimate * GAS_LIMIT_MULTIPLIER);
  const trace = await provider.send('debug_traceCall', [{ ...estimateTx, maxFeePerGas, maxPriorityFeePerGas, gas: gasLimit }, 'latest']);
  const gasEstimate = Number(trace.gas) + MINOR_GAS_ADJUSTMENT;
  const gasCost = Math.round((gasEstimate + relayerRefundGasUse / RELAYER_REFUND_FREQUENCY) * SLIPPAGE_RECOVERY_BUFFER);
  const effectiveGasPrice = Math.min(totalFeePerGas, maxFeePerGas);
  const usdcEth = Number(await bridge.usdcEth());

  const costEstimate = Math.floor((gasCost * effectiveGasPrice) / usdcEth);
  const gasSettings = { gasLimit, maxFeePerGas, maxPriorityFeePerGas };
  const args = [gasCost, ...innerArgs, triggerRefund];

  return { args, costEstimate, gasEstimate, gasSettings };
}

module.exports = { costLift, costLower, relayerRefundGasUse };
