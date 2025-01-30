const { deployTruthBridge, deployTruthToken, expect, getAccounts, getAuthors, init, ONE_HUNDRED_BILLION, ZERO_ADDRESS } = require('./helper.js');
let authors, bridge, truth, owner, newOwner, otherAccount, numAuthors;

describe('Owner Functions', async () => {
  before(async () => {
    numAuthors = 5;
    await init(5);
    [owner, newOwner, otherAccount] = getAccounts();
    authors = getAuthors();
    truth = await deployTruthToken(ONE_HUNDRED_BILLION);
    bridge = await deployTruthBridge(truth);
  });

  context('Transferring Ownership', async () => {
    context('succeeds', async () => {
      it('when called by the owner for the bridge', async () => {
        await expect(bridge.transferOwnership(newOwner.address)).to.emit(bridge, 'OwnershipTransferStarted').withArgs(owner, newOwner.address);

        expect(newOwner.address).to.equal(await bridge.pendingOwner());
        expect(owner).to.equal(await bridge.owner());

        await expect(bridge.connect(newOwner).acceptOwnership()).to.emit(bridge, 'OwnershipTransferred').withArgs(owner, newOwner.address);

        expect(ZERO_ADDRESS).to.equal(await bridge.pendingOwner());
        expect(newOwner.address).to.equal(await bridge.owner());

        await bridge.connect(newOwner).transferOwnership(owner);
        await bridge.acceptOwnership();
        expect(owner).to.equal(await bridge.owner());
      });

      it('when called by the owner for the truth token', async () => {
        await expect(truth.transferOwnership(newOwner.address)).to.emit(truth, 'OwnershipTransferStarted').withArgs(owner, newOwner.address);

        expect(newOwner.address).to.equal(await truth.pendingOwner());
        expect(owner).to.equal(await truth.owner());

        await expect(truth.connect(newOwner).acceptOwnership()).to.emit(truth, 'OwnershipTransferred').withArgs(owner, newOwner.address);

        expect(ZERO_ADDRESS).to.equal(await truth.pendingOwner());
        expect(newOwner.address).to.equal(await truth.owner());

        await truth.connect(newOwner).transferOwnership(owner);
        await truth.acceptOwnership();
        expect(owner).to.equal(await truth.owner());
      });
    });
    context('fails', async () => {
      it('when the caller is not the owner', async () => {
        await expect(bridge.connect(otherAccount).transferOwnership(otherAccount.address)).to.be.revertedWithCustomError(bridge, 'OwnableUnauthorizedAccount');
      });

      it('when an unauthorised account attempts to accept ownership', async () => {
        await bridge.transferOwnership(newOwner.address);
        await expect(bridge.connect(otherAccount).acceptOwnership()).to.be.revertedWithCustomError(bridge, 'OwnableUnauthorizedAccount');
      });
    });
  });

  context('Renouncing ownership', async () => {
    context('is disabled', async () => {
      it('on the bridge', async () => {
        expect(owner).to.equal(await bridge.owner());
        await expect(bridge.renounceOwnership()).to.be.revertedWith('Disabled');
        expect(owner).to.equal(await bridge.owner());
      });

      it('on the truth token', async () => {
        expect(owner).to.equal(await truth.owner());
        await expect(truth.renounceOwnership()).to.be.revertedWith('Disabled');
        expect(owner).to.equal(await truth.owner());
      });
    });

    context('fails', async () => {
      it('on the bridge when the caller is not the owner', async () => {
        await expect(bridge.connect(otherAccount).renounceOwnership()).to.be.revertedWithCustomError(bridge, 'OwnableUnauthorizedAccount');
      });

      it('on the truth token when the caller is not the owner', async () => {
        await expect(truth.connect(otherAccount).renounceOwnership()).to.be.revertedWithCustomError(truth, 'OwnableUnauthorizedAccount');
      });
    });
  });

  context('Pausing bridge functionality', async () => {
    context('succeeds', async () => {
      it('when the caller is the owner', async () => {
        await bridge.pause();
        await bridge.unpause();
      });
    });

    context('fails', async () => {
      it('to pause when the contract is already paused', async () => {
        await bridge.pause();
        await expect(bridge.pause()).to.be.revertedWithCustomError(bridge, 'EnforcedPause');
        await bridge.unpause();
      });

      it('to unpause when the contract is not paused', async () => {
        await expect(bridge.unpause()).to.be.revertedWithCustomError(bridge, 'ExpectedPause');
      });

      it('when the caller is not the owner', async () => {
        await expect(bridge.connect(otherAccount).pause()).to.be.revertedWithCustomError(bridge, 'OwnableUnauthorizedAccount');
        await bridge.pause();
        await expect(bridge.connect(otherAccount).unpause()).to.be.revertedWithCustomError(bridge, 'OwnableUnauthorizedAccount');
        await bridge.unpause();
      });
    });
  });

  context('Bridge initialization', async () => {
    function initialValues() {
      return {
        truth: truth.address,
        t1Addresses: authors.map(author => author.t1Address),
        t1PubKeysLHS: authors.map(author => author.t1PubKeyLHS),
        t1PubKeysRHS: authors.map(author => author.t1PubKeyRHS),
        t2PubKeys: authors.map(author => author.t2PubKey)
      };
    }

    let initVals;

    context('succeeds', async () => {
      it('with the correct arguments', async () => {
        const newBridge = await deployTruthBridge(truth);
        initVals = initialValues();

        for (i = 0; i < numAuthors; i++) {
          const authorId = i + 1;
          expect(await newBridge.t1AddressToId(initVals.t1Addresses[i])).to.equal(authorId);
          expect(await newBridge.t2PubKeyToId(initVals.t2PubKeys[i])).to.equal(authorId);
          expect(await newBridge.isAuthor(authorId)).to.equal(true);
          expect(await newBridge.authorIsActive(authorId)).to.equal(true);
          expect(await newBridge.idToT1Address(authorId)).to.equal(initVals.t1Addresses[i]);
          expect(await newBridge.idToT2PubKey(authorId)).to.equal(initVals.t2PubKeys[i]);
        }

        expect(await newBridge.numActiveAuthors()).to.equal(numAuthors);
        expect(await newBridge.nextAuthorId()).to.equal(numAuthors + 1);
      });
    });

    context('fails', async () => {
      async function deployAndCatchInitError(expectedError) {
        const initArgs = [initVals.truth, initVals.t1Addresses, initVals.t1PubKeysLHS, initVals.t1PubKeysRHS, initVals.t2PubKeys];
        let actualError = '';
        try {
          await upgrades.deployProxy(await ethers.getContractFactory('TruthBridge'), initArgs, { kind: 'uups' });
        } catch (error) {
          actualError = error.toString().split("custom error '")[1].split('(')[0];
        } finally {
          expect(actualError).to.equal(expectedError);
        }
      }

      beforeEach(async () => {
        initVals = initialValues();
      });

      it('without a truth token address', async () => {
        initVals.truth = ZERO_ADDRESS;
        await deployAndCatchInitError('MissingTruth');
      });

      it('when a T1 address does not correspond to its public key', async () => {
        initVals.t1PubKeysLHS[0] = authors[1].t1PubKeyLHS;
        await deployAndCatchInitError('AddressMismatch');
      });

      it('when addresses are missing', async () => {
        initVals.t1Addresses.pop();
        await deployAndCatchInitError('MissingKeys');
      });

      it('when t1 key left halves are missing', async () => {
        initVals.t1PubKeysLHS.pop();
        await deployAndCatchInitError('MissingKeys');
      });

      it('when t1 key right halves are missing', async () => {
        initVals.t1PubKeysRHS.pop();
        await deployAndCatchInitError('MissingKeys');
      });

      it('when t2 keys are missing', async () => {
        initVals.t2PubKeys.pop();
        await deployAndCatchInitError('MissingKeys');
      });

      it('if any t1 addresses are duplicated', async () => {
        initVals.t1Addresses[0] = initVals.t1Addresses[2];
        initVals.t1PubKeysLHS[0] = initVals.t1PubKeysLHS[2];
        initVals.t1PubKeysRHS[0] = initVals.t1PubKeysRHS[2];
        await deployAndCatchInitError('T1AddressInUse');
      });

      it('if any t2 addresses are duplicated', async () => {
        initVals.t2PubKeys[1] = initVals.t2PubKeys[3];
        await deployAndCatchInitError('T2KeyInUse');
      });

      it('when not enough authors are provided', async () => {
        initVals.t1Addresses.splice(-2, 2);
        initVals.t1PubKeysLHS.splice(-2, 2);
        initVals.t1PubKeysRHS.splice(-2, 2);
        initVals.t2PubKeys.splice(-2, 2);
        await deployAndCatchInitError('NotEnoughAuthors');
      });
    });
  });

  context('Reinitialization', async () => {
    it('Cannot reinitialize the bridge', async () => {
      const initArgs = [
        truth.address,
        authors.map(author => author.t1Address),
        authors.map(author => author.t1PubKeyLHS),
        authors.map(author => author.t1PubKeyRHS),
        authors.map(author => author.t2PubKey)
      ];
      await expect(bridge.initialize(...initArgs)).to.be.reverted;
    });

    it('Cannot reinitialize the truth token', async () => {
      await expect(truth.initialize('Truth2', 'TRU2', 1234567n)).to.be.reverted;
    });
  });

  context('Upgrading the contracts', async () => {
    context('succeeds', async () => {
      it('in upgrading the bridge when the caller is the owner', async () => {
        const contract = await ethers.getContractFactory('TruthBridgeUpgrade');
        const upgradedBridge = await upgrades.upgradeProxy(bridge.address, contract);
        expect(await upgradedBridge.newFunction()).to.equal('TruthBridge upgraded');
      });

      it('in upgrading the truth token when the caller is the owner', async () => {
        const contract = await ethers.getContractFactory('TruthTokenUpgrade');
        const upgradedToken = await upgrades.upgradeProxy(truth.address, contract);
        expect(await upgradedToken.newFunction()).to.equal('TruthToken upgraded');
      });
    });

    context('fails', async () => {
      it('to upgrade the bridge when the caller is not the owner', async () => {
        const contract = await ethers.getContractFactory('TruthBridgeUpgrade');
        const newBridge = await contract.deploy();
        await expect(bridge.connect(otherAccount).upgradeToAndCall(await newBridge.getAddress(), '0x')).to.be.revertedWithCustomError(
          bridge,
          'OwnableUnauthorizedAccount'
        );
      });

      it('to upgrade the truth token when the caller is not the owner', async () => {
        const contract = await ethers.getContractFactory('TruthTokenUpgrade');
        const newToken = await contract.deploy();
        await expect(truth.connect(otherAccount).upgradeToAndCall(await newToken.getAddress(), '0x')).to.be.revertedWithCustomError(
          truth,
          'OwnableUnauthorizedAccount'
        );
      });
    });
  });
});
