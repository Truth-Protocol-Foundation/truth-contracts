const {
  deployBridge,
  deployToken,
  expect,
  EXPIRY_WINDOW,
  getAccounts,
  getAuthors,
  getConfirmations,
  getCurrentBlockTimestamp,
  getSingleConfirmation,
  getValidExpiry,
  init,
  increaseBlockTimestamp,
  MIN_AUTHORS,
  randomBytes32,
  randomHex,
  randomT2TxId,
  strip_0x,
  toAuthorAccount
} = require('../utils/helper.js');

let authors, bridge, truth, senderAuthor, existingAuthor, newAuthor, prospectiveAuthor;

describe('Author Functions', async () => {
  before(async () => {
    const numAuthors = 6;
    await init(numAuthors);
    [owner, newAuthor, prospectiveAuthor] = getAccounts();
    authors = getAuthors();
    truth = await deployToken(owner);
    bridge = await deployBridge(truth, owner);
    senderAuthor = authors[0].account;
    existingAuthor = authors[1];
    newAuthor = toAuthorAccount(newAuthor);
    prospectiveAuthor = toAuthorAccount(prospectiveAuthor);
    activeAuthors = await bridge.numActiveAuthors();
    nextAuthorId = await bridge.nextAuthorId();
  });

  context('Publishing Roots', async () => {
    let rootHash, t2TxId;

    before(async () => {
      rootHash = randomBytes32();
      t2TxId = randomT2TxId();
    });

    context('succeeds', async () => {
      it('via the authors', async () => {
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', rootHash, expiry, t2TxId);
        await expect(bridge.connect(senderAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations))
          .to.emit(bridge, 'LogRootPublished')
          .withArgs(rootHash, t2TxId);
      });
    });

    context('fails when', async () => {
      it('the bridge is paused', async () => {
        await bridge.pause();
        const newt2TxId = randomT2TxId();
        const newRootHash = randomBytes32();
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', newRootHash, expiry, newt2TxId);
        await expect(bridge.connect(senderAuthor).publishRoot(newRootHash, expiry, newt2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'EnforcedPause'
        );
        await bridge.unpause();
      });

      it('the expiry time has passed', async () => {
        const newt2TxId = randomT2TxId();
        const newRootHash = randomBytes32();
        const expiry = (await getCurrentBlockTimestamp()) - 1;
        const confirmations = await getConfirmations(bridge, 'publishRoot', newRootHash, expiry, newt2TxId);
        await expect(bridge.connect(senderAuthor).publishRoot(newRootHash, expiry, newt2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'WindowExpired'
        );
      });

      it('the T2 transaction ID is not unique', async () => {
        const newRootHash = randomBytes32();
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', newRootHash, expiry, t2TxId);
        await expect(bridge.connect(senderAuthor).publishRoot(newRootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(bridge, 'TxIdIsUsed');
      });

      it('the root has already been published', async () => {
        const newt2TxId = randomT2TxId();
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', rootHash, expiry, newt2TxId);
        await expect(bridge.connect(senderAuthor).publishRoot(rootHash, expiry, newt2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'RootHashIsUsed'
        );
      });

      it('the confirmations are invalid', async () => {
        t2TxId = randomT2TxId();
        rootHash = randomBytes32();
        const expiry = await getValidExpiry();
        let confirmations = '0xbadd' + strip_0x(await getConfirmations(bridge, 'publishRoot', rootHash, expiry, t2TxId));
        await expect(bridge.connect(senderAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'BadConfirmations'
        );
      });

      it('there are no confirmations', async () => {
        rootHash = randomBytes32();
        const expiry = await getValidExpiry();
        await expect(bridge.connect(senderAuthor).publishRoot(rootHash, expiry, t2TxId, '0x')).to.be.revertedWithCustomError(bridge, 'BadConfirmations');
      });

      it('there are not enough confirmations', async () => {
        t2TxId = randomT2TxId();
        rootHash = randomBytes32();
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', rootHash, expiry, t2TxId, -1);
        await expect(bridge.connect(senderAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'BadConfirmations'
        );
      });

      it('the confirmations are corrupted', async () => {
        t2TxId = randomT2TxId();
        rootHash = randomBytes32();
        const expiry = await getValidExpiry();
        let confirmations = await getConfirmations(bridge, 'publishRoot', rootHash, expiry, t2TxId);
        confirmations = confirmations.replace(/1/g, '2');
        await expect(bridge.connect(senderAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'BadConfirmations'
        );
      });

      it('the confirmations are not signed by active authors', async () => {
        t2TxId = randomT2TxId();
        rootHash = randomBytes32();
        const startFromNonAuthor = nextAuthorId;
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', rootHash, expiry, t2TxId, 0, startFromNonAuthor);
        await expect(bridge.connect(senderAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'BadConfirmations'
        );
      });

      it('the confirmations are not unique', async () => {
        t2TxId = randomT2TxId();
        rootHash = randomBytes32();
        const halfSet = Math.round(Number(await bridge.numActiveAuthors()) / 2);
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'publishRoot', rootHash, expiry, t2TxId, -halfSet);
        const duplicateConfirmations = confirmations + strip_0x(confirmations);
        await expect(bridge.connect(senderAuthor).publishRoot(rootHash, expiry, t2TxId, duplicateConfirmations)).to.be.revertedWithCustomError(
          bridge,
          'BadConfirmations'
        );
      });
    });
  });

  context('Adding Authors', async () => {
    context('succeeds', async () => {
      it('via the authors', async () => {
        const activeAuthorsBefore = await bridge.numActiveAuthors();
        let t2TxId = randomT2TxId();
        let expiry = await getValidExpiry();
        let confirmations = await getConfirmations(bridge, 'addAuthor', [newAuthor.t1PubKey, newAuthor.t2PubKey], expiry, t2TxId);
        await expect(bridge.connect(senderAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations))
          .to.emit(bridge, 'LogAuthorAdded')
          .withArgs(newAuthor.t1Address, newAuthor.t2PubKey, t2TxId);
        expect(await bridge.idToT1Address(nextAuthorId)).to.equal(newAuthor.t1Address);

        // The author has been added but is not active
        expect(activeAuthorsBefore).to.equal(await bridge.numActiveAuthors());
        expect(await bridge.authorIsActive(nextAuthorId)).to.equal(false);

        // Publishing a root containing a confirmation from the new author activates the author
        rootHash = randomBytes32();
        expiry = await getValidExpiry();
        t2TxId = randomT2TxId();
        confirmations = await getConfirmations(bridge, 'publishRoot', rootHash, expiry, t2TxId);
        newAuthorConfirmation = await getSingleConfirmation('publishRoot', rootHash, expiry, t2TxId, newAuthor);
        const confirmationsIncludingNewAuthor = newAuthorConfirmation + confirmations.substring(2);
        await bridge.connect(senderAuthor).publishRoot(rootHash, expiry, t2TxId, confirmationsIncludingNewAuthor);

        expect(activeAuthorsBefore + 1n).to.equal(await bridge.numActiveAuthors());
        expect(await bridge.authorIsActive(nextAuthorId)).to.equal(true);
      });
    });

    context('fails when', async () => {
      it('the bridge is paused', async () => {
        await bridge.pause();
        const expiry = await getValidExpiry();
        const t2TxId = randomT2TxId();
        const confirmations = await getConfirmations(bridge, 'addAuthor', [prospectiveAuthor.t1PubKey, prospectiveAuthor.t2PubKey], expiry, t2TxId);
        await expect(
          bridge.connect(senderAuthor).addAuthor(prospectiveAuthor.t1PubKey, prospectiveAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(bridge, 'EnforcedPause');
        await bridge.unpause();
      });

      it('the T1 public key is empty', async () => {
        const emptyKey = '0x';
        const expiry = await getValidExpiry();
        const t2TxId = randomT2TxId();
        const confirmations = await getConfirmations(bridge, 'addAuthor', [emptyKey, prospectiveAuthor.t2PubKey], expiry, t2TxId);
        await expect(bridge.connect(senderAuthor).addAuthor(emptyKey, prospectiveAuthor.t2PubKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'InvalidT1Key'
        );
      });

      it('the expiry time has passed', async () => {
        const expiry = (await getCurrentBlockTimestamp()) - 1;
        const t2TxId = randomT2TxId();
        const confirmations = await getConfirmations(bridge, 'addAuthor', [prospectiveAuthor.t1PubKey, prospectiveAuthor.t2PubKey], expiry, t2TxId);
        await expect(
          bridge.connect(senderAuthor).addAuthor(prospectiveAuthor.t1PubKey, prospectiveAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(bridge, 'WindowExpired');
      });

      it('the author is already active', async () => {
        const expiry = await getValidExpiry();
        const t2TxId = randomT2TxId();
        const confirmations = await getConfirmations(bridge, 'addAuthor', [existingAuthor.t1PubKey, existingAuthor.t2PubKey], expiry, t2TxId);
        await expect(
          bridge.connect(senderAuthor).addAuthor(existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(bridge, 'AlreadyAdded');
      });

      it('trying to re-add a removed author with a different public key', async () => {
        let expiry = await getValidExpiry();
        let t2TxId = randomT2TxId();
        let confirmations = await getConfirmations(bridge, 'removeAuthor', [existingAuthor.t2PubKey, existingAuthor.t1PubKey], expiry, t2TxId);
        await bridge.connect(senderAuthor).removeAuthor(existingAuthor.t2PubKey, existingAuthor.t1PubKey, expiry, t2TxId, confirmations);
        activeAuthors--;

        expiry = await getValidExpiry();
        t2TxId = randomT2TxId();
        confirmations = await getConfirmations(bridge, 'addAuthor', [existingAuthor.t1PubKey, newAuthor.t2PubKey], expiry, t2TxId);
        await expect(
          bridge.connect(senderAuthor).addAuthor(existingAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(bridge, 'CannotChangeT2Key');

        t2TxId = randomT2TxId();
        confirmations = await getConfirmations(bridge, 'addAuthor', [existingAuthor.t1PubKey, existingAuthor.t2PubKey], expiry, t2TxId);
        await bridge.connect(senderAuthor).addAuthor(existingAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations);
        nextAuthorId++;
      });

      it('the T2 public key is already in use', async () => {
        const t2TxId = randomT2TxId();
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'addAuthor', [prospectiveAuthor.t1PubKey, existingAuthor.t2PubKey], expiry, t2TxId);
        await expect(
          bridge.connect(senderAuthor).addAuthor(prospectiveAuthor.t1PubKey, existingAuthor.t2PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(bridge, 'T2KeyInUse');
      });
    });
  });

  context('Removing Authors', async () => {
    context('succeeds', async () => {
      it('via the authors (an author can be added, activated and removed)', async () => {
        let activeAuthorsBeforeAddition = await bridge.numActiveAuthors();

        expiry = await getValidExpiry();
        t2TxId = randomT2TxId();
        confirmations = await getConfirmations(bridge, 'removeAuthor', [newAuthor.t2PubKey, newAuthor.t1PubKey], expiry, t2TxId);
        await expect(bridge.connect(senderAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations))
          .to.emit(bridge, 'LogAuthorRemoved')
          .withArgs(newAuthor.t1Address, newAuthor.t2PubKey, t2TxId);

        expect(await bridge.nextAuthorId()).to.equal(nextAuthorId);
        expect(await bridge.numActiveAuthors()).to.equal(activeAuthorsBeforeAddition - 1n);
      });

      it('via the authors (an author can be added and removed without ever being activated)', async () => {
        const activeAuthorsBeforeAddition = await bridge.numActiveAuthors();
        let t2TxId = randomT2TxId();
        let expiry = await getValidExpiry();
        let confirmations = await getConfirmations(bridge, 'addAuthor', [newAuthor.t1PubKey, newAuthor.t2PubKey], expiry, t2TxId);
        await bridge.connect(senderAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);
        expect(await bridge.nextAuthorId()).to.equal(nextAuthorId);
        expect(await bridge.numActiveAuthors()).to.equal(activeAuthorsBeforeAddition);

        t2TxId = randomT2TxId();
        expiry = await getValidExpiry();
        confirmations = await getConfirmations(bridge, 'removeAuthor', [newAuthor.t2PubKey, newAuthor.t1PubKey], expiry, t2TxId);
        await expect(bridge.connect(senderAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations))
          .to.emit(bridge, 'LogAuthorRemoved')
          .withArgs(newAuthor.t1Address, newAuthor.t2PubKey, t2TxId);

        expect(await bridge.nextAuthorId()).to.equal(nextAuthorId);
        expect(await bridge.numActiveAuthors()).to.equal(activeAuthorsBeforeAddition);
      });
    });

    context('fails when', async () => {
      it('attempting to remove an author who has already been removed', async () => {
        let t2TxId = randomT2TxId();
        let expiry = await getValidExpiry();
        let confirmations = await getConfirmations(bridge, 'addAuthor', [newAuthor.t1PubKey, newAuthor.t2PubKey], expiry, t2TxId);
        await bridge.connect(senderAuthor).addAuthor(newAuthor.t1PubKey, newAuthor.t2PubKey, expiry, t2TxId, confirmations);
        nextAuthorId++;
        t2TxId = randomT2TxId();
        expiry = await getValidExpiry();
        confirmations = await getConfirmations(bridge, 'removeAuthor', [newAuthor.t2PubKey, newAuthor.t1PubKey], expiry, t2TxId);
        await bridge.connect(senderAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations);
        activeAuthors--;
        t2TxId = randomT2TxId();
        expiry = await getValidExpiry();
        confirmations = await getConfirmations(bridge, 'removeAuthor', [newAuthor.t2PubKey, newAuthor.t1PubKey], expiry, t2TxId);
        await expect(
          bridge.connect(senderAuthor).removeAuthor(newAuthor.t2PubKey, newAuthor.t1PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(bridge, 'NotAnAuthor');
      });

      it('author functions are disabled', async () => {
        await bridge.pause();
        const t2TxId = randomT2TxId();
        const expiry = await getValidExpiry();
        const confirmations = await getConfirmations(bridge, 'removeAuthor', [authors[0].t2PubKey, authors[0].t1PubKey], expiry, t2TxId);
        await expect(
          bridge.connect(senderAuthor).removeAuthor(authors[0].t2PubKey, authors[0].t1PubKey, expiry, t2TxId, confirmations)
        ).to.be.revertedWithCustomError(bridge, 'EnforcedPause');
        await bridge.unpause();
      });

      it('an invalid t1PublicKey is passed', async () => {
        const expiry = await getValidExpiry();
        const t2TxId = randomT2TxId();
        const badT1PublicKey = randomHex(17);
        const confirmations = await getConfirmations(bridge, 'removeAuthor', [authors[0].t2PubKey, badT1PublicKey], expiry, t2TxId);
        await expect(bridge.removeAuthor(authors[0].t2PubKey, badT1PublicKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'InvalidT1Key'
        );
      });

      it('the expiry time for the call has passed', async () => {
        const expiry = (await getCurrentBlockTimestamp()) - 1;
        const t2TxId = randomT2TxId();
        const confirmations = await getConfirmations(bridge, 'removeAuthor', [authors[0].t2PubKey, authors[0].t1PubKey], expiry, t2TxId);
        await expect(bridge.removeAuthor(authors[0].t2PubKey, authors[0].t1PubKey, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'WindowExpired'
        );
      });

      it('if it takes the number of authors below the minimum threshold', async () => {
        let authorIndex = (await bridge.numActiveAuthors()) - 1n;

        for (authorIndex; authorIndex >= MIN_AUTHORS; authorIndex--) {
          let expiry = await getValidExpiry();
          let t2TxId = randomT2TxId();
          let t1Key = authors[authorIndex].t1PubKey;
          let t2Key = authors[authorIndex].t2PubKey;
          let confirmations = await getConfirmations(bridge, 'removeAuthor', [t2Key, t1Key], expiry, t2TxId);
          await bridge.connect(senderAuthor).removeAuthor(t2Key, t1Key, expiry, t2TxId, confirmations);
        }

        expiry = await getValidExpiry();
        t2TxId = randomT2TxId();
        t1Key = authors[authorIndex].t1PubKey;
        t2Key = authors[authorIndex].t2PubKey;
        confirmations = await getConfirmations(bridge, 'removeAuthor', [t2Key, t1Key], expiry, t2TxId);
        await expect(bridge.connect(senderAuthor).removeAuthor(t2Key, t1Key, expiry, t2TxId, confirmations)).to.be.revertedWithCustomError(
          bridge,
          'NotEnoughAuthors'
        );
      });
    });
  });

  context('Corroborating T2 tx', async () => {
    let t2TxId, expiry;

    beforeEach(async () => {
      t2TxId = randomT2TxId();
      expiry = await getValidExpiry();
    });

    async function publishRoot() {
      const rootHash = randomBytes32();
      const confirmations = await getConfirmations(bridge, 'publishRoot', rootHash, expiry, t2TxId);
      await bridge.connect(senderAuthor).publishRoot(rootHash, expiry, t2TxId, confirmations);
    }

    it('The correct state is returned for an unsent tx', async () => {
      expect(await bridge.corroborate(t2TxId, expiry)).to.equal(0);
    });

    it('The correct state is returned for a failed tx', async () => {
      await bridge.pause();
      await expect(publishRoot()).to.be.revertedWithCustomError(bridge, 'EnforcedPause');
      await increaseBlockTimestamp(EXPIRY_WINDOW);
      await bridge.unpause();
      expect(await bridge.corroborate(t2TxId, expiry)).to.equal(-1);
    });

    it('The correct state is returned for a successful tx', async () => {
      await publishRoot();
      expect(await bridge.corroborate(t2TxId, expiry)).to.equal(1);
    });
  });
});
