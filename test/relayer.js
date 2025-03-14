const {
  createLowerProof,
  deploySwapHelper,
  deployTruthBridge,
  deployTruthToken,
  expect,
  getAccounts,
  getPermit,
  getUSDC,
  init,
  ONE_HUNDRED_BILLION,
  ONE_USDC,
  randomBytes32,
  sendUSDC
} = require('./helper.js');

let bridge, truth, usdc, swapHelper, owner, otherAccount, relayer1, relayer2, user, userT2PubKey;

describe('Relayer Functions', async () => {
  before(async () => {
    const numAuthors = 6;
    await init(numAuthors);
    [owner, otherAccount, relayer1, relayer2, user] = getAccounts();
    truth = await deployTruthToken(ONE_HUNDRED_BILLION, owner);
    bridge = await deployTruthBridge(truth, owner);
    usdc = await getUSDC();
    swapHelper = await deploySwapHelper();
    userT2PubKey = await bridge.deriveT2PublicKey(user.address);
  });

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
        await expect(bridge.connect(relayer1).relayerLift(amount, user.address, permit.v, permit.r, permit.s)).to.emit(bridge, 'LogLiftedToPredictionMarket');
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
        let amount = 1n;
        let permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
        await expect(bridge.connect(relayer1).relayerLift(amount, user.address, permit.v, permit.r, permit.s)).to.be.revertedWithCustomError(
          bridge,
          'AmountTooLow'
        );
      });
    });
  });

  context('Relayer lowering', async () => {
    before(async () => {
      const liftAmount = 100n * ONE_USDC;
      await sendUSDC(user, liftAmount);
      const permit = await getPermit(usdc, user, bridge, liftAmount);
      await bridge.connect(user).permitLift(usdc.address, userT2PubKey, liftAmount, permit.deadline, permit.v, permit.r, permit.s);
    });

    context('succeeds', async () => {
      it('in lowering tokens to the recipient in the proof', async () => {
        const lowerAmount = 10n * ONE_USDC;
        const [lowerProof] = await createLowerProof(bridge, usdc, lowerAmount, user);
        await expect(bridge.connect(relayer1).relayerLower(lowerProof)).to.emit(bridge, 'LogRelayerLowered');
      });
    });

    context('fails when', async () => {
      it('if the caller is not a relayer', async () => {
        [lowerProof] = await createLowerProof(bridge, usdc, 10n * ONE_USDC, user);
        await expect(bridge.relayerLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'RelayerOnly');
      });

      it('the proof is used', async () => {
        [lowerProof] = await createLowerProof(bridge, usdc, 10n * ONE_USDC, user);
        await bridge.connect(relayer1).relayerLower(lowerProof);
        await expect(bridge.connect(relayer1).relayerLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsUsed');
      });

      it('the proof is invalid', async () => {
        await expect(bridge.connect(relayer1).relayerLower(randomBytes32())).to.be.revertedWithCustomError(bridge, 'InvalidProof');
      });

      it('if the amount will not cover the tx cost', async () => {
        [lowerProof] = await createLowerProof(bridge, usdc, 1n, user);
        await expect(bridge.connect(relayer1).relayerLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'AmountTooLow');
      });

      it('if the token is not USDC', async () => {
        [lowerProof] = await createLowerProof(bridge, truth, 100000000n, user);
        await expect(bridge.connect(relayer1).relayerLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'InvalidToken');
      });
    });
  });

  context('Coverage tests', async () => {
    it('uniswapV3SwapCallback fails if not called by the pool', async () => {
      await expect(bridge.connect(owner).uniswapV3SwapCallback(1, 1, '0x')).to.be.revertedWithCustomError(bridge, 'InvalidCaller');
    });

    it('__refundRelayer fails via an external caller', async () => {
      await expect(bridge.connect(owner).__refundRelayer(owner.address, 1)).to.be.revertedWithCustomError(bridge, 'InvalidCaller');
    });

    it('relayers can get refunded via a relayerLift', async () => {
      let amount = 10n * ONE_USDC;
      let ethBalance = 1n;
      let newEthBalance = 0n;

      while (newEthBalance < ethBalance) {
        ethBalance = await ethers.provider.getBalance(relayer1.address);
        await sendUSDC(user, amount);
        const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
        await bridge.connect(relayer1).relayerLift(amount, user.address, permit.v, permit.r, permit.s);
        newEthBalance = await ethers.provider.getBalance(relayer1.address);
      }
    });

    it('relayers can get refunded via a relayerLower', async () => {
      let amount = 10n * ONE_USDC;
      let ethBalance = 1n;
      let newEthBalance = 0n;

      while (newEthBalance < ethBalance) {
        ethBalance = await ethers.provider.getBalance(relayer1.address);
        await sendUSDC(bridge, amount);
        [lowerProof] = await createLowerProof(bridge, usdc, amount, user);
        await bridge.connect(relayer1).relayerLower(lowerProof);
        newEthBalance = await ethers.provider.getBalance(relayer1.address);
      }
    });

    it('trigger slippage revert', async () => {
      let amount = 5000000n * ONE_USDC;
      await sendUSDC(swapHelper, amount);
      await swapHelper.swapToWETH(amount);
      amount = 1n * ONE_USDC;
      let slipped = false;

      while (!slipped) {
        await sendUSDC(bridge, amount);
        [lowerProof] = await createLowerProof(bridge, usdc, amount, user);
        const tx = await bridge.connect(relayer1).relayerLower(lowerProof);
        const receipt = await tx.wait();
        for (const log of receipt.logs.filter(log => log.address === bridge.address)) {
          const event = bridge.interface.parseLog(log);
          if (event.name === 'LogRefundFailed') slipped = true;
        }
      }
    });

    it('users with zero USDC balance incur marginally higher lowering fees', async () => {
      const userBalance = await usdc.balanceOf(user.address);
      await usdc.connect(user).transfer(bridge.address, userBalance);
      [lowerProof] = await createLowerProof(bridge, usdc, userBalance, user);
      await bridge.connect(relayer1).relayerLower(lowerProof);
    });
  });
});
