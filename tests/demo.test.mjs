import assert from 'node:assert/strict';
import test from 'node:test';
import { checkProof, createDemoApi, minorUnits, verdict } from '../dist/demo.js';

test('amount parsing keeps exact minor units and rejects overprecision', () => {
  assert.equal(minorUnits('1599.09'), 159909);
  assert.equal(minorUnits('0.01'), 1);
  for (const input of ['0', '1.001', '2e3', '-20', '10000000000.01']) {
    assert.throws(() => minorUnits(input));
  }
});

test('a budget or date miss overrides complete scope', () => {
  const covered = [{ decision:'COVERED' }];
  assert.equal(verdict({budget_ok:false,date_ok:true},covered),'OUT_OF_SCOPE');
  assert.equal(verdict({budget_ok:true,date_ok:false},covered),'OUT_OF_SCOPE');
  assert.equal(verdict({budget_ok:true,date_ok:true},[{decision:'UNCLEAR'}]),'NEEDS_CLARIFICATION');
});

test('demo shortlist hashes the reviewed snapshot and rejects excluded quotes', async () => {
  const demo = createDemoApi(null);
  const [request] = await demo.read('list_requests',[0,12]);
  const [fit, excluded] = request.quotes;
  assert.equal(fit.verdict,'FIT');
  assert.equal(excluded.verdict,'OUT_OF_SCOPE');
  await assert.rejects(demo.write('shortlist_quote',[excluded.id]));
  await demo.write('shortlist_quote',[fit.id]);
  const proof = await demo.read('get_shortlist_proof',[fit.id]);
  assert.equal(await checkProof(proof), true);
  assert.equal(await checkProof({...proof,payload_json:proof.payload_json + ' '}),false);
  await assert.rejects(demo.write('shortlist_quote',[fit.id]));
});

test('new demo request goes from pending quote through manual review', async () => {
  const demo = createDemoApi(null);
  await demo.write('open_request',['Workshop folders','USD',20000,'2027-02-15',['Include delivery.']]);
  const [request] = await demo.read('list_requests',[0,12]);
  await demo.write('submit_quote',[request.id,'Sample vendor',16000,'2027-02-14','Paper folders. Delivery terms on request.']);
  let [quote] = (await demo.read('get_request',[request.id])).quotes;
  assert.equal(quote.verdict,'PENDING');
  await demo.write('review_quote',[quote.id,[{id:1,decision:'UNCLEAR',excerpt:'Delivery terms on request.'}]]);
  [quote] = (await demo.read('get_request',[request.id])).quotes;
  assert.equal(quote.verdict,'NEEDS_CLARIFICATION');
});
