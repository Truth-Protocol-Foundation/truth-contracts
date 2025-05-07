const { costLift, costLower } = require('../utils/costCalculator.js');
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
  'Method, Trigger Refund, Method Gas, Aux Gas, Actual Gas, Gas Limit, Gas Diff, Estimated Cost, Actual Cost, Cost Diff, Accurate Gas, Accurate Cost, USDC Cost';
const LOG_GAS = false;

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
    const { gasEstimate, gasCost, gasLimit, refundGas, triggerRefund, txCostEstimate } = await costLift(bridge, relayer, amount, permit, user);
    const tx = await bridge.connect(relayer).relayerLift(gasCost, amount, user.address, permit.v, permit.r, permit.s, triggerRefund, { gasLimit });
    const { actualGas, actualCost } = await processTx(tx, amount);
    if (LOG_GAS) logGas('Lift', actualCost, actualGas, txCostEstimate, gasCost, gasEstimate, gasLimit, refundGas, triggerRefund);
  }

  async function doRelayerLower(user, amount, relayer) {
    [lowerProof] = await createLowerProof(bridge, usdc, amount, user);
    const { gasEstimate, gasCost, gasLimit, refundGas, triggerRefund, txCostEstimate } = await costLower(bridge, relayer, lowerProof);
    const tx = await bridge.connect(relayer).relayerLower(gasCost, lowerProof, triggerRefund, { gasLimit });
    const { actualGas, actualCost } = await processTx(tx, amount);
    if (LOG_GAS) logGas('Lower', actualCost, actualGas, txCostEstimate, gasCost, gasEstimate, gasLimit, refundGas, triggerRefund);
  }

  function logGas(method, actualCost, actualGas, txCostEstimate, gasCost, gasEstimate, gasLimit, refundGas, triggerRefund) {
    actualCost = parseInt(actualCost);
    actualGas = parseInt(actualGas);

    const auxGas = gasCost - gasEstimate;
    const gasDiff = triggerRefund === true ? gasEstimate + refundGas - actualGas : gasEstimate - actualGas;
    const gasOkay = Math.abs(gasDiff) < 100;
    const costDiff = txCostEstimate - actualCost;
    const costOkay = Math.abs(costDiff) < 50;
    const usdcCost = `$${(Number(actualCost) / 1e6).toFixed(2)}`;

    console.log(
      `${method}, ${triggerRefund}, ${gasEstimate}, ${auxGas}, ${actualGas}, ${gasLimit}, ${gasDiff}, ${txCostEstimate}, ${actualCost}, ${costDiff}, ${gasOkay}, ${costOkay}, ${usdcCost}`
    );
  }

  async function processTx(tx, amount) {
    txCt++;
    let actualCost;
    const receipt = await tx.wait();
    for (const log of receipt.logs.filter(log => log.address === bridge.address)) {
      const event = bridge.interface.parseLog(log);
      if (event.name === 'LogRefundFailed') console.warn(`⚠️ REFUND FAILURE: ${receipt.hash}`);
      else {
        actualCost = amount - event.args.amount;
        totalFees += actualCost;
      }
    }
    return { actualGas: receipt.gasUsed, actualCost };
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });