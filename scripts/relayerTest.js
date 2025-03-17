require('dotenv').config();

const URL = 'http://localhost:3000/lift';
const USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const BRIDGE_ADDRESS = '0x5816CEDff9DE7c5FB13dcFb1cE9038014b929b7E';
const ONE_USDC = 1000000;

async function getPermit(usdc, user, amount, provider) {
  const deadline = ethers.MaxUint256;

  const domain = {
    name: await usdc.name(),
    version: await usdc.version(),
    chainId: (await provider.getNetwork()).chainId,
    verifyingContract: USDC_ADDRESS
  };

  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }
    ]
  };

  const message = {
    owner: user.address,
    spender: BRIDGE_ADDRESS,
    value: amount,
    nonce: await usdc.nonces(user.address),
    deadline
  };

  const signature = await user.signTypedData(domain, types, message);
  const { v, r, s } = ethers.Signature.from(signature);
  return { v, r, s };
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_ALCHEMY_OR_INFURA_URL);
  const usdc = new ethers.Contract(USDC_ADDRESS, require('../abi/USDC.js'), provider);
  const user = new ethers.Wallet(process.env.SEPOLIA_DEPLOYER_PRIVATE_KEY, provider);
  const amount = 200 * ONE_USDC;
  const permit = await getPermit(usdc, user, amount, provider);
  const request = { user: user.address, amount, v: permit.v, r: permit.r, s: permit.s };
  const response = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  console.log(await response.json());
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
