const {
  createLowerProof,
  createTreeAndPublishRoot,
  deployTruthBridge,
  deployTruthToken,
  EMPTY_32_BYTES,
  expect,
  getAccounts,
  getNumRequiredConfirmations,
  getPermit,
  init,
  randomBytes32,
  ZERO_ADDRESS
} = require('./helper.js');

let bridge, truth, owner, user, t2PubKey;

describe('Author Functions', async () => {
  before(async () => {
    const numAuthors = 6;
    await init(numAuthors);
    [owner, user] = getAccounts();
    truth = await deployTruthToken();
    bridge = await deployTruthBridge(truth);
    t2PubKey = await bridge.deriveT2PublicKey(owner.address);
  });

  context('Lifting', async () => {
    const amount = 100n;

    context('succeeds', async () => {
      let bridgeBalanceBefore;

      beforeEach(async () => {
        bridgeBalanceBefore = await truth.balanceOf(bridge.address);
      });

      afterEach(async () => {
        expect(await truth.balanceOf(bridge.address), bridgeBalanceBefore + amount);
      });

      it('in lifting ERC20 tokens to a t2 public key', async () => {
        await truth.approve(bridge.address, amount);
        await expect(bridge.lift(truth.address, t2PubKey, amount))
          .to.emit(bridge, 'LogLifted')
          .withArgs(truth.address, t2PubKey, amount);
      });

      it('in lifting ERC20 tokens to the prediction market and t2 public key derived from the sender address', async () => {
        await truth.approve(bridge.address, amount);
        await expect(bridge.liftToPredictionMarket(truth.address, amount))
          .to.emit(bridge, 'LogLiftedToPredictionMarket')
          .withArgs(truth.address, t2PubKey, amount);
      });

      it('in lifting ERC20 tokens with a permit', async () => {
        const liftPermit = await getPermit(truth, owner, bridge, amount);
        await expect(bridge.lift(truth.address, t2PubKey, amount, liftPermit.deadline, liftPermit.v, liftPermit.r, liftPermit.s))
          .to.emit(bridge, 'LogLifted')
          .withArgs(truth.address, t2PubKey, amount);
      });

      it('in lifting ERC20 tokens to the prediction market with a permit', async () => {
        const liftPermit = await getPermit(truth, owner, bridge, amount);
        await expect(bridge.liftToPredictionMarket(truth.address, amount, liftPermit.deadline, liftPermit.v, liftPermit.r, liftPermit.s))
          .to.emit(bridge, 'LogLiftedToPredictionMarket')
          .withArgs(truth.address, t2PubKey, amount);
      });
    });

    context('fails when', async () => {
      it('attempting to lift 0 ERC20 tokens', async () => {
        await truth.approve(bridge.address, 0n);
        await expect(bridge.lift(truth.address, t2PubKey, 0n)).to.be.revertedWithCustomError(bridge, 'LiftFailed');
      });

      it('attempting to lift ERC-20 tokens without supplying a T2 public key', async () => {
        await expect(bridge.lift(truth.address, EMPTY_32_BYTES, amount)).to.be.revertedWithCustomError(bridge, 'InvalidT2Key');
      });

      it('attempting to lift ERC-20 tokens with a permit but without supplying a T2 public key', async () => {
        const liftPermit = await getPermit(truth, owner, bridge, amount);
        await expect(
          bridge.lift(truth.address, EMPTY_32_BYTES, amount, liftPermit.deadline, liftPermit.v, liftPermit.r, liftPermit.s)
        ).to.be.revertedWithCustomError(bridge, 'InvalidT2Key');
      });

      it('attempting to lift more ERC20 tokens to T2 than its supported limit', async () => {
        const MAX_LIFT_AMOUNT = 2n ** 128n - 1n;
        const hugeSupplyERC20 = await deployTruthToken(100000000000000000000000000000n);
        await hugeSupplyERC20.approve(bridge.address, MAX_LIFT_AMOUNT);
        await bridge.lift(hugeSupplyERC20.address, t2PubKey, MAX_LIFT_AMOUNT);
        await hugeSupplyERC20.approve(bridge.address, 1n);
        await expect(bridge.lift(hugeSupplyERC20.address, t2PubKey, 1n)).to.be.revertedWithCustomError(bridge, 'LiftLimitHit');
      });

      it('attempting to lift ERC20 tokens when the contract is paused', async () => {
        await bridge.pause();
        await truth.approve(bridge.address, amount);
        await expect(bridge.lift(truth.address, t2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'EnforcedPause');
        const liftPermit = await getPermit(truth, owner, bridge, amount);
        await expect(bridge.lift(truth.address, t2PubKey, amount, liftPermit.deadline, liftPermit.v, liftPermit.r, liftPermit.s)).to.be.revertedWithCustomError(
          bridge,
          'EnforcedPause'
        );
        await bridge.unpause();
      });

      it('attempting to lift to the prediction market when the contract is paused', async () => {
        await bridge.pause();
        await truth.approve(bridge.address, amount);
        await expect(bridge.liftToPredictionMarket(truth.address, amount)).to.be.revertedWithCustomError(bridge, 'EnforcedPause');
        const liftPermit = await getPermit(truth, owner, bridge, amount);
        await expect(
          bridge.liftToPredictionMarket(truth.address, amount, liftPermit.deadline, liftPermit.v, liftPermit.r, liftPermit.s)
        ).to.be.revertedWithCustomError(bridge, 'EnforcedPause');
        await bridge.unpause();
      });

      it('attempting to lift more ERC20 tokens than are approved', async () => {
        await truth.approve(bridge.address, 100n);
        await expect(bridge.lift(truth.address, t2PubKey, 200n)).to.be.rejectedWith(truth, 'ERC20InsufficientAllowance');
      });

      it('attempting to lift more ERC20 tokens than are available in sender balance', async () => {
        await expect(bridge.connect(user).lift(truth.address, t2PubKey, 1n)).to.be.rejectedWith(truth, 'ERC20InsufficientAllowance');
      });
    });
  });

  context('Claiming lowers', async () => {
    const amount = 50n;

    context('succeeds', async () => {
      it('in lowering ERC20 tokens', async () => {
        await truth.approve(bridge.address, amount);
        await bridge.lift(truth.address, t2PubKey, amount);

        const initialBridgeBalance = await truth.balanceOf(bridge.address);
        const initialSenderBalance = await truth.balanceOf(owner.address);
        const [lowerProof, lowerId] = await createLowerProof(bridge, truth, amount, owner);

        await expect(bridge.connect(user).claimLower(lowerProof)).to.emit(bridge, 'LogLowerClaimed').withArgs(lowerId);
        expect(await truth.balanceOf(bridge.address), initialBridgeBalance - amount);
        expect(await truth.balanceOf(owner.address), initialSenderBalance + amount);
      });
    });

    context('fails when', async () => {
      let lowerProof;

      beforeEach(async () => {
        [lowerProof] = await createLowerProof(bridge, truth, amount, owner);
      });

      it('contract is paused', async () => {
        await bridge.pause();
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'EnforcedPause');
        await bridge.unpause();
        await bridge.claimLower(lowerProof);
      });

      it('the proof has already been used', async () => {
        await bridge.claimLower(lowerProof);
        await expect(bridge.claimLower(lowerProof)).to.be.revertedWithCustomError(bridge, 'LowerIsUsed');
      });

      it('the proof is invalid', async () => {
        await expect(bridge.claimLower(randomBytes32())).to.be.revertedWithCustomError(bridge, 'InvalidProof');
      });
    });
  });

  context('Reentrancy attempts', async () => {
    const reentryPoint = { ClaimLower: 0, Lift: 1, LiftPermit: 2, LiftPM: 3, LiftPMPermit: 4 };
    const amount = 100n;
    let reentrantToken;

    before(async () => {
      const contract = await ethers.getContractFactory('ReentrantToken');
      reentrantToken = await contract.deploy(bridge.address);
      reentrantToken.address = await reentrantToken.getAddress();
      await reentrantToken.approve(bridge.address, amount * 5n);
    });

    it('a non-standard ERC20 token triggers the claimLower re-entrancy check', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.ClaimLower);
      await expect(bridge.lift(reentrantToken.address, t2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'ReentrancyGuardReentrantCall');
    });

    it('a non-standard ERC20 token triggers the lift re-entrancy check', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.Lift);
      await expect(bridge.lift(reentrantToken.address, t2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'ReentrancyGuardReentrantCall');
    });

    it('a non-standard ERC20 token triggers the lift with permit re-entrancy check', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.LiftPermit);
      await expect(bridge.lift(reentrantToken.address, t2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'ReentrancyGuardReentrantCall');
    });

    it('a non-standard ERC20 token triggers the liftToPredictionMarket re-entrancy check', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.LiftPM);
      await expect(bridge.lift(reentrantToken.address, t2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'ReentrancyGuardReentrantCall');
    });

    it('a non-standard ERC20 token triggers the liftToPredictionMarket with permit re-entrancy check', async () => {
      await reentrantToken.setReentryPoint(reentryPoint.LiftPMPermit);
      await expect(bridge.lift(reentrantToken.address, t2PubKey, amount)).to.be.revertedWithCustomError(bridge, 'ReentrancyGuardReentrantCall');
    });
  });

  context('Check lower', async () => {
    it('results are as expected for a valid, unused proof', async () => {
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

    it('results are as expected for a valid, used proof', async () => {
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

    it('results are as expected for invalid confirmations in an otherwise valid proof', async () => {
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

    it('results are as expected for a completely invalid proof', async () => {
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

  context('Confirming T2 transactions on T1', async () => {
    context('succeeds', async () => {
      it('in confirming a T2 tx leaf exists in a published root', async () => {
        let tree = await createTreeAndPublishRoot(bridge, owner, truth, 0n);
        expect(await bridge.confirmTransaction(tree.leafHash, tree.merklePath)).to.equal(true);
        expect(await bridge.confirmTransaction(randomBytes32(), tree.merklePath)).to.equal(false);
      });
    });
  });
});
