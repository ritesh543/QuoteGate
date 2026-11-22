import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createAccount, createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
import { receiptSucceeded } from '../src/studionet.js';

const account = createAccount();
const client = createClient({ chain: studionet, account });
const reader = createClient({ chain: studionet });
const chainId = await reader.getChainId();
if (chainId !== 61999) throw new Error('Unexpected chain ID ' + chainId);

const code = await readFile('contracts/quote_gate.py', 'utf8');
const digest = source => createHash('sha256').update(source).digest('hex');
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const zeroAddress = '0x' + '0'.repeat(40);
const explorer = 'https://explorer-studio.genlayer.com';
const checkpoint = 'verification/deployment.json';

let previous;
try { previous = JSON.parse(await readFile(checkpoint, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (previous?.transaction_hash) {
  throw new Error('A deployment was already submitted. Verify its recorded transaction before sending another.');
}

async function finalReceipt(hash) {
  for (let attempt = 0; attempt < 74; attempt += 1) {
    let tx;
    try { tx = await reader.getTransaction({ hash }); } catch { /* The receipt may be propagating. */ }
    if (tx?.statusName === 'FINALIZED') {
      if (!receiptSucceeded(tx)) throw new Error('GenVM execution failed for ' + hash);
      return tx;
    }
    await delay(2500);
  }
  throw new Error('Finalization timed out. Inspect ' + explorer + '/tx/' + hash);
}

const schema = await reader.getContractSchemaForCode(code);
const methods = Object.keys(schema.methods ?? {});
if (!methods.includes('get_overview') || !methods.includes('review_quote')) {
  throw new Error('StudioNet schema preflight did not recognize the contract interface.');
}
await writeFile('verification/contract-schema.json', JSON.stringify(schema, null, 2) + '\n');
console.log('StudioNet schema preflight passed with', methods.length, 'methods');

const hash = await client.deployContract({ code, args: [], leaderOnly: false });
let evidence = {
  network: 'StudioNet', chain_id: chainId, contract: 'QuoteGate',
  source: 'contracts/quote_gate.py', source_sha256: digest(code),
  deployer: account.address, transaction_hash: hash, status: 'SUBMITTED',
  transaction_explorer: explorer + '/tx/' + hash
};
const save = () => writeFile(checkpoint, JSON.stringify(evidence, null, 2) + '\n');
await save();
console.log('Deployment submitted', hash);

const receipt = await finalReceipt(hash);
const possibleAddresses = [receipt.to_address, receipt.contract_address, receipt.to, receipt.recipient,
  receipt.data?.contract_address, receipt.data?.contractAddress];
const address = possibleAddresses.find(candidate => typeof candidate === 'string' &&
  addressPattern.test(candidate) && candidate.toLowerCase() !== zeroAddress);
if (!address) {
  console.log('Receipt address fields', Object.keys(receipt), Object.keys(receipt.data ?? {}));
  throw new Error('Could not locate the deployed contract address in the receipt.');
}

const read = (functionName, args = []) => reader.readContract({
  address, functionName, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL
});
const published = await reader.getContractCode(address);
if (digest(published) !== evidence.source_sha256) throw new Error('Deployed source differs from the local contract.');
const overview = await read('get_overview');
evidence = { ...evidence, address, status: 'FINALIZED', execution: 'SUCCESS',
  contract_explorer: explorer + '/address/' + address, source_matches: true,
  get_overview: overview, smoke_transactions: [] };
await save();
console.log('Deployment verified', address, JSON.stringify(overview));

if (process.argv.includes('--smoke')) {
  const write = async (functionName, args) => {
    const tx = await client.writeContract({ address, functionName, args, value: 0n, leaderOnly: false });
    evidence.smoke_transactions.push({ method: functionName, hash: tx, status: 'SUBMITTED',
      explorer: explorer + '/tx/' + tx });
    await save();
    console.log(functionName, 'submitted', tx);
    await finalReceipt(tx);
    Object.assign(evidence.smoke_transactions.at(-1), { status: 'FINALIZED', execution: 'SUCCESS' });
    await save();
    console.log(functionName, 'finalized');
  };
  await write('open_request', ['Community workshop print packs', 'USD', 180000n, '2027-02-15',
    ['Supply 250 printed training packs.', 'Include delivery to the venue.', 'Use 120 gsm cover stock.']]);
  const [request] = await read('list_requests', [0, 1]);
  await write('submit_quote', [request.id, 'Cedar Press (sample)', 158000n, '2027-02-11',
    'We will supply 250 printed training packs. Delivery to the venue is included. All covers will use 120 gsm cover stock.']);
  await write('submit_quote', [request.id, 'Bright Paper (sample)', 132000n, '2027-02-10',
    'We will supply 250 printed training packs. Delivery to the venue is explicitly excluded. All covers will use 120 gsm cover stock.']);
  let detail = await read('get_request', [request.id]);
  for (const quote of detail.quotes) await write('review_quote', [quote.id]);
  detail = await read('get_request', [request.id]);
  evidence.smoke_reviews = detail.quotes.map(({ id, verdict, checks, budget_ok, date_ok }) =>
    ({ id, verdict, checks, budget_ok, date_ok }));
  await save();
  const [good, blocked] = detail.quotes;
  if (good.verdict !== 'FIT' || blocked.verdict !== 'OUT_OF_SCOPE' || blocked.checks[1].decision !== 'EXCLUDED') {
    throw new Error('Positive and exclusion reviews did not settle to the expected exact outcomes.');
  }
  await write('shortlist_quote', [good.id]);
  const proof = await read('get_shortlist_proof', [good.id]);
  if (digest(proof.payload_json) !== proof.sha256) throw new Error('Shortlist proof hash mismatch');
  evidence.smoke_shortlist = { request_id: request.id, quote_id: good.id, sha256: proof.sha256 };
  await save();
  console.log('Shortlist proof verified', proof.sha256);
}
