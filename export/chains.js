// export/chains.js
require('dotenv').config();

// Unified V2 Etherscan API config for multiple EVM chains
const chains = {
  ethereum: { name: 'Ethereum Mainnet', chainId: 1 },
  arbitrum: { name: 'Arbitrum One',     chainId: 42161 },
  optimism: { name: 'Optimism Mainnet',  chainId: 10 },
  bnb:      { name: 'BNB Smart Chain',  chainId: 56 },
  // add other chains here
};

// Base URL for Etherscan V2 unified API
const baseUrl = 'https://api.etherscan.io/v2/api';
// Single API key for all supported chains
const apiKey = process.env.ETHERSCAN_API_KEY;

module.exports = { baseUrl, apiKey, chains };