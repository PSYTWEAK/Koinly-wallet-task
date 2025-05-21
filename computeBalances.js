const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');

const dir = path.join(__dirname, 'exportedTransactions');
const files = fs.readdirSync(dir).filter(f => f.endsWith('-ledger.csv'));

const balances = {};
const OUR_ADDRESS = '0xf23649b5df0e12ba04c6fa1874b03265f79c636b';

function processFile(file) {
  return new Promise((resolve, reject) => {
    const chain = file.replace('-ledger.csv', '');
    fs.createReadStream(path.join(dir, file))
      .pipe(csv())
      .on('data', row => {
        try {
          const direction = row.Direction?.trim().toLowerCase();
          const from = row.From?.toLowerCase();
          const to = row.To?.toLowerCase();
          const token = row.TokenName?.trim() || row.Asset?.trim() || 'UNKNOWN';
          if (/[!#$]/.test(token)) return;
          const label = `${token} (${capitalize(chain)})`;
          const val = parseFloat(row.Value);
          const gas = parseFloat(row.GasCost || 0);

          if (!direction || isNaN(val)) {
            console.warn(`⚠️ Skipping invalid row in ${file}:`, row);
            return;
          }

          if (direction === 'receive' && to === OUR_ADDRESS) {
            balances[label] = (balances[label] || 0) + val;
          } else if (direction === 'send' && from === OUR_ADDRESS) {
            const totalCost = token === 'Ether' ? val + gas : val;
            balances[label] = (balances[label] || 0) - totalCost;
          }
        } catch (err) {
          console.warn(`⚠️ Error processing row in ${file}:`, row, err);
        }
      })
      .on('end', () => {
        console.log(`✅ Processed ${file}`);
        resolve();
      })
      .on('error', reject);
  });
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function compute() {
  await Promise.all(files.map(processFile));

  console.log('\n📊 Final Balances:\n');

  const filtered = Object.entries(balances)
    .filter(([token, amount]) => Math.abs(amount) >= 0.0001 && !/[!#$]/.test(token));

  const etherEntries = filtered.filter(([token]) => token.startsWith('Ether '))
    .sort(([, aAmt], [, bAmt]) => Math.abs(bAmt) - Math.abs(aAmt));
  const others = filtered.filter(([token]) => !token.startsWith('Ether '))
    .sort(([, aAmt], [, bAmt]) => Math.abs(bAmt) - Math.abs(aAmt));

  const sorted = [...etherEntries, ...others];

  sorted.forEach(([token, amount]) => {
    console.log(`${token}: ${amount.toFixed(6)}`);
  });

  const writer = createObjectCsvWriter({
    path: path.join(__dirname, 'final-balances.csv'),
    header: [
      { id: 'token', title: 'Token' },
      { id: 'amount', title: 'Amount' },
    ]
  });

  const rows = sorted.map(([token, amount]) => ({
    token,
    amount: amount.toFixed(6)
  }));

  await writer.writeRecords(rows);
  console.log('\n💾 Saved to final-balances.csv');
}

compute();
