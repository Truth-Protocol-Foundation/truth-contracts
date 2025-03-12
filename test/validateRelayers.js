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

let bridge, truth, usdc, weth, swapHelper;
let owner, r1, r2, r3, u1, u2, u3, u4, u5, u6, u7;
let users = [];
let relayers = [];

describe('Relayer Validation and Tuning', async () => {
  before(async () => {
    const numAuthors = 6;
    await init(numAuthors);
    [owner, r1, r2, r3, u1, u2, u3, u4, u5, u6, u7] = getAccounts();
    users = [u1, u2, u3, u4, u5, u6, u7];
    relayers = [r1, r2, r3];
    truth = await deployTruthToken(ONE_HUNDRED_BILLION, owner);
    bridge = await deployTruthBridge(truth, owner);
    usdc = await getUSDC();
    weth = await getWETH();
    swapHelper = await deploySwapHelper();
  });

  context('Repeat calls (for gas estimation)', async () => {
    let txCt = 0;
    let totalFees = 0n;

    before(async () => {
      await bridge.registerRelayer(r1.address);
      await bridge.registerRelayer(r2.address);
      await bridge.registerRelayer(r3.address);
      await sendUSDC(bridge, 1000000n * ONE_USDC);
      const amount = ethers.parseEther('10');
      await weth.deposit({ value: amount });
      await weth.transfer(swapHelper.address, amount);
    });

    async function swap() {
      const price = await bridge.usdcEth();
      const poolPrice = await swapHelper.currentPrice();
      const swapAmount = totalFees * price;

      const wethBefore = Number(ethers.formatEther(await weth.balanceOf(swapHelper.address))).toFixed(6);
      const usdcBefore = Number(await usdc.balanceOf(swapHelper.address)) / 1000000;

      await swapHelper.swap(swapAmount);

      const wethAfter = Number(ethers.formatEther(await weth.balanceOf(swapHelper.address))).toFixed(6);
      const usdcAfter = Number(await usdc.balanceOf(swapHelper.address)) / 1000000;

      console.log('\nFees:', totalFees, 'Price:', price, 'Pool price:', poolPrice, 'Eth to swap:', Number(ethers.formatEther(swapAmount)).toFixed(6));
      console.log('1 USDC Chainlink:', Number(ethers.formatEther(price * 1000000n)).toFixed(7));
      console.log('1 USDC Uniswap  :', Number(ethers.formatEther(poolPrice * 1000000n)).toFixed(7));
      console.log('WETH Before:', wethBefore, 'USDC Before:', usdcBefore);
      console.log('WETH After :', wethAfter, 'USDC After :', usdcAfter);
      totalFees = 0n;
    }

    async function doRelayerLift(user, amount, relayer, gas) {
      await sendUSDC(user, amount);
      const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
      const tx = await bridge.connect(relayer).relayerLift(amount, user.address, permit.v, permit.r, permit.s, { gasPrice: gas.toString() });
      txCt++;
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.address === bridge.address);
      const log = bridge.interface.parseLog(event);
      totalFees += amount - log.args.amount;
      // console.log('LIFT ,', parseInt(receipt.gasUsed));
    }

    async function doRelayerLower(user, amount, relayer, gas) {
      [lowerProof] = await createLowerProof(bridge, usdc, amount, user);
      const tx = await bridge.connect(relayer).relayerLower(lowerProof, { gasPrice: gas.toString() });
      txCt++;
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.address === bridge.address);
      const log = bridge.interface.parseLog(event);
      totalFees += amount - log.args.amount;
      // console.log('LOWER,', parseInt(receipt.gasUsed));
    }

    xit('tuning test', async () => {
      const r1Balance = await ethers.provider.getBalance(r1.address);
      const r2Balance = await ethers.provider.getBalance(r2.address);
      const r3Balance = await ethers.provider.getBalance(r3.address);

      for (round = 0; round < 100; round++) {
        const r1Bal = await diff(r1, r1Balance);
        const r2Bal = await diff(r2, r2Balance);
        const r3Bal = await diff(r3, r3Balance);
        const gas = Math.floor(Math.random() * (10000000000 - 500000000 + 1)) + 500000000;
        const txRate = Math.floor(Math.random() * (100 - 20 + 1)) + 20;

        for (i = 0; i < txRate; i++) {
          const user = users[Math.floor(Math.random() * users.length)];
          const amount = BigInt(Math.floor(Math.random() * (100000000 - 4000000 + 1)) + 4000000);
          const relayer = relayers[Math.floor(Math.random() * relayers.length)];
          const action = Math.floor(Math.random() * 7);
          if (action < 4) await doRelayerLift(user, amount, relayer, gas);
          else await doRelayerLower(user, amount, relayer, gas);
        }

        await swap();

        console.log('\nRound:', round, 'Tx count:', txCt);
        console.log('Combined diff:', (parseFloat(r1Bal) + parseFloat(r2Bal) + parseFloat(r3Bal)).toFixed(6));
        console.log('By relayer:', r1Bal, r2Bal, r3Bal);
      }
    });

    async function diff(relayer, startBalance) {
      return Number(ethers.formatEther((await ethers.provider.getBalance(relayer.address)) - startBalance)).toFixed(6);
    }
  });
});
