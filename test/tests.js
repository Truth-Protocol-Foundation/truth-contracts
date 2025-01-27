const { accounts, deployTruthBridge, deployTruthToken, getPermit, init } = require('./helper.js');

let bridge, truth, owner, user1;

describe('Tests', async () => {
  it('test', async () => {
    await init(5);
    [owner, user1] = accounts();
    truth = await deployTruthToken();
    bridge = await deployTruthBridge(truth);

    await truth.connect(owner).transfer(user1.address, 100000000000n);

    const t2PubKey = await bridge.deriveT2PublicKey(user1.address);
    const amount = 100000n;

    await truth.connect(user1).approve(bridge.address, amount);
    await bridge.connect(user1).lift(truth.address, t2PubKey, amount);

    await truth.connect(user1).approve(bridge.address, amount);
    await bridge.connect(user1).liftToPredictionMarket(truth.address, amount);

    const liftPermit = await getPermit(truth, user1, bridge, amount);
    await bridge.connect(user1).lift(truth.address, t2PubKey, amount, liftPermit.deadline, liftPermit.v, liftPermit.r, liftPermit.s);

    const lift2PMPermit = await getPermit(truth, user1, bridge, amount);
    await bridge.connect(user1).liftToPredictionMarket(truth.address, amount, lift2PMPermit.deadline, lift2PMPermit.v, lift2PMPermit.r, lift2PMPermit.s);

    console.log(await truth.totalSupply());
  });
});
