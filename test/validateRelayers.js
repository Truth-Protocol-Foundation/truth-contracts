const {
  createLowerProof,
  deploySwapHelper,
  deployTruthBridge,
  deployTruthToken,
  getAccounts,
  getPermit,
  getUSDC,
  getWETH,
  init,
  ONE_HUNDRED_BILLION,
  ONE_USDC,
  sendUSDC
} = require('./helper.js');

const ROUNDS = 0;
const NUM_RELAYERS = 3;
const DELTA_SMOOTHING = 0.2; // (0.1 = slow, 0.5 = fast)

const MIN_GAS_PRICE = Number(ethers.parseUnits('1', 'gwei'));
const MAX_GAS_PRICE = MIN_GAS_PRICE * 10;
const MIN_USDC_AMOUNT = Number(5n * ONE_USDC);
const MAX_USDC_AMOUNT = Number(100n * ONE_USDC);

const LOG_DETAILS = true;
const LOG_TX_GAS = false;

const RELAYER_BASE_BALANCE = ethers.parseEther('0.33');

describe('Relayer Validation and Tuning', async () => {
  let bridge, truth, usdc, weth, swapHelper;
  let owner, u1, u2, u3, u4, u5, u6, u7;
  let txCt = 0;
  let totalFees = 0n;
  let users = [];
  let relayers = [];
  let scale = 1;
  let emaDelta;

  before(async () => {
    const network = await init(6);
    if (network === 'sepolia') scale = 10; // USDC:ETH costs are higher on Sepolia so scale values
    [owner, u1, u2, u3, u4, u5, u6, u7] = getAccounts();
    users = [u1, u2, u3, u4, u5, u6, u7];
    truth = await deployTruthToken(ONE_HUNDRED_BILLION, owner);
    bridge = await deployTruthBridge(truth, owner);
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
    await weth.deposit({ value: amount });
    await weth.transfer(swapHelper.address, amount);
  });

  async function completeRound(round) {
    const feedPrice = await bridge.usdcEth();
    const swapAmount = totalFees * feedPrice;

    await swapHelper.swapToUSDC(swapAmount);
    totalFees = 0n;

    const balances = await Promise.all(relayers.map(async relayer => await ethers.provider.getBalance(relayer.address)));
    const deltas = balances.map(balance => Number(ethers.formatEther(balance - RELAYER_BASE_BALANCE)).toFixed(6));
    const delta = deltas.reduce((a, b) => parseFloat(a) + parseFloat(b), 0);
    emaDelta = emaDelta === undefined ? delta : DELTA_SMOOTHING * delta + (1 - DELTA_SMOOTHING) * emaDelta;

    if (LOG_DETAILS) {
      console.log(`ROUND: ${round}  TX: ${txCt}  DELTA: ${emaDelta.toFixed(4)}`);
      console.log(`\nBalances:     ${balances.map(balance => Number(ethers.formatEther(balance)).toFixed(4)).join(' ')}`);
      console.log(`1 USDC Chainlink:   ${Number(ethers.formatEther(feedPrice * 1000000n)).toFixed(8)} ETH`);
      console.log(`1 USDC Uniswap:     ${Number(ethers.formatEther((await swapHelper.currentPrice()) * 1000000n)).toFixed(8)} ETH`);
      console.log(
        `WETH:USDC Swapper:  ${Number(ethers.formatEther(await weth.balanceOf(swapHelper.address))).toFixed(4)} ${(Number(await usdc.balanceOf(swapHelper.address)) / 1e6).toFixed(2)}\n\n`
      );
    }
  }

  async function doRelayerLift(user, amount, relayer, gasPrice) {
    await sendUSDC(user, amount);
    const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
    const tx = await bridge.connect(relayer).relayerLift(amount, user.address, permit.v, permit.r, permit.s, { gasPrice });
    const { gasCost, usdcFee } = await processTx(tx, amount);
    if (LOG_TX_GAS) console.log(`LIFT , ${gasCost}, ${usdcFee}`);
  }

  async function doRelayerLower(user, amount, relayer, gasPrice) {
    [lowerProof] = await createLowerProof(bridge, usdc, amount, user);
    const tx = await bridge.connect(relayer).relayerLower(lowerProof, { gasPrice });
    const { gasCost, usdcFee } = await processTx(tx, amount);
    if (LOG_TX_GAS) console.log(`LOWER, ${gasCost}, ${usdcFee}`);
  }

  async function processTx(tx, amount) {
    txCt++;
    let fee;
    const receipt = await tx.wait();
    for (const log of receipt.logs.filter(log => log.address === bridge.address)) {
      const event = bridge.interface.parseLog(log);
      if (event.name === 'LogRefundFailed') console.warn(`⚠️ REFUND FAILURE: ${receipt.hash}`);
      else {
        fee = amount - event.args.amount;
        totalFees += fee;
      }
    }
    return { gasCost: parseInt(receipt.gasUsed), usdcFee: `$${(Number(fee) / 1e6).toFixed(2)}` };
  }

  it('tuning test', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const gasPrice = Math.floor(Math.random() * (MAX_GAS_PRICE - MIN_GAS_PRICE + 1) + MIN_GAS_PRICE).toString();
      const txRate = Math.floor(Math.random() * (100 - 20 + 1)) + 20;

      for (let i = 0; i < txRate; i++) {
        const user = users[Math.floor(Math.random() * users.length)];
        const amount = BigInt(Math.floor(Math.random() * (MAX_USDC_AMOUNT - MIN_USDC_AMOUNT * scale + 1) + MIN_USDC_AMOUNT * scale));
        const relayer = relayers[Math.floor(Math.random() * relayers.length)];
        Math.random() < 0.4 ? await doRelayerLift(user, amount, relayer, gasPrice) : await doRelayerLower(user, amount, relayer, gasPrice);
      }

      await completeRound(round);
    }
  });
});
