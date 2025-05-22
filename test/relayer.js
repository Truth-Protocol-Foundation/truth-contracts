const { costLift, costLower } = require('../utils/costCalculator.js');
const {
  createLowerProof,
  deploySwapHelper,
  deployBridge,
  deployToken,
  expect,
  getAccounts,
  getLiftAuthorization,
  getPermit,
  getUSDC,
  getValidExpiry,
  init,
  ONE_USDC,
  randomBytes32,
  SANCTIONED_ADDRESS,
  sendUSDC,
  setupRelayerToken
} = require('../utils/helper.js');

let network, bridge, truth, usdc, swapHelper, owner, otherAccount, relayer1, relayer2, user, userT2PubKey;

describe('Relayer Functions', async () => {
  before(async () => {
    const numAuthors = 5;
    network = await init(numAuthors);
    [owner, otherAccount, relayer1, relayer2, user] = getAccounts();
    truth = await deployToken(owner);
    bridge = await deployBridge(truth, owner);
    usdc = await getUSDC();
    if (network === 'sepolia') await setupRelayerToken(owner, bridge, usdc, ethers.parseEther('1'));
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
        const { gasCost } = await costLift(bridge, relayer2, amount, permit, user);
        await bridge.connect(relayer2).relayerLift(gasCost, amount, user.address, permit.v, permit.r, permit.s, false);

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
        const initialBridgeUSDCBalance = await usdc.balanceOf(bridge.address);
        const initialRelayerETHBalance = await ethers.provider.getBalance(relayer1.address);
        const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
        const { gasCost } = await costLift(bridge, relayer1, amount, permit, user);
        await expect(bridge.connect(relayer1).relayerLift(gasCost, amount, user.address, permit.v, permit.r, permit.s, false)).to.emit(
          bridge,
          'LogLiftedToPredictionMarket'
        );
        const newBridgeUSDCBalance = await usdc.balanceOf(bridge.address);
        const newRelayerETHBalance = await ethers.provider.getBalance(relayer1.address);
        if (newRelayerETHBalance < initialRelayerETHBalance) expect(newBridgeUSDCBalance).to.equal(initialBridgeUSDCBalance + amount);
        else console.log('refund occurred');
      });
    });

    context('fails', async () => {
      it('if the caller is not a relayer', async () => {
        const amount = 1n * ONE_USDC;
        const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
        const { gasCost } = await costLift(bridge, relayer1, amount, permit, user);
        await expect(
          bridge.connect(otherAccount).relayerLift(gasCost, amount, user.address, permit.v, permit.r, permit.s, false)
        ).to.be.revertedWithCustomError(bridge, 'RelayerOnly');
      });

      it('if the permit is invalid', async () => {
        const amount = 1n * ONE_USDC;
        const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
        await expect(bridge.connect(relayer1).relayerLift(1n, amount, otherAccount.address, permit.v, permit.r, permit.s, false)).to.be.reverted;
      });

      it('if the amount will not cover the tx cost', async () => {
        const amount = 1n;
        const gasCost = 2n;
        let permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
        await expect(bridge.connect(relayer1).relayerLift(gasCost, amount, user.address, permit.v, permit.r, permit.s, false)).to.be.revertedWithCustomError(
          bridge,
          'AmountTooLow'
        );
      });

      it('if the user is sanctioned', async () => {
        const amount = 1n * ONE_USDC;
        await expect(
          bridge.connect(relayer1).relayerLift(1n, amount, SANCTIONED_ADDRESS, 1n, randomBytes32(), randomBytes32(), false)
        ).to.be.revertedWithCustomError(bridge, 'AddressBlocked');
      });
    });
  });

  context('Relayer lowering', async () => {
    before(async () => {
      const liftAmount = 100n * ONE_USDC;
      await sendUSDC(user, liftAmount);
      const permit = await getPermit(usdc, user, bridge, liftAmount);
      const expiry = await getValidExpiry();
      const authorization = getLiftAuthorization(relayer1, bridge, { token: usdc.address, t2PubKey: userT2PubKey, amount: liftAmount, expiry });
      await bridge.connect(user).permitLift(usdc.address, userT2PubKey, liftAmount, permit.deadline, permit.v, permit.r, permit.s, expiry, authorization);
    });

    context('succeeds', async () => {
      it('in lowering tokens to the recipient in the proof', async () => {
        const lowerAmount = 10n * ONE_USDC;
        const [lowerProof] = await createLowerProof(bridge, usdc, lowerAmount, user);
        const { gasCost } = await costLower(bridge, relayer1, lowerProof);
        await expect(bridge.connect(relayer1).relayerLower(gasCost, lowerProof, false)).to.emit(bridge, 'LogRelayerLowered');
      });
    });

    context('fails when', async () => {
      it('if the caller is not a relayer', async () => {
        [lowerProof] = await createLowerProof(bridge, usdc, 10n * ONE_USDC, user);
        const { gasCost } = await costLower(bridge, relayer1, lowerProof);
        await expect(bridge.relayerLower(gasCost, lowerProof, false)).to.be.revertedWithCustomError(bridge, 'RelayerOnly');
      });

      it('the proof is used', async () => {
        [lowerProof] = await createLowerProof(bridge, usdc, 10n * ONE_USDC, user);
        await bridge.connect(relayer1).relayerLower(1n, lowerProof, false);
        await expect(bridge.connect(relayer1).relayerLower(1n, lowerProof, false)).to.be.revertedWithCustomError(bridge, 'LowerIsUsed');
      });

      it('the proof is invalid', async () => {
        const lowerProof = '0x12345678';
        await expect(bridge.connect(relayer1).relayerLower(1n, lowerProof, false)).to.be.revertedWithCustomError(bridge, 'InvalidProof');
      });

      it('if the amount will not cover the tx cost', async () => {
        const amount = 1n;
        const gasCost = 2n;
        [lowerProof] = await createLowerProof(bridge, usdc, amount, user);
        await expect(bridge.connect(relayer1).relayerLower(gasCost, lowerProof, false)).to.be.revertedWithCustomError(bridge, 'AmountTooLow');
      });

      it('if the token is not USDC', async () => {
        [lowerProof] = await createLowerProof(bridge, truth, 100000000n, user);
        await expect(bridge.connect(relayer1).relayerLower(1n, lowerProof, false)).to.be.revertedWithCustomError(bridge, 'InvalidToken');
      });
    });
  });

  context('Refund mechanism', async () => {
    it('uniswapV3SwapCallback fails if not called by the pool', async () => {
      await expect(bridge.connect(owner).uniswapV3SwapCallback(1, 1, '0x')).to.be.revertedWithCustomError(bridge, 'InvalidCaller');
    });

    it('__refundRelayer fails via an external caller', async () => {
      await expect(bridge.connect(owner).__refundRelayer(owner.address, 1)).to.be.revertedWithCustomError(bridge, 'InvalidCaller');
    });

    it('relayers can get refunded via a relayerLift', async () => {
      let amount = 10n * ONE_USDC;
      const ethBalance = await ethers.provider.getBalance(relayer1.address);
      await sendUSDC(user, amount);
      const permit = await getPermit(usdc, user, bridge, amount, ethers.MaxUint256);
      const { gasCost } = await costLift(bridge, relayer1, amount, permit, user);
      await bridge.connect(relayer1).relayerLift(gasCost, amount, user.address, permit.v, permit.r, permit.s, true);
      const newEthBalance = await ethers.provider.getBalance(relayer1.address);
      expect(newEthBalance > ethBalance);
    });

    it('relayers can get refunded via a relayerLower', async () => {
      let amount = 10n * ONE_USDC;

      const ethBalance = await ethers.provider.getBalance(relayer1.address);
      await sendUSDC(bridge, amount);
      [lowerProof] = await createLowerProof(bridge, usdc, amount, user);
      const { gasCost } = await costLower(bridge, relayer1, lowerProof);
      await bridge.connect(relayer1).relayerLower(gasCost, lowerProof, false);
      const newEthBalance = await ethers.provider.getBalance(relayer1.address);
      expect(newEthBalance > ethBalance);
    });

    xit('trigger slippage revert', async () => {
      if (network === 'sepolia') return true;
      const poolBalance = await usdc.balanceOf(await swapHelper.pool());
      const priceMovingAmount = poolBalance / 2n;
      await sendUSDC(swapHelper, priceMovingAmount);
      await swapHelper.swapToWETH(priceMovingAmount);
      const amount = 1n * ONE_USDC;
      let slipped = false;

      while (!slipped) {
        await sendUSDC(bridge, amount);
        [lowerProof] = await createLowerProof(bridge, usdc, amount, user);
        const { gasCost } = await costLower(bridge, relayer1, lowerProof);
        const tx = await bridge.connect(relayer1).relayerLower(gasCost, lowerProof, true);
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
      const { gasCost } = await costLower(bridge, relayer1, lowerProof);
      await bridge.connect(relayer1).relayerLower(gasCost, lowerProof, false);
    });
  });
});
