const addresses = require('./addresses.js');
const network = hre.network.config.forking.url.includes('mainnet') ? 'mainnet' : 'sepolia';
const USDC_ADDRESS = addresses[network].usdc;
const refundGas = USDC_ADDRESS.toLowerCase() === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' ? 83700 : 32750;
const TX_PER_REFUND = 20;

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

  const triggerRefund = Math.random() < 1 / TX_PER_REFUND;

  const estimateTx = {
    to: bridge.address,
    data: bridge.interface.encodeFunctionData(method, [1n, ...innerArgs, false]),
    from: relayerAddress
  };

  let rawEstimate;
  try {
    rawEstimate = await provider.estimateGas(estimateTx);
  } catch (e) {
    rawEstimate = 150000;
  }

  rawEstimate = Number(rawEstimate) + (triggerRefund ? refundGas : 0);
  const gasLimit = Math.ceil(rawEstimate * 1.3);

  const traceTx = {
    ...estimateTx,
    maxFeePerGas: '0x' + maxFeePerGas.toString(16),
    maxPriorityFeePerGas: '0x' + maxPriorityFeePerGas.toString(16),
    gas: '0x' + gasLimit.toString(16)
  };

  const { gas } = await provider.send('debug_traceCall', [traceTx, 'latest']);
  const gasEstimate = Number(gas) + 24;
  const gasCost = Math.round((gasEstimate + refundGas / TX_PER_REFUND) * 1.0075);
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

module.exports = { costLift, costLower, refundGas };
