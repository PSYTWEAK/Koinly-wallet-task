require('dotenv').config();
const axios = require('axios');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const path = require('path');
const { baseUrl, apiKey, chains } = require('./chains');

// CONFIG
const walletAddress = '0xf23649b5DF0E12BA04c6fa1874B03265f79C636B';
const PAGE_SIZE = 10000;

// Generic pagination for any Etherscan V2 endpoint
async function fetchPaginated(chainId, moduleParam, actionParam, address) {
  let page = 1;
  const all = [];
  while (true) {
    const resp = await axios.get(baseUrl, {
      params: {
        chainid: chainId,
        module: moduleParam,
        action: actionParam,
        address,
        startblock: 0,
        endblock: 'latest',
        page,
        offset: PAGE_SIZE,
        sort: 'asc',
        apikey: apiKey,
      }
    });
    const { status, result } = resp.data;
    if (status !== '1' || !Array.isArray(result) || result.length === 0) break;
    all.push(...result);
    if (result.length < PAGE_SIZE) break;
    page += 1;
  }
  return all;
}

// Fetch ETH, internal ETH, and ERC-20 token events for one chain
async function fetchEvents(cfg, address) {
  const [ethTxs, internalTxs, tokenTxs] = await Promise.all([
    fetchPaginated(cfg.chainId, 'account', 'txlist', address),
    fetchPaginated(cfg.chainId, 'account', 'txlistinternal', address),
    fetchPaginated(cfg.chainId, 'account', 'tokentx', address)
  ]);

  const records = [];

  // Normalize ETH transactions
  ethTxs.concat(internalTxs).forEach(tx => {
    const isSender = tx.from.toLowerCase() === address.toLowerCase();
    const gasUsed = Number(tx.gasUsed || 0);
    const gasPrice = Number(tx.gasPrice || 0);
    const gasCostEth = isSender ? (gasUsed * gasPrice) / 1e18 : 0;
  
    // Add failed txs with 0 value, but keep the gas cost
    const isFailed = tx.isError === '1';
  
    records.push({
      hash: tx.hash,
      timestamp: Number(tx.timeStamp),
      chain: cfg.name,
      asset: 'ETH',
      tokenName: 'Ether',
      direction: isSender ? 'send' : 'receive',
      from: tx.from,
      to: tx.to,
      value: isFailed ? 0 : Number(tx.value) / 1e18,
      blockNumber: Number(tx.blockNumber),
      gasCost: gasCostEth.toFixed(8)
    });
  });
  

  // Normalize token transactions
  tokenTxs.forEach(tx => {
    records.push({
      hash: tx.hash,
      timestamp: Number(tx.timeStamp),
      chain: cfg.name,
      asset: tx.tokenSymbol,
      tokenName: tx.tokenName,
      direction: tx.from.toLowerCase() === address.toLowerCase() ? 'send' : 'receive',
      from: tx.from,
      to: tx.to,
      value: Number(tx.value) / (10 ** tx.tokenDecimal),
      blockNumber: Number(tx.blockNumber),
      gasCost: ''
    });
  });

  // Sort chronologically
  return records.sort((a, b) => a.timestamp - b.timestamp || a.blockNumber - b.blockNumber);
}

// Export all chains to CSV
async function exportAll() {
  const outDir = path.join(__dirname, '..', 'exportedTransactions');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [key, cfg] of Object.entries(chains)) {
    try {
      const events = await fetchEvents(cfg, walletAddress);
      if (!events.length) {
        console.log(`No events for ${key}`);
        continue;
      }

      const csvWriter = createObjectCsvWriter({
        path: path.join(outDir, `${key}-ledger.csv`),
        header: [
          { id: 'hash',        title: 'TxHash'       },
          { id: 'timestamp',   title: 'Timestamp'    },
          { id: 'chain',       title: 'Chain'        },
          { id: 'asset',       title: 'Asset'        },
          { id: 'tokenName',   title: 'TokenName'    },
          { id: 'direction',   title: 'Direction'    },
          { id: 'from',        title: 'From'         },
          { id: 'to',          title: 'To'           },
          { id: 'value',       title: 'Value'        },
          { id: 'blockNumber', title: 'BlockNumber'  },
          { id: 'gasCost',     title: 'GasCost'      }
        ]
      });

      await csvWriter.writeRecords(events);
      console.log(`✅ ${key}: exported ${events.length} events`);
    } catch (err) {
      console.error(`❌ ${key}:`, err.message);
    }
  }
}

exportAll();