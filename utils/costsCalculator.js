const addresses = require('./addresses.js');
const network = hre.network.config.forking.url.includes('mainnet') ? 'mainnet' : 'sepolia';
const USDC_ADDRESS = addresses[network].usdc;

const RELAYER_REFUND_FREQUENCY = 20; // Average tx between refunds per relayer
const DUMMY_GAS_COST = 1n; // Placeholder for estimating gas cost with no refund triggered
const DUMMY_TRIGGER_REFUND = false; // Placeholder for estimating gas cost with no refund triggered
const CORE_GAS_FALLBACK = 150000; // Max expected gas use excluding refund gas
const GAS_LIMIT_MULTIPLIER = 1.3 // Add 30%
const MINOR_GAS_ADJUSTMENT = 24;
const SLIPPAGE_RECOVERY_BUFFER = 1.0075 // Add 0.75% to the gas cost to recover any Uniswap slippage

const isMainnetUSDC = USDC_ADDRESS.toLowerCase() === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const relayerRefundGasUse = isMainnetUSDC ? 83700 : 32820; // The real USDC token uses more gas during refunds

async function costLift(provider, bridge, relayerAddress, innerArgs) {
  return await calculateCosts('relayerLift', provider, bridge, relayerAddress, innerArgs);
}

async function costLower(provider, bridge, relayerAddress, innerArgs) {
  return await calculateCosts('relayerLower', provider, bridge, relayerAddress, innerArgs);
}

async function calculateCosts(method, provider, bridge, relayerAddress, innerArgs) {
  const feeData = await provider.getFeeData();
  const maxPriorityFeePerGas = BigInt(feeData.maxPriorityFeePerGas);
  const baseFeePerGas = BigInt((await provider.getBlock('latest')).baseFeePerGas);
  const totalFeePerGas = baseFeePerGas + maxPriorityFeePerGas;
  let maxFeePerGas = BigInt(feeData.maxFeePerGas);
  if (maxFeePerGas < totalFeePerGas) maxFeePerGas = totalFeePerGas;

  const triggerRefund = Math.random() < 1 / RELAYER_REFUND_FREQUENCY;
  const baseGasPayload = bridge.interface.encodeFunctionData(method, [DUMMY_GAS_COST, ...innerArgs, DUMMY_TRIGGER_REFUND]);

  const estimateTx = {
    to: bridge.address,
    data: baseGasPayload,
    from: relayerAddress
  };

  let coreGasEstimate;

  try {
    coreGasEstimate = await provider.estimateGas(estimateTx);
  } catch (_) {
    coreGasEstimate = CORE_GAS_FALLBACK;
  }

  coreGasEstimate = Number(coreGasEstimate) + (triggerRefund ? relayerRefundGasUse : 0);
  const gasLimit = Math.ceil(coreGasEstimate * GAS_LIMIT_MULTIPLIER);

  const traceTx = {
    ...estimateTx,
    maxFeePerGas: '0x' + maxFeePerGas.toString(16),
    maxPriorityFeePerGas: '0x' + maxPriorityFeePerGas.toString(16),
    gas: '0x' + gasLimit.toString(16)
  };

  const { gas } = await provider.send('debug_traceCall', [traceTx, 'latest']);
  const gasEstimate = Number(gas) + MINOR_GAS_ADJUSTMENT;
  const gasCost = Math.round((gasEstimate + relayerRefundGasUse / RELAYER_REFUND_FREQUENCY) * SLIPPAGE_RECOVERY_BUFFER);
  const effectiveGasPrice = Number(totalFeePerGas < maxFeePerGas ? totalFeePerGas : maxFeePerGas);
  const usdcEth = Number(await bridge.usdcEth());

  return {
    args: [gasCost, ...innerArgs, triggerRefund],
    costEstimate: Math.floor((gasCost * effectiveGasPrice) / usdcEth),
    gasEstimate,
    gasSettings: {
      gasLimit,
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString()
    }
  };
}

module.exports = { costLift, costLower, relayerRefundGasUse };