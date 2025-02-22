const { deployTruthBridge, deployTruthToken, expect, getAccounts, getPermit, getUSDC, init, ONE_HUNDRED_BILLION, ONE_USDC, sendUSDC } = require('./helper.js');

let bridge, truth, usdc, owner, relayer, user, t2PubKey;

describe('User Functions', async () => {
  before(async () => {
    const numAuthors = 6;
    await init(numAuthors);
    [owner, relayer, user] = getAccounts();
    truth = await deployTruthToken(ONE_HUNDRED_BILLION, owner);
    bridge = await deployTruthBridge(truth, owner);
    usdc = await getUSDC();
    t2PubKey = await bridge.deriveT2PublicKey(user.address);
  });

  context('Lifting USDC via relayer', async () => {
    context('succeeds', async () => {
      before(async () => {
        await bridge.registerRelayer(relayer.address);
      });

      async function doOnRamp() {
        const amount = 10n * ONE_USDC;
        await sendUSDC(user, amount);
        const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
        const { gasPrice } = await ethers.provider.getFeeData();
        const expectedFee = (gasPrice * (await bridge.onRampGas())) / (await bridge.usdcEth());
        await expect(bridge.connect(relayer).completeOnRamp(amount, user.address, permit.v, permit.r, permit.s))
          .to.emit(bridge, 'LogLiftedToPredictionMarket')
          .withArgs(usdc.address, t2PubKey, amount - expectedFee);
      }

      it('in lifting tokens to the prediction market with a valid permit', async () => {
        const initialBalance = await ethers.provider.getBalance(relayer.address);
        for (i = 0; i < 100; i++) {
          await doOnRamp();
        }

        await bridge.connect(relayer).recoverCosts();
        const gainOrLoss = (await ethers.provider.getBalance(relayer.address)) - initialBalance;
        console.log(gainOrLoss);
      });
    });
  });
});
