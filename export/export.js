require('dotenv').config();
const axios = require('axios');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const path = require('path');
const { parseUnits, formatUnits } = require('ethers');
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
    const gasUsed = BigInt(tx.gasUsed || '0');
    const gasPrice = BigInt(tx.gasPrice || '0');
    const gasCostWei = gasUsed * gasPrice;
    const gasCostEth = isSender ? formatUnits(gasCostWei, 18) : '0.000000000000000000';

    const isFailed = tx.isError === '1';
    const rawValue = isFailed ? '0' : tx.value;

    const valueEth = formatUnits(BigInt(rawValue), 18);

    records.push({
      hash: tx.hash,
      timestamp: Number(tx.timeStamp),
      chain: cfg.name,
      asset: 'ETH',
      tokenName: 'Ether',
      direction: isSender ? 'send' : 'receive',
      from: tx.from,
      to: tx.to,
      value: valueEth,
      blockNumber: Number(tx.blockNumber),
      gasCost: gasCostEth
    });
  });

  // Normalize token transactions
  tokenTxs.forEach(tx => {
    const rawValue = typeof tx.value === 'string' ? tx.value : tx.value.toString();
    const decimals = parseInt(tx.tokenDecimal || '18', 10);
    const wei = BigInt(rawValue);
    const formatted = formatUnits(wei, decimals);

    records.push({
      hash: tx.hash,
      timestamp: Number(tx.timeStamp),
      chain: cfg.name,
      asset: tx.tokenSymbol,
      tokenName: tx.tokenName,
      direction: tx.from.toLowerCase() === address.toLowerCase() ? 'send' : 'receive',
      from: tx.from,
      to: tx.to,
      value: formatted,
      blockNumber: Number(tx.blockNumber),
      gasCost: ''
    });
  });

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
