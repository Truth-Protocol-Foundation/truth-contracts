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
const LOG_ROUNDS = true;

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

    await swapHelper.swap(swapAmount);
    totalFees = 0n;

    const balanceDiffs = await Promise.all(
      relayers.map(async relayer =>
        Number(ethers.formatEther((await ethers.provider.getBalance(relayer.address)) - initialBalances[relayer.address])).toFixed(6)
      )
    );

    if (LOG_ROUNDS) {
      console.log(`\nROUND ${round} - TX COUNT: ${txCt}`);
      console.log(`\nDelta: ${balanceDiffs.reduce((a, b) => parseFloat(a) + parseFloat(b), 0).toFixed(6)}  (${balanceDiffs.join(', ')})`);
      console.log(`1 USDC Chainlink: ${Number(ethers.formatEther(price * 1000000n)).toFixed(7)} ETH`);
      console.log(`1 USDC Uniswap  : ${Number(ethers.formatEther(poolPrice * 1000000n)).toFixed(7)} ETH`);
      console.log(`Swapper WETH Balance: ${Number(ethers.formatEther(await weth.balanceOf(swapHelper.address))).toFixed(6)}`);
      console.log(`Swapper USDC Balance: ${Number(await usdc.balanceOf(swapHelper.address)) / 1e6}\n`);
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
