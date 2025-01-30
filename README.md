# Contracts

## 1. Truth Token (`$TRUTH`)
- Standard [ERC-20](https://eips.ethereum.org/EIPS/eip-20) token with a total supply of 100,000,000,000 tokens of 10 decimals.
- Extended to include [ERC-2612](https://eips.ethereum.org/EIPS/eip-2612) permit-based approvals.
- Upgradeable.


## 2. Truth Bridge
- Bridging contract connecting Ethereum with, and secured by, the Truth Network (TN).
- Handles:
  - Adding, activating and removing authors (TN block creators) by author consensus.
  - Periodically checkpointing TN transactions (summarised as Merkle roots) by author consensus.
  - The movement of ERC20 tokens between Ethereum and TN by:
    - **Lifting** - Locking received tokens in the contract and authorising their re-creation in the specified TN recipient account.
    - **Lowering** - Unlocking and transferring tokens to the Ethereum recipient specified in the proof of the tokens' destruction on the TN.
- Upgradeable.

# Development

## Setup
- do `npm i`
- ensure `authors.json` includes the correct authors for the network
- Create a `.env` file with the following entries:
```
MAINNET_ALCHEMY_OR_INFURA_URL
SEPOLIA_ALCHEMY_OR_INFURA_URL
SEPOLIA_DEPLOYER_PRIVATE_KEY
ETHERSCAN_API_KEY
LEDGER_MAINNET_DEPLOYER_ADDRESS
```

### Format the code
`npm run format`

### Run tests (includes gas report)
`npm run test`

### Run coverage
`npm run coverage`

### Check contract sizes
`npx hardhat size-contracts`

### Deploy Truth Token
`npx hardhat --network <network> deploy token`

### Upgrade Truth Token
`npx hardhat --network <network> upgrade token <token address>`

### Deploy Truth Bridge
`npx hardhat --network <network> deploy bridge <token address>`

### Upgrade Truth Bridge
`npx hardhat --network <network> upgrade bridge <bridge address>`
