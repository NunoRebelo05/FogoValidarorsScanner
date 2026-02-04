const express = require('express');
const path = require('path');
const app = express();

const RPC = 'https://mainnet.fogo.io';
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const FEE_PER_TX = 0.000005;

// In-memory cache for tx scans: { votePubkey: { months: { 'YYYY-MM': { transactions, count, amount } }, done, lastSig } }
const txCache = {};

function getMonthKey(blockTime) {
  if (!blockTime) return 'unknown';
  const d = new Date(blockTime * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function toBase58(bytes) {
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let encoded = '';
  while (num > 0n) {
    encoded = ALPHABET[Number(num % 58n)] + encoded;
    num = num / 58n;
  }
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) encoded = '1' + encoded;
  return encoded || '1';
}

async function rpcCall(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return res.json();
}

function parseConfigAccounts(accounts) {
  const entries = [];
  for (const r of accounts) {
    const buf = Buffer.from(r.account.data[0], 'base64');
    const str = buf.toString('utf8');
    const match = str.match(/\{[^{}]*\}/);
    if (!match) continue;
    try {
      const info = JSON.parse(match[0]);
      const numKeys = buf.readUInt16LE(0);
      if (numKeys < 2) continue;
      const identity = toBase58(buf.slice(2 + 33, 2 + 33 + 32));
      entries.push({
        configPubkey: r.pubkey, identity,
        name: info.name || null, iconUrl: info.iconUrl || null,
        website: info.website || null, details: info.details || null
      });
    } catch (e) {}
  }
  return entries;
}

function matchValidatorsToInfo(validators, configEntries) {
  const byName = {};
  for (const e of configEntries) { if (e.name && !byName[e.name]) byName[e.name] = e; }
  const byIdentity = {};
  for (const e of configEntries) { byIdentity[e.identity] = e; }

  const prefixRules = [
    { prefix: 'Fogee', name: 'Fogees Hub' },
    { prefix: 'H1KAR', name: 'Hikari' },
    { prefix: 'xL', name: 'xLabs' },
    { prefix: 'ARi', name: 'Asymmetric Research' },
    { prefix: 'FLX', name: 'Kairos Research X Firstset' },
    { prefix: 'FLV', name: 'Kairos Research X Firstset' },
  ];

  return validators.map(v => {
    let meta = byIdentity[v.nodePubkey];
    if (!meta) {
      for (const rule of prefixRules) {
        if (v.nodePubkey.startsWith(rule.prefix) || v.votePubkey.startsWith(rule.prefix)) {
          meta = byName[rule.name]; break;
        }
      }
    }
    return {
      votePubkey: v.votePubkey, nodePubkey: v.nodePubkey,
      activatedStake: v.activatedStake, commission: v.commission,
      lastVote: v.lastVote, rootSlot: v.rootSlot, epochCredits: v.epochCredits,
      active: v.active,
      name: meta?.name || null, iconUrl: meta?.iconUrl || null,
      website: meta?.website || null, details: meta?.details || null
    };
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/rpc', async (req, res) => {
  try {
    const response = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    res.json(await response.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/validators', async (req, res) => {
  try {
    const [voteRes, configRes] = await Promise.all([
      rpcCall('getVoteAccounts'),
      rpcCall('getProgramAccounts', ['Config1111111111111111111111111111111111111', { encoding: 'base64' }])
    ]);
    const configEntries = parseConfigAccounts(configRes.result || []);
    const voteResult = voteRes.result;
    const validators = [
      ...voteResult.current.map(v => ({ ...v, active: true })),
      ...voteResult.delinquent.map(v => ({ ...v, active: false }))
    ];
    validators.sort((a, b) => Number(b.activatedStake) - Number(a.activatedStake));
    res.json(matchValidatorsToInfo(validators, configEntries));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get cache status for a validator (monthly breakdown)
app.get('/api/tx-cache/:votePubkey', (req, res) => {
  const cached = txCache[req.params.votePubkey];
  if (!cached) return res.json({ cached: false });
  res.json({
    cached: true,
    months: cached.months,
    done: cached.done
  });
});

// SSE scan by month - streams monthly summaries as they're discovered
app.get('/api/tx-scan/:votePubkey', async (req, res) => {
  const { votePubkey } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    // Initialize or resume from cache
    if (!txCache[votePubkey]) {
      txCache[votePubkey] = { months: {}, done: false, lastSig: null };
    }
    const cache = txCache[votePubkey];

    // If already done, send cached data immediately
    if (cache.done) {
      res.write('data: ' + JSON.stringify({
        type: 'cached',
        months: cache.months,
        done: true
      }) + '\n\n');
      res.end();
      return;
    }

    // If we have partial data, send it first
    if (Object.keys(cache.months).length > 0) {
      res.write('data: ' + JSON.stringify({
        type: 'cached',
        months: cache.months,
        done: false
      }) + '\n\n');
    }

    // Resume scanning from where we left off
    let before = cache.lastSig || undefined;
    let scanning = true;
    let batchNum = 0;

    while (scanning) {
      const opts = { limit: 1000 };
      if (before) opts.before = before;
      const sigRes = await rpcCall('getSignaturesForAddress', [votePubkey, opts]);
      const sigs = sigRes.result || [];
      if (sigs.length === 0) { scanning = false; break; }

      // Group by month
      for (const s of sigs) {
        const monthKey = getMonthKey(s.blockTime);
        if (!cache.months[monthKey]) {
          cache.months[monthKey] = { transactions: [], count: 0, amount: 0 };
        }
        cache.months[monthKey].transactions.push({
          signature: s.signature, slot: s.slot, blockTime: s.blockTime, err: s.err
        });
        if (!s.err) {
          cache.months[monthKey].count++;
          cache.months[monthKey].amount += FEE_PER_TX;
        }
      }

      before = sigs[sigs.length - 1].signature;
      cache.lastSig = before;
      batchNum++;

      const isDone = sigs.length < 1000;

      // Send updated monthly summary
      const monthsSummary = {};
      for (const [k, v] of Object.entries(cache.months)) {
        monthsSummary[k] = { count: v.count, amount: v.amount };
      }

      res.write('data: ' + JSON.stringify({
        type: 'batch',
        batchNum,
        months: monthsSummary,
        done: isDone
      }) + '\n\n');

      if (isDone) { scanning = false; cache.done = true; }
    }

    // Final done message
    if (!cache.done) cache.done = true;

    const monthsSummary = {};
    for (const [k, v] of Object.entries(cache.months)) {
      monthsSummary[k] = { count: v.count, amount: v.amount };
    }

    res.write('data: ' + JSON.stringify({
      type: 'done',
      months: monthsSummary
    }) + '\n\n');

    res.end();
  } catch (e) {
    res.write('data: ' + JSON.stringify({ type: 'error', message: e.message }) + '\n\n');
    res.end();
  }
});

// Get transactions for a specific month
app.get('/api/tx-month/:votePubkey/:monthKey', (req, res) => {
  const { votePubkey, monthKey } = req.params;
  const cached = txCache[votePubkey];
  if (!cached || !cached.months[monthKey]) {
    return res.json({ transactions: [] });
  }
  res.json({ transactions: cached.months[monthKey].transactions });
});

// Fetch full details for a batch of transactions by signature
app.post('/api/tx-details', async (req, res) => {
  try {
    const { signatures } = req.body;
    if (!signatures || !Array.isArray(signatures) || signatures.length === 0) {
      return res.json([]);
    }

    const allResults = [];
    for (let i = 0; i < signatures.length; i += 20) {
      const batch = signatures.slice(i, i + 20);
      const results = await Promise.all(
        batch.map(sig =>
          rpcCall('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }])
        )
      );
      allResults.push(...results);
    }

    const detailed = signatures.map((sig, i) => {
      const tx = allResults[i]?.result;
      let amount = 0, fee = 0, instructions = [];
      if (tx) {
        fee = (tx.meta?.fee || 0) / 1e9;
        const preBalances = tx.meta?.preBalances || [];
        const postBalances = tx.meta?.postBalances || [];
        let totalMoved = 0;
        for (let j = 0; j < preBalances.length; j++) {
          const diff = (postBalances[j] || 0) - (preBalances[j] || 0);
          if (diff > 0) totalMoved += diff;
        }
        amount = totalMoved / 1e9;
        if (amount === 0) amount = fee;

        const ixs = tx.transaction?.message?.instructions || [];
        instructions = ixs.map(ix => {
          if (ix.parsed?.type) return ix.parsed.type;
          if (ix.program) return ix.program;
          const pid = ix.programId || '';
          if (pid === 'Vote111111111111111111111111111111111111111') return 'vote';
          if (pid === '11111111111111111111111111111111') return 'system';
          if (pid === 'Stake11111111111111111111111111111111111111') return 'stake';
          return pid.slice(0, 8) + '...';
        });
        const innerIxs = tx.meta?.innerInstructions || [];
        for (const inner of innerIxs) {
          for (const ix of inner.instructions || []) {
            if (ix.parsed?.type && !instructions.includes(ix.parsed.type)) instructions.push(ix.parsed.type);
          }
        }
      }
      return { signature: sig, amount, fee, instructions };
    });

    res.json(detailed);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = 3000;
const server = app.listen(PORT, () => {
  console.log(`Fogo Explorer running at http://localhost:${PORT}`);
});

module.exports = server;
