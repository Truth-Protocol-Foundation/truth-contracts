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

const ROUNDS = 100;
const LOG_TX_GAS = false;
const LOG_ROUNDS = false;

describe('Relayer Validation and Tuning', async () => {
  let bridge, truth, usdc, weth, swapHelper;
  let owner, r1, r2, r3, u1, u2, u3, u4, u5, u6, u7;
  let txCt = 0;
  let totalFees = 0n;
  let users = [];
  let relayers = [];
  let initialBalances = {};

  before(async () => {
    await init(6);
    [owner, r1, r2, r3, u1, u2, u3, u4, u5, u6, u7] = getAccounts();
    users = [u1, u2, u3, u4, u5, u6, u7];
    relayers = [r1, r2, r3];
    truth = await deployTruthToken(ONE_HUNDRED_BILLION, owner);
    bridge = await deployTruthBridge(truth, owner);
    usdc = await getUSDC();
    weth = await getWETH();
    swapHelper = await deploySwapHelper();

    for (const relayer of relayers) {
      await bridge.registerRelayer(relayer.address);
      initialBalances[relayer.address] = await ethers.provider.getBalance(relayer.address);
    }

    await sendUSDC(bridge, 1000000n * ONE_USDC);
    const amount = ethers.parseEther('10');
    await weth.deposit({ value: amount });
    await weth.transfer(swapHelper.address, amount);
  });

  async function completeRound(round) {
    const price = await bridge.usdcEth();
    const poolPrice = await swapHelper.currentPrice();
    const swapAmount = totalFees * price;

    const wethBefore = Number(ethers.formatEther(await weth.balanceOf(swapHelper.address))).toFixed(6);
    const usdcBefore = Number(await usdc.balanceOf(swapHelper.address)) / 1e6;

    await swapHelper.swap(swapAmount);
    totalFees = 0n;

    const wethAfter = Number(ethers.formatEther(await weth.balanceOf(swapHelper.address))).toFixed(6);
    const usdcAfter = Number(await usdc.balanceOf(swapHelper.address)) / 1e6;

    const balanceDiffs = await Promise.all(relayers.map(async relayer =>
      Number(ethers.formatEther((await ethers.provider.getBalance(relayer.address)) - initialBalances[relayer.address])).toFixed(6)
    ));

    if (LOG_ROUNDS) {
      console.log(`\nROUND ${round} - TX COUNT: ${txCt}`);
      console.log(`\nCombined diff : ${balanceDiffs.reduce((a, b) => parseFloat(a) + parseFloat(b), 0).toFixed(6)}`);
      console.log(`Diff by relayer:`, ...balanceDiffs);
      console.log(`Fees: ${totalFees}, Price: ${price}, Pool price: ${poolPrice}, Eth to swap: ${Number(ethers.formatEther(swapAmount)).toFixed(6)}`);
      console.log(`\n1 USDC Chainlink: ${Number(ethers.formatEther(price * 1000000n)).toFixed(7)}`);
      console.log(`1 USDC Uniswap  : ${Number(ethers.formatEther(poolPrice * 1000000n)).toFixed(7)}`);
      console.log(`\nWETH Before: ${wethBefore}, USDC Before: ${usdcBefore}`);
      console.log(`WETH After : ${wethAfter}, USDC After : ${usdcAfter}\n`);
    }
  }

  async function doRelayerLift(user, amount, relayer, gasPrice) {
    await sendUSDC(user, amount);
    const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
    const tx = await bridge.connect(relayer).relayerLift(amount, user.address, permit.v, permit.r, permit.s, { gasPrice });
    const gasCost = await processTx(tx, amount);
    if (LOG_TX_GAS) console.log('LIFT ,', gasCost);
  }

  async function doRelayerLower(user, amount, relayer, gasPrice) {
    [lowerProof] = await createLowerProof(bridge, usdc, amount, user);
    const tx = await bridge.connect(relayer).relayerLower(lowerProof, { gasPrice });
    const gasCost = await processTx(tx, amount);
    if (LOG_TX_GAS) console.log('LOWER,', gasCost);
  }

  async function processTx(tx, amount) {
    txCt++;
    const receipt = await tx.wait();
    for (const log of receipt.logs.filter(log => log.address === bridge.address)) {
      const event = bridge.interface.parseLog(log);
      if (event.name === 'LogRefundFailed') console.warn(`⚠️ REFUND FAILURE: ${receipt.hash}`);
      else totalFees += amount - event.args.amount;
    }
    return parseInt(receipt.gasUsed);
  }

  it('tuning test', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const gasPrice = (Math.floor(Math.random() * (10000000000 - 500000000 + 1)) + 500000000).toString();
      const txRate = Math.floor(Math.random() * (100 - 20 + 1)) + 20;

      for (let i = 0; i < txRate; i++) {
        const user = users[Math.floor(Math.random() * users.length)];
        const amount = BigInt(Math.floor(Math.random() * (100000000 - 4000000 + 1)) + 4000000);
        const relayer = relayers[Math.floor(Math.random() * relayers.length)];
        Math.random() < 0.4 ? await doRelayerLift(user, amount, relayer, gasPrice) : await doRelayerLower(user, amount, relayer, gasPrice);
      }

      await completeRound(round);
    }
  });
});
