const { deployTruthBridge, deployTruthToken, expect, getAccounts, getAuthors, init, ZERO_ADDRESS } = require('./helper.js');
let authors, bridge, truth, owner, otherAccount, numAuthors;

describe('Owner Functions', async () => {
  before(async () => {
    numAuthors = 5;
    await init(5);
    [owner, otherAccount] = getAccounts();
    authors = getAuthors();
    truth = await deployTruthToken();
    bridge = await deployTruthBridge(truth);
  });

  context('Renouncing Ownership', async () => {
    context('succeeds', async () => {
      it('does nothing when the caller is the owner', async () => {
        expect(owner).to.equal(await bridge.owner());
        await bridge.renounceOwnership();
        expect(owner).to.equal(await bridge.owner());
      });

      context('fails', async () => {
        it('when the caller is not the owner', async () => {
          await expect(bridge.connect(otherAccount).renounceOwnership()).to.be.revertedWithCustomError(bridge, 'OwnableUnauthorizedAccount');
        });
      });
    });
  });

  context('Pausing functionality', async () => {
    context('succeeds', async () => {
      it('when the caller is the owner', async () => {
        await bridge.pause();
        await bridge.unpause();
      });

      context('fails', async () => {
        it('to pause when the contract is paused', async () => {
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
  });

  context('Initialization', async () => {
    let initVals = {};

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
      initVals = {
        truth: truth.address,
        t1Addresses: authors.map(author => author.t1Address),
        t1PubKeysLHS: authors.map(author => author.t1PubKeyLHS),
        t1PubKeysRHS: authors.map(author => author.t1PubKeyRHS),
        t2PubKeys: authors.map(author => author.t2PubKey)
      };
    });

    it('succeeds', async () => {
      const newBridge = await deployTruthBridge(truth);

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

    it('fails without truth token', async () => {
      initVals.truth = ZERO_ADDRESS;
      await deployAndCatchInitError('MissingTruth');
    });

    it('fails when a T1 address does not correspond to its public key', async () => {
      initVals.t1PubKeysLHS[0] = authors[1].t1PubKeyLHS;
      await deployAndCatchInitError('AddressMismatch');
    });

    it('fails when addresses are missing', async () => {
      initVals.t1Addresses.pop();
      await deployAndCatchInitError('MissingKeys');
    });

    it('fails when t1 keys are missing', async () => {
      initVals.t1PubKeysLHS.pop();
      await deployAndCatchInitError('MissingKeys');
    });

    it('fails when t1 keys are missing', async () => {
      initVals.t1PubKeysRHS.pop();
      await deployAndCatchInitError('MissingKeys');
    });

    it('fails when keys are missing', async () => {
      initVals.t2PubKeys.pop();
      await deployAndCatchInitError('MissingKeys');
    });

    it('fails if any t1 addresses are duplicated', async () => {
      initVals.t1Addresses[0] = initVals.t1Addresses[2];
      initVals.t1PubKeysLHS[0] = initVals.t1PubKeysLHS[2];
      initVals.t1PubKeysRHS[0] = initVals.t1PubKeysRHS[2];
      await deployAndCatchInitError('T1AddressInUse');
    });

    it('fails if any t2 addresses are duplicated', async () => {
      initVals.t2PubKeys[1] = initVals.t2PubKeys[3];
      await deployAndCatchInitError('T2KeyInUse');
    });

    it('fails when there are too few authors', async () => {
      initVals.t1Addresses.splice(-2, 2);
      initVals.t1PubKeysLHS.splice(-2, 2);
      initVals.t1PubKeysRHS.splice(-2, 2);
      initVals.t2PubKeys.splice(-2, 2);
      await deployAndCatchInitError('NotEnoughAuthors');
    });
  });

  context('Initializer', async () => {
    it('Cannot reinitialize bridge', async () => {
      const initArgs = [
        truth.address,
        authors.map(author => author.t1Address),
        authors.map(author => author.t1PubKeyLHS),
        authors.map(author => author.t1PubKeyRHS),
        authors.map(author => author.t2PubKey)
      ];
      await expect(bridge.initialize(...initArgs)).to.be.reverted;
    });

    it('Cannot reinitialize token', async () => {
      await expect(truth.initialize('$Truth2', 1234567n)).to.be.reverted;
    });
  });

  context('Upgrade contracts', async () => {
    context('succeeds', async () => {
      it('in upgrading the bridge', async () => {
        const contract = await ethers.getContractFactory('TruthBridgeUpgrade');
        const upgradedBridge = await upgrades.upgradeProxy(bridge.address, contract);
        expect(await upgradedBridge.newFunction()).to.equal('TruthBridge upgraded');
      });

      it('in upgrading the token', async () => {
        const contract = await ethers.getContractFactory('TruthTokenUpgrade');
        const upgradedToken = await upgrades.upgradeProxy(truth.address, contract);
        expect(await upgradedToken.newFunction()).to.equal('TruthToken upgraded');
      });
    });

    context('fails', async () => {
      it('to upgrade the bridge if not the owner', async () => {
        const contract = await ethers.getContractFactory('TruthBridgeUpgrade');
        const newBridge = await contract.deploy();
        await expect(bridge.connect(otherAccount).upgradeToAndCall(await newBridge.getAddress(), '0x')).to.be.revertedWithCustomError(
          bridge,
          'OwnableUnauthorizedAccount'
        );
      });

      it('to upgrade the token if not the owner', async () => {
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
