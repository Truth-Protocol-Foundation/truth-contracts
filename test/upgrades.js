const { deployTruthToken, expect, getAccounts, init, ONE_HUNDRED_BILLION } = require('./helper.js');
let truth, owner, otherAccount;

describe('Upgrade TruthToken', async () => {
  before(async () => {
    await init(5); // Initialize the test environment
    [owner, otherAccount] = getAccounts(); // Get accounts
    truth = await deployTruthToken(ONE_HUNDRED_BILLION, owner); // Deploy the original TruthToken contract
  });

  context('Upgrading TruthToken', async () => {
    it('should upgrade the contract symbol to TRUU and retain existing state', async () => {
      // Verify the original symbol
      const originalSymbol = await truth.symbol();
      expect(originalSymbol).to.equal('TRU');

      // Verify the total supply remains the same
      const originalTotalSupply = await truth.totalSupply();
      expect(originalTotalSupply).to.equal(ONE_HUNDRED_BILLION * 10n ** 10n);

      // Verify the original owner
      const originalOwner = await truth.owner();
      expect(originalOwner).to.equal(owner.address);

      // Upgrade the contract to TruthTokenUpgrade
      const TruthTokenUpgrade = await ethers.getContractFactory('TruthTokenUpgrade');
      const upgradedToken = await upgrades.upgradeProxy(truth.address, TruthTokenUpgrade);

      // Verify the new symbol after upgrade
      const newSymbol = await upgradedToken.symbol();
      expect(newSymbol).to.equal('TRUU');

      // Verify the total supply remains the same
      const totalSupply = await upgradedToken.totalSupply();
      expect(totalSupply).to.equal(ONE_HUNDRED_BILLION * 10n ** 10n);

      // Verify the owner remains the same
      const newOwner = await upgradedToken.owner();
      expect(newOwner).to.equal(owner.address);

      // Verify new functionality
      const newFunctionResult = await upgradedToken.newFunction();
      expect(newFunctionResult).to.equal('TruthToken upgraded');
    });

    it('should fail to upgrade if the caller is not the owner', async () => {
      const TruthTokenUpgrade = await ethers.getContractFactory('TruthTokenUpgrade');
      const newToken = await TruthTokenUpgrade.deploy();

      // Attempt to upgrade the contract with a non-owner account
      await expect(truth.connect(otherAccount).upgradeToAndCall(await newToken.getAddress(), '0x')).to.be.revertedWithCustomError(
        truth,
        'OwnableUnauthorizedAccount'
      );
    });
  });
});
