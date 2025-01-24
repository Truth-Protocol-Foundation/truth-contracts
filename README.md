# Contracts

## Truth Token (`$TRUTH`)
Upgradeable ERC20 token with a total supply of 100,000,000,000 tokens of 10 decimals.\
Extended to include ERC-2612 permit-based approvals.


## Truth Bridge
Upgradeable bridging contract connecting the Truth Network with Ethereum.

### Functionality

#### Author Management
The addition, activation and removal of authors (TN block creators) by author consensus.

#### Root publishing
The periodic checkpointing of TN transactions (summarised as Merkle roots) by author consensus.

#### Bridging funds
The movement of ERC20 tokens between Ethereum and Truth Network by:
   - **Lifting** - Locking tokens in the contract before authorising their re-creation in the specified TN recipient account.
   - **Lowering** - Unlocking tokens and transferring them to the Ethereum recipient specified in the tokens' proof of destruction on the TN.


# Development

## Setup
- do `npm i`
- Create a `.env` file with the following entries:
```
MAINNET_ALCHEMY_OR_INFURA_URL
SEPOLIA_ALCHEMY_OR_INFURA_URL
SEPOLIA_DEPLOYER_PRIVATE_KEY
ETHERSCAN_API_KEY
```
- ensure `authors.json` includes the correct authors for the environment

### Format the code
`npm run format`

### Run tests
`npm run test`

### Run coverage
`npm run coverage`

### Check contract sizes
`npx hardhat size-contracts`

### Deploy Truth Token
`npx hardhat --network <network> deploy token`

### Upgrade Truth Token
`npx hardhat --network <network> upgrade token <contract address>`

### Deploy Truth Bridge
`npx hardhat --network <network> deploy bridge`

### Upgrade Truth Bridge
`npx hardhat --network <network> upgrade bridge <contract address>`
