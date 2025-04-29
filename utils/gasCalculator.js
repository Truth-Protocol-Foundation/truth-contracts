const TX_PER_REFUND = 20;
const REFUND_GAS = 98700n;
const REFUND_GAS_CUT = REFUND_GAS / BigInt(TX_PER_REFUND);
const DUMMY_GAS_USE = 1n;
const DUMMY_REFUND = false;

async function calcGas(relayerFn, args, overestimate) {
  const refund = Math.random() < 0.05;
  const gasEstimate = await relayerFn.estimateGas(...args);
  const adjustedEstimate = (gasEstimate * 100000n) / overestimate;

  return {
    gasLimit: refund ? gasEstimate + REFUND_GAS * 2n : gasEstimate,
    gasUse: ((adjustedEstimate + REFUND_GAS_CUT) * 101n) / 100n,
    refund
  };
}

async function calcLiftGas(usdc, bridge, amount, user, permit, relayer) {
  const relayerFn = bridge.connect(relayer).relayerLift;
  const args = [DUMMY_GAS_USE, amount, user.address, permit.v, permit.r, permit.s, DUMMY_REFUND];
  const fullBalance = (await usdc.balanceOf(user.address)) === amount;
  const firstPermit = (await usdc.nonces(user.address)) === 0n;
  const overestimate = fullBalance ? 126533n : firstPermit ? 120285n : 117945n;
  return calcGas(relayerFn, args, overestimate);
}

async function calcLowerGas(bridge, lowerProof, relayer) {
  const relayerFn = bridge.connect(relayer).relayerLower;
  const args = [DUMMY_GAS_USE, lowerProof, DUMMY_REFUND];
  const overestimate = 101543n;
  return calcGas(relayerFn, args, overestimate);
}

module.exports = { calcLiftGas, calcLowerGas };
