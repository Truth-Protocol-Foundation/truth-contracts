# Contracts

| Contract | Network | Environment | Address |
|----------|---------|-------------|---------|
| Truth Token | Mainnet | Production | [0xDAe0faFD65385E7775Cf75b1398735155EF6aCD2](https://etherscan.io/address/0xDAe0faFD65385E7775Cf75b1398735155EF6aCD2#readProxyContract) |
| Truth Bridge | Mainnet | Production | [0x50c02710b06d6AdDb864D6b038010eF6fA1BCd92](https://etherscan.io/address/0x50c02710b06d6AdDb864D6b038010eF6fA1BCd92#readProxyContract) | 
| Truth Token | Sepolia | Development | [0x25560bD4FD693922450D99188Fab23472e59015F](https://sepolia.etherscan.io/address/0x25560bD4FD693922450D99188Fab23472e59015F#readProxyContract) |
| Truth Bridge | Sepolia | Development | [0x5816CEDff9DE7c5FB13dcFb1cE9038014b929b7E](https://sepolia.etherscan.io/address/0x5816CEDff9DE7c5FB13dcFb1cE9038014b929b7E#readProxyContract) |
| Truth Token | Sepolia | Public Testnet | [0x6cAEfA7446E967018330cCeC5BA7A43956a45137](https://sepolia.etherscan.io/address/0x6cAEfA7446E967018330cCeC5BA7A43956a45137#readProxyContract) |
| Truth Bridge | Sepolia | Public Testnet | [0xad36dB955A0C881A78842eE1C8e848a7238637e8](https://sepolia.etherscan.io/address/0xad36dB955A0C881A78842eE1C8e848a7238637e8#readProxyContract) |


## 1. Truth Token (`TRUU`)
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
  - "Gasless" lifting via relayers (USDC only).
  - Management of relayers.
- Upgradeable.

## Lift Methods

| Method                        | Approval Tx Required? | Callable By | T2 Account Specified As         |
|-------------------------------|-----------------------|-------------|---------------------------------|
| **lift**                      | Yes                   | Lifter      | `bytes`                         |
| **permitLift**                | No                    | Lifter      | `bytes32`                       |
| **predictionMarketLift**      | Yes                   | Lifter      | Derived from lifter ETH address |
| **predictionMarketPermitLift**| No                    | Lifter      | Derived from lifter ETH address |
| **predictionMarketProxyLift** | No                    | Anyone      | Derived from lifter ETH address |


# Development

## Setup
- do `npm i`

#### Format the code
`npm run format`

#### Run mainnet tests
`npm run tests`

#### Run sepolia tests
`npm run tests-s`

#### Run coverage
`npm run coverage`

#### Check contract sizes
`npx hardhat size-contracts`

## Deployment

### Setup
- ensure `authors.json` includes the correct authors for the network
- Create a `.env` file with the following entries as required:
```
ETHERSCAN_API_KEY

SEPOLIA_ALCHEMY_OR_INFURA_URL
SEPOLIA_DEPLOYER_PRIVATE_KEY (or SEPOLIA_DEPLOYER_LEDGER_ADDRESS)

MAINNET_ALCHEMY_OR_INFURA_URL
MAINNET_DEPLOYER_PRIVATE_KEY (or MAINNET_DEPLOYER_LEDGER_ADDRESS)
```
Note: when deploying on mainnet the contract `--owner` address must be specified (optional on Sepolia, owner defaults to the deployer account)

#### Deploy Truth Token
`npx hardhat deploy token [--owner owner_address] --network <network>`

#### Validate Truth Token Implementation
`npx hardhat validate token <token_address> --network <network>`

#### Upgrade Truth Token
`npx hardhat upgrade token <token_address> --network <network>`

#### Deploy Truth Token Implementation
`npx hardhat implementation token --network <network>`

#### Update Truth Token Manifest
`npx hardhat manifest token <token_address> --network <network>`

#### Deploy Truth Bridge
`npx hardhat deploy bridge --token <token_address> [--owner owner_address] --network <network> --env <environment name>`

#### Validate Truth Bridge Implementation
`npx hardhat validate bridge <bridge_address> --network <network>`

#### Upgrade Truth Bridge
`npx hardhat upgrade bridge <bridge_address> --network <network>`

#### Deploy Truth Bridge Implementation
`npx hardhat implementation bridge --network <network>`

#### Update Truth Bridge Manifest
`npx hardhat manifest bridge <bridge_address> --network <network>`
