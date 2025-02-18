const {
  createLowerProof,
  createTreeAndPublishRoot,
  deployTruthBridge,
  deployTruthToken,
  EMPTY_BYTES,
  expect,
  getAccounts,
  getNumRequiredConfirmations,
  getPermit,
  init,
  ONE_HUNDRED_BILLION,
  randomBytes32,
  ZERO_ADDRESS
} = require('./helper.js');

let bridge, truth, owner, user, t2PubKey;

describe('User Functions', async () => {
  before(async () => {
    const numAuthors = 6;
    await init(numAuthors);
    [owner, user] = getAccounts();
    truth = await deployTruthToken(ONE_HUNDRED_BILLION, owner);
    bridge = await deployTruthBridge(truth, owner);
    t2PubKey = await bridge.deriveT2PublicKey(owner.address);
  });

  context('Truth token', async () => {
    it('confirm setup', async () => {
      expect(await truth.name()).to.equal('Truth');
      expect(await truth.symbol()).to.equal('TRU');
      expect(await truth.decimals()).to.equal(10n);
      expect(await truth.totalSupply()).to.equal(1000000000000000000000n);
      expect(await truth.owner()).to.equal(owner.address);
      expect(await truth.totalSupply()).to.equal(await truth.balanceOf(owner.address));
    });
  });

  context('Lifting ERC20 tokens', async () => {
    const amount = 100n;

    context('succeeds', async () => {
      let bridgeBalanceBefore;

      beforeEach(async () => {
        bridgeBalanceBefore = await truth.balanceOf(bridge.address);
      });

      afterEach(async () => {
        expect(await truth.balanceOf(bridge.address), bridgeBalanceBefore + amount);
      });

      it('in lifting tokens to the specified t2 public key', async () => {
        await truth.approve(bridge.address, amount);
        await expect(bridge.lift(truth.address, t2PubKey, amount))
          .to.emit(bridge, 'LogLifted')
          .withArgs(truth.address, t2PubKey, amount);
      });

      it('in lifting tokens to the prediction market and the t2 public key derived from the address of the sender', async () => {
        await truth.approve(bridge.address, amount);
        await expect(bridge.liftToPredictionMarket(truth.address, amount))
          .to.emit(bridge, 'LogLiftedToPredictionMarket')
          .withArgs(truth.address, t2PubKey, amount);
      });

      it('in lifting tokens with a valid permit', async () => {
        const permit = await getPermit(truth, owner, bridge, amount);
        await expect(bridge.lift(truth.address, t2PubKey, amount, permit.deadline, permit.v, permit.r, permit.s))
          .to.emit(bridge, 'LogLifted')
          .withArgs(truth.address, t2PubKey, amount);
      });

      it('in lifting tokens to the prediction market with a valid permit', async () => {
        const permit = await getPermit(truth, owner, bridge, amount);
        await expect(bridge.liftToPredictionMarket(truth.address, amount, permit.deadline, permit.v, permit.r, permit.s))
          .to.emit(bridge, 'LogLiftedToPredictionMarket')
          .withArgs(truth.address, t2PubKey, amount);
      });
    });

    context('fails when', async () => {
      it('attempting to lift 0 tokens', async () => {
        await truth.approve(bridge.address, 0n);
        await expect(bridge.lift(truth.address, t2PubKey, 0n)).to.be.revertedWithCustomError(bridge, 'LiftFailed');
      });

      it('attempting to lift tokens without supplying a T2 public key', async () => {
        await expect(bridge.lift(truth.address, EMPTY_BYTES, amount)).to.be.revertedWithCustomError(bridge, 'InvalidT2Key');
      });

      it('attempting to lift tokens with a permit but without supplying a T2 public key', async () => {
        const permit = await getPermit(truth, owner, bridge, amount);
        await expect(bridge.lift(truth.address, EMPTY_BYTES, amount, permit.deadline, permit.v, permit.r, permit.s)).to.be.revertedWithCustomError(
          bridge,
          'InvalidT2Key'
        );
      });

      it('attempting to lift more tokens than the T2 limit', async () => {
        const MAX_LIFT_AMOUNT = 2n ** 128n - 1n;
        const hugeSupplyToken = await deployTruthToken(999999999999999999999999999999n, owner);
        await hugeSupplyToken.approve(bridge.address, MAX_LIFT_AMOUNT);
        await bridge.lift(hugeSupplyToken.address, t2PubKey, MAX_LIFT_AMOUNT);
        await hugeSupplyToken.approve(bridge.address, 1n);
        await expect(bridge.lift(hugeSupplyToken.address, t2PubKey, 1n)).to.be.revertedWithCustomError(bridge, 'LiftLimitHit');
      });

      it('attempting to lift tokens when the contract is paused', async () => {
        await bridge.pause();
        await truth.approve(bridge.address, amount);
        await expect(bridge.lift(truth.address, t2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'EnforcedPause');
        const permit = await getPermit(truth, owner, bridge, amount);
        await expect(bridge.lift(truth.address, t2PubKey, amount, permit.deadline, permit.v, permit.r, permit.s)).to.be.revertedWithCustomError(
          bridge,
          'EnforcedPause'
        );
        await bridge.unpause();
      });

      it('attempting to lift to the prediction market when the contract is paused', async () => {
        await bridge.pause();
        await truth.approve(bridge.address, amount);
        await expect(bridge.liftToPredictionMarket(truth.address, amount)).to.be.revertedWithCustomError(bridge, 'EnforcedPause');
        const permit = await getPermit(truth, owner, bridge, amount);
        await expect(bridge.liftToPredictionMarket(truth.address, amount, permit.deadline, permit.v, permit.r, permit.s)).to.be.revertedWithCustomError(
          bridge,
          'EnforcedPause'
        );
        await bridge.unpause();
      });

      it('attempting to lift more tokens than are approved', async () => {
        await truth.approve(bridge.address, 100n);
        await expect(bridge.lift(truth.address, t2PubKey, 200n)).to.be.rejectedWith(truth, 'ERC20InsufficientAllowance');
      });

      it('attempting to lift more tokens than the sender holds', async () => {
        await expect(bridge.connect(user).lift(truth.address, t2PubKey, 1n)).to.be.rejectedWith(truth, 'ERC20InsufficientAllowance');
      });
    });
  });

  context('Lowering ERC20 tokens', async () => {
    const amount = 50n;

    context('succeeds', async () => {
      it('in lowering tokens to the recipient in the proof', async () => {
        await truth.approve(bridge.address, amount);
        await bridge.lift(truth.address, t2PubKey, amount);

        const initialBridgeBalance = await truth.balanceOf(bridge.address);
        const initialSenderBalance = await truth.balanceOf(owner.address);
        const [lowerProof, lowerId] = await createLowerProof(bridge, truth, amount, owner);

        await expect(bridge.connect(user).claimLower(lowerProof)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        expect(await truth.balanceOf(bridge.address)).to.equal(initialBridgeBalance - amount);
        expect(await truth.balanceOf(owner.address)).to.equal(initialSenderBalance + amount);
      });
    });

    context('fails when', async () => {
      let lowerProof;

      beforeEach(async () => {
        [lowerProof] = await createLowerProof(bridge, truth, amount, owner);
      });

      it('the bridge is paused', async () => {
        await bridge.pause();
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'EnforcedPause');
        await bridge.unpause();
        await bridge.claimLower(lowerProof);
      });

      it('the proof is used', async () => {
        await bridge.claimLower(lowerProof);
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsUsed');
      });

      it('the proof is invalid', async () => {
        await expect(bridge.claimLower(randomBytes32())).to.be.revertedWithCustomError(bridge, 'InvalidProof');
      });
    });
  });

  context('Reentrancy prevention', async () => {
    const reentryPoint = { ClaimLower: 0, Lift: 1, LiftPermit: 2, LiftPM: 3, LiftPMPermit: 4 };
    const amount = 100n;
    let reentrantToken;

    before(async () => {
      const contract = await ethers.getContractFactory('ReentrantToken');
      reentrantToken = await contract.deploy(bridge.address);
      reentrantToken.address = await reentrantToken.getAddress();
      await reentrantToken.approve(bridge.address, amount * 5n);
    });

    it('the claimLower re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.ClaimLower);
      await expect(bridge.lift(reentrantToken.address, t2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'ReentrancyGuardReentrantCall');
    });

    it('the lift re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.Lift);
      await expect(bridge.lift(reentrantToken.address, t2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'ReentrancyGuardReentrantCall');
    });

    it('the lift with permit re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.LiftPermit);
      await expect(bridge.lift(reentrantToken.address, t2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'ReentrancyGuardReentrantCall');
    });

    it('the liftToPredictionMarket re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.LiftPM);
      await expect(bridge.lift(reentrantToken.address, t2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'ReentrancyGuardReentrantCall');
    });

    it('the liftToPredictionMarket with permit re-entrancy check is triggered correctly', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.LiftPMPermit);
      await expect(bridge.lift(reentrantToken.address, t2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'ReentrancyGuardReentrantCall');
    });
  });

  context('Checking lowers', async () => {
    it('the expected result is returned for a valid, unused proof', async () => {
      const lowerAmount = 123n;
      const [lowerProof, expectedLowerId] = await createLowerProof(bridge, truth, lowerAmount, owner);
      const [token, amount, recipient, lowerId, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await bridge.checkLower(lowerProof);

      const numConfirmationsRequired = await getNumRequiredConfirmations(bridge);
      const numConfirmationsSent = (await bridge.numActiveAuthors()) - numConfirmationsRequired;
      expect(token).to.equal(truth.address);
      expect(amount).to.equal(lowerAmount);
      expect(recipient).to.equal(owner.address);
      expect(lowerId).to.equal(expectedLowerId);
      expect(confirmationsRequired).to.equal(numConfirmationsRequired);
      expect(confirmationsProvided).to.equal(numConfirmationsSent);
      expect(proofIsValid).to.equal(true);
      expect(lowerIsClaimed).to.equal(false);
    });

    it('the expected result is returned for a valid, used proof', async () => {
      const lowerAmount = 456n;
      await truth.approve(bridge.address, lowerAmount);
      await bridge.lift(truth.address, t2PubKey, lowerAmount);
      const [lowerProof, expectedLowerId] = await createLowerProof(bridge, truth, lowerAmount, owner);
      await bridge.claimLower(lowerProof);
      const [token, amount, recipient, lowerId, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await bridge.checkLower(lowerProof);
      const numConfirmationsRequired = await getNumRequiredConfirmations(bridge);
      const numConfirmationsSent = (await bridge.numActiveAuthors()) - numConfirmationsRequired;

      expect(token).to.equal(truth.address);
      expect(amount).to.equal(lowerAmount);
      expect(recipient).to.equal(owner.address);
      expect(lowerId).to.equal(expectedLowerId);
      expect(confirmationsRequired).to.equal(numConfirmationsRequired);
      expect(confirmationsProvided).to.equal(numConfirmationsSent);
      expect(proofIsValid).to.equal(true);
      expect(lowerIsClaimed).to.equal(true);
    });

    it('the expected result is returned for a valid proof with invalid confirmations', async () => {
      const lowerAmount = 789n;
      await truth.approve(bridge.address, lowerAmount);
      await bridge.lift(truth.address, t2PubKey, lowerAmount);
      const [proofA, lowerIdA] = await createLowerProof(bridge, truth, lowerAmount, owner);
      const [proofB] = await createLowerProof(bridge, truth, lowerAmount, owner);
      const confirmationsStart = 154;
      const invalidProof = ethers.concat([proofA.slice(0, confirmationsStart), '0x' + proofB.slice(confirmationsStart)]);
      const [token, amount, recipient, lowerId, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await bridge.checkLower(invalidProof);
      const numConfirmationsRequired = await getNumRequiredConfirmations(bridge);

      expect(token).to.equal(truth.address);
      expect(amount).to.equal(lowerAmount);
      expect(recipient).to.equal(owner.address);
      expect(lowerId).to.equal(lowerIdA);
      expect(confirmationsRequired).to.equal(numConfirmationsRequired);
      expect(confirmationsProvided).to.equal(0);
      expect(proofIsValid).to.equal(false);
      expect(lowerIsClaimed).to.equal(false);
    });

    it('the expected result is returned for an invalid proof', async () => {
      const invalidProof = randomBytes32();
      const [token, amount, recipient, lowerId, confirmationsRequired, confirmationsProvided, proofIsValid, lowerIsClaimed] =
        await bridge.checkLower(invalidProof);
      expect(token).to.equal(ZERO_ADDRESS);
      expect(amount).to.equal(0);
      expect(recipient).to.equal(ZERO_ADDRESS);
      expect(lowerId).to.equal(0);
      expect(confirmationsRequired).to.equal(0);
      expect(confirmationsProvided).to.equal(0);
      expect(proofIsValid).to.equal(false);
      expect(lowerIsClaimed).to.equal(false);
    });
  });

  context('Confirming T2 transactions', async () => {
    it('the existence of a T2 transaction can be confirmed in a published root', async () => {
      const tree = await createTreeAndPublishRoot(bridge, owner, truth, 0n);
      expect(await bridge.confirmTransaction(tree.leafHash, tree.merklePath)).to.equal(true);
      expect(await bridge.confirmTransaction(randomBytes32(), tree.merklePath)).to.equal(false);
    });
  });
});
