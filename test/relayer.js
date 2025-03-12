const { deployTruthBridge, deployTruthToken, expect, getAccounts, getPermit, getUSDC, init, ONE_HUNDRED_BILLION, ONE_USDC, sendUSDC } = require('./helper.js');

let bridge, truth, usdc, owner, otherAccount, relayer1, relayer2, user, userT2PubKey;

describe('Relayer Functions', async () => {
  before(async () => {
    const numAuthors = 6;
    await init(numAuthors);
    [owner, otherAccount, relayer1, relayer2, user] = getAccounts();
    truth = await deployTruthToken(ONE_HUNDRED_BILLION, owner);
    bridge = await deployTruthBridge(truth, owner);
    usdc = await getUSDC();
    userT2PubKey = await bridge.deriveT2PublicKey(user.address);
    const relayerLiftGas = 105000n;
    await bridge.setRelayerGas(relayerLiftGas);
  });

  async function getTxCost() {
    const { gasPrice } = await ethers.provider.getFeeData();
    const txGas = await bridge.relayerLiftGas();
    const ethPrice = await bridge.usdcEth();
    return (gasPrice * txGas) / ethPrice;
  }

  context('Registering relayers', async () => {
    context('succeeds', async () => {
      it('when the caller is the owner', async () => {
        expect(await bridge.relayerBalance(relayer1.address)).to.equal(0);
        await expect(bridge.registerRelayer(relayer1.address)).to.emit(bridge, 'LogRelayerRegistered').withArgs(relayer1.address);
        expect(await bridge.relayerBalance(relayer1.address)).to.equal(1);
      });
    });

    context('fails', async () => {
      it('when the relayer is already registered', async () => {
        await expect(bridge.registerRelayer(relayer1.address)).to.be.reverted;
      });

      it('when the caller is not the owner', async () => {
        await expect(bridge.connect(otherAccount).registerRelayer(relayer2.address)).to.be.revertedWithCustomError(bridge, 'OwnableUnauthorizedAccount');
      });
    });
  });

  context('Deregistering relayers', async () => {
    context('succeeds', async () => {
      it('when the caller is the owner', async () => {
        expect(await bridge.relayerBalance(relayer1.address)).to.equal(1);
        await expect(bridge.deregisterRelayer(relayer1.address)).to.emit(bridge, 'LogRelayerDeregistered').withArgs(relayer1.address);
        expect(await bridge.relayerBalance(relayer1.address)).to.equal(0);
      });

      it('when the relayer is owed USDC it is returned to them before deregistration', async () => {
        await bridge.registerRelayer(relayer2.address);
        const amount = 10n * ONE_USDC;
        await sendUSDC(user, amount);
        const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
        await bridge.connect(relayer2).relayerLift(amount, user.address, permit.v, permit.r, permit.s);

        expect(await usdc.balanceOf(relayer2.address)).to.equal(0);
        expect(await bridge.relayerBalance(relayer2.address)).to.be.greaterThan(1);
        const relayerBalance = await bridge.relayerBalance(relayer2.address);
        await bridge.deregisterRelayer(relayer2.address);
        expect(await usdc.balanceOf(relayer2.address)).to.equal(relayerBalance - 1n);
      });
    });

    context('fails', async () => {
      it('when the relayer is already deregistered', async () => {
        await expect(bridge.deregisterRelayer(relayer1.address)).to.be.reverted;
      });

      it('when the caller is not the owner', async () => {
        await expect(bridge.connect(otherAccount).deregisterRelayer(relayer1.address)).to.be.revertedWithCustomError(bridge, 'OwnableUnauthorizedAccount');
      });
    });
  });

  context('Setting relayerLiftGas', async () => {
    context('succeeds', async () => {
      it('when the caller is the owner', async () => {
        const relayerLiftGas = await bridge.relayerLiftGas();
        await bridge.setRelayerGas(relayerLiftGas + 1n);
        expect(await bridge.relayerLiftGas()).to.equal(relayerLiftGas + 1n);
      });
    });

    context('fails', async () => {
      it('when the caller is not the owner', async () => {
        await expect(bridge.connect(otherAccount).setRelayerGas(1n)).to.be.revertedWithCustomError(bridge, 'OwnableUnauthorizedAccount');
      });
    });
  });

  context('Relayer lifting', async () => {
    context('succeeds', async () => {
      before(async () => {
        await bridge.registerRelayer(relayer1.address);
        await sendUSDC(user, 100n * ONE_USDC);
      });

      it('when called by a relayer with a valid user permit', async () => {
        const amount = 10n * ONE_USDC;
        const initialBalance = await usdc.balanceOf(bridge.address);
        const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
        const expectedFee = await getTxCost();
        expect(await bridge.connect(relayer1).relayerLift(amount, user.address, permit.v, permit.r, permit.s))
          .to.emit(bridge, 'LogLiftedToPredictionMarket')
          .withArgs(usdc.address, userT2PubKey, amount - expectedFee);
        expect(await usdc.balanceOf(bridge.address)).to.equal(initialBalance + amount);
      });
    });

    context('fails', async () => {
      it('if the caller is not a relayer', async () => {
        const amount = 1n * ONE_USDC;
        const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
        await expect(bridge.connect(otherAccount).relayerLift(amount, user.address, permit.v, permit.r, permit.s)).to.be.revertedWithCustomError(
          bridge,
          'RelayerOnly'
        );
      });

      it('if the permit is invalid', async () => {
        const amount = 1n * ONE_USDC;
        const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
        await expect(bridge.connect(relayer1).relayerLift(amount, otherAccount.address, permit.v, permit.r, permit.s)).to.be.reverted;
      });

      it('if the amount will not cover the tx cost', async () => {
        let txCost = await getTxCost();
        let amount = txCost - 1n;
        let permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
        await expect(bridge.connect(relayer1).relayerLift(amount, user.address, permit.v, permit.r, permit.s)).to.be.revertedWithCustomError(
          bridge,
          'AmountTooLow'
        );
        txCost = await getTxCost();
        amount = txCost + 1n;
        permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
        await bridge.connect(relayer1).relayerLift(amount, user.address, permit.v, permit.r, permit.s);
      });
    });
  });

  context('Recovering ETH costs', async () => {
    context('succeeds', async () => {
      it('when called by a relayer with an unclaimed balance', async () => {
        await bridge.connect(relayer1).relayerRefund();
      });
    });

    context('fails', async () => {
      it('if the caller is not a relayer', async () => {
        await expect(bridge.connect(otherAccount).relayerRefund()).to.be.revertedWithCustomError(bridge, 'NoRefundDue');
      });

      it('when the Uniswap callback is invoked by any account other than the permitted pool', async () => {
        await expect(bridge.uniswapV3SwapCallback(1, 1, '0x')).to.be.revertedWithCustomError(bridge, 'InvalidCaller');
      });
    });
  });

  context('Repeat calls (for gas estimation)', async () => {
    async function doRelayerLift() {
      const amount = 10n * ONE_USDC;
      await sendUSDC(user, amount);
      const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
      await bridge.connect(relayer1).relayerLift(amount, user.address, permit.v, permit.r, permit.s);
    }

    it('relayer lift', async () => {
      const initialBalance = await ethers.provider.getBalance(relayer1.address);
      for (i = 0; i < 100; i++) await doRelayerLift();
      await bridge.connect(relayer1).relayerRefund();
      const gainOrLoss = (await ethers.provider.getBalance(relayer1.address)) - initialBalance;
      console.log(gainOrLoss);
    });
  });
});
