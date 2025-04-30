const { calcLiftGas, calcLowerGas } = require('../utils/gasCalculator.js');
const {
  createLowerProof,
  deploySwapHelper,
  deployBridge,
  deployToken,
  getAccounts,
  getPermit,
  getUSDC,
  getWETH,
  init,
  ONE_USDC,
  sendUSDC,
  setupRelayerToken
} = require('../utils/helper.js');

const ROUNDS = 100;
const NUM_RELAYERS = 3;
const DELTA_SMOOTHING = 0.2; // (0.1 = slow, 0.5 = fast)
const MIN_USDC_AMOUNT = Number(5n * ONE_USDC);
const MAX_USDC_AMOUNT = Number(100n * ONE_USDC);
const RELAYER_BASE_BALANCE = ethers.parseEther('0.33');
const HEADER =
  'Method, Gas Requested, Calculated Gas, Used Gas, Excess Requested, Calculation Diff, Correct, Estimated Tx Cost, Actual Tx Cost, Tx Cost Diff, USDC Cost';
const LOG_GAS = true;

async function main() {
  let bridge, truth, usdc, weth, swapHelper;
  let owner;
  let relayers = [];
  let txCt = 0;
  let totalFees = 0n;
  let scale = 1;
  let emaDelta;

  console.log('Initializing relayer tuning...\n');

  const network = await init(5);

  [owner, ...users] = getAccounts();

  truth = await deployToken(owner);
  bridge = await deployBridge(truth, owner);
  usdc = await getUSDC();
  weth = await getWETH();
  swapHelper = await deploySwapHelper();

  for (let i = 0; i < NUM_RELAYERS; i++) {
    const relayer = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({ to: relayer.address, value: RELAYER_BASE_BALANCE });
    await bridge.registerRelayer(relayer.address);
    relayers.push(relayer);
  }

  await sendUSDC(bridge, 1000000n * ONE_USDC);
  const amount = ethers.parseEther('10');

  if (network === 'sepolia') {
    scale = 10;
    await setupRelayerToken(owner, bridge, usdc, amount);
    await setupRelayerToken(owner, swapHelper, usdc, amount);
  } else {
    await weth.deposit({ value: amount });
    await weth.transfer(swapHelper.address, amount);
  }

  if (LOG_GAS) console.log(HEADER);
  else console.log(`\nRunning for ${ROUNDS} rounds...\n`);

  for (let round = 1; round <= ROUNDS; round++) {
    const txRate = Math.floor(Math.random() * (100 - 20 + 1)) + 20;

    for (let i = 0; i < txRate; i++) {
      const user = users[Math.floor(Math.random() * users.length)];
      const amount = BigInt(Math.floor(Math.random() * (MAX_USDC_AMOUNT - MIN_USDC_AMOUNT * scale + 1) + MIN_USDC_AMOUNT * scale));
      const relayer = relayers[Math.floor(Math.random() * relayers.length)];
      Math.random() < 0.6 ? await doRelayerLift(user, amount, relayer) : await doRelayerLower(user, amount, relayer);
    }

    await completeRound(round);
  }

  async function completeRound(round) {
    const feedPrice = await bridge.usdcEth();
    const swapAmount = totalFees * feedPrice;
    await swapHelper.swapToUSDC(swapAmount);
    totalFees = 0n;

    const balances = await Promise.all(relayers.map(async relayer => await ethers.provider.getBalance(relayer.address)));
    const deltas = balances.map(balance => Number(ethers.formatEther(balance - RELAYER_BASE_BALANCE)).toFixed(6));
    const delta = deltas.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
    emaDelta = emaDelta === undefined ? delta : DELTA_SMOOTHING * delta + (1 - DELTA_SMOOTHING) * emaDelta;

    if (!LOG_GAS) {
      console.log(`ROUND: ${round}  TX: ${txCt}  DELTA: ${emaDelta.toFixed(4)}`);
      console.log(`\nBalances:     ${balances.map(balance => Number(ethers.formatEther(balance)).toFixed(4)).join(' ')}`);
      console.log(`1 USDC Chainlink:   ${Number(ethers.formatEther(feedPrice * 1000000n)).toFixed(8)} ETH`);
      const currentPrice = network === 'sepolia' ? 0n : await swapHelper.currentPrice();
      console.log(`1 USDC Uniswap:     ${Number(ethers.formatEther(currentPrice * 1000000n)).toFixed(8)} ETH`);
      console.log(
        `WETH:USDC Swapper:  ${Number(ethers.formatEther(await weth.balanceOf(swapHelper.address))).toFixed(4)} ${(Number(await usdc.balanceOf(swapHelper.address)) / 1e6).toFixed(2)}\n\n`
      );
    }
  }

  async function doRelayerLift(user, amount, relayer) {
    await sendUSDC(user, amount);
    amount = Math.random() < 0.1 ? await usdc.balanceOf(user.address) : amount;
    const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
    const { gas, methodGas, gasLimit, doRefund, txCostEstimate } = await calcLiftGas(usdc, bridge, amount, user, permit, relayer);
    const tx = await bridge.connect(relayer).relayerLift(gas, amount, user.address, permit.v, permit.r, permit.s, doRefund, { gasLimit });
    const { gasUsed, txCost } = await processTx(tx, amount);
    if (LOG_GAS) logGas('Lift', gas, methodGas, gasUsed, txCostEstimate, txCost);
  }

  async function doRelayerLower(user, amount, relayer) {
    [lowerProof] = await createLowerProof(bridge, usdc, amount, user);
    const { gas, methodGas, gasLimit, doRefund, txCostEstimate } = await calcLowerGas(bridge, lowerProof, relayer);
    const tx = await bridge.connect(relayer).relayerLower(gas, lowerProof, doRefund, { gasLimit });
    const { gasUsed, txCost } = await processTx(tx, amount);
    if (LOG_GAS) logGas('Lower', gas, methodGas, gasUsed, txCostEstimate, txCost);
  }

  function logGas(op, gas, methodGas, gasUsed, txCostEstimate, txCost) {
    gas = parseInt(gas);
    const mGas = parseInt(methodGas);
    const uGas = parseInt(gasUsed);
    const usdcCost = `$${(Number(txCost) / 1e6).toFixed(2)}`;
    const okay = 1 === Math.round((mGas / uGas) * 10000) / 10000;
    console.log(
      `${op}, ${gas}, ${mGas}, ${uGas}, ${gas - uGas}, ${mGas - uGas}, ${okay}, ${txCostEstimate}, ${txCost}, ${txCostEstimate - txCost}, ${usdcCost}`
    );
  }

  async function processTx(tx, amount) {
    txCt++;
    let txCost;
    const receipt = await tx.wait();
    for (const log of receipt.logs.filter(log => log.address === bridge.address)) {
      const event = bridge.interface.parseLog(log);
      if (event.name === 'LogRefundFailed') console.warn(`⚠️ REFUND FAILURE: ${receipt.hash}`);
      else {
        txCost = amount - event.args.amount;
        totalFees += txCost;
      }
    }
    return { gasUsed: receipt.gasUsed, txCost };
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
