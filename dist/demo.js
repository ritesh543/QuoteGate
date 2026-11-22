export const currencies = ['USD', 'EUR', 'GBP', 'INR', 'IDR', 'SGD', 'CAD', 'AUD'];

export function minorUnits(input) {
  const match = String(input).trim().match(/^(\d{1,11})(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('Enter a positive amount with up to two decimal places.');
  const amount = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  if (amount < 1 || amount > 1e12) throw new Error('Amount is outside the allowed range.');
  return amount;
}

export function money(amount, currency) {
  return new Intl.NumberFormat('en', { style: 'currency', currency, currencyDisplay: 'code',
    maximumFractionDigits: 2, minimumFractionDigits: amount % 100 === 0 ? 0 : 2 }).format(amount / 100);
}

export function verdict(quote, checks) {
  if (!quote.budget_ok || !quote.date_ok || checks.some(row => row.decision === 'EXCLUDED')) return 'OUT_OF_SCOPE';
  if (checks.some(row => row.decision === 'UNCLEAR')) return 'NEEDS_CLARIFICATION';
  return 'FIT';
}

const buyer = 'local-buyer';
const starter = {
  id: 'DEMO-01', title: 'Community workshop print packs', currency: 'USD', budget_minor: 180000,
  deadline: '2027-02-15', buyer,
  requirements: ['Supply 250 printed training packs.', 'Include delivery to the venue.', 'Use 120 gsm cover stock.'],
  quotes: [
    { supplier: 'Cedar Press', price_minor: 158000, delivery_on: '2027-02-11',
      terms: 'We will supply 250 printed training packs. Delivery to the venue is included. All covers will use 120 gsm cover stock.',
      checks: [{id:1,decision:'COVERED',excerpt:'We will supply 250 printed training packs.'},
        {id:2,decision:'COVERED',excerpt:'Delivery to the venue is included.'},
        {id:3,decision:'COVERED',excerpt:'All covers will use 120 gsm cover stock.'}] },
    { supplier: 'Bright Paper', price_minor: 132000, delivery_on: '2027-02-10',
      terms: 'We will supply 250 printed training packs. Delivery to the venue is explicitly excluded. All covers will use 120 gsm cover stock.',
      checks: [{id:1,decision:'COVERED',excerpt:'We will supply 250 printed training packs.'},
        {id:2,decision:'EXCLUDED',excerpt:'Delivery to the venue is explicitly excluded.'},
        {id:3,decision:'COVERED',excerpt:'All covers will use 120 gsm cover stock.'}] },
    { supplier: 'Stack & Stitch', price_minor: 145000, delivery_on: '2027-02-14',
      terms: 'We will supply 250 printed training packs. Delivery to the venue is included. Cover stock specifications are available upon request.',
      checks: [{id:1,decision:'COVERED',excerpt:'We will supply 250 printed training packs.'},
        {id:2,decision:'COVERED',excerpt:'Delivery to the venue is included.'},
        {id:3,decision:'UNCLEAR',excerpt:'Cover stock specifications are available upon request.'}] }
  ]
};

async function sha256(payload) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)));
  return Array.from(bytes, item => item.toString(16).padStart(2, '0')).join('');
}

function newQuote(request, fields) {
  const id = request.id + '-Q' + String(request.quotes.length + 1).padStart(2, '0');
  const quote = { ...fields, id, currency: request.currency, request_id: request.id, issuer: 'local-supplier',
    budget_ok: fields.price_minor <= request.budget_minor, date_ok: fields.delivery_on <= request.deadline,
    shortlisted: false };
  return { ...quote, verdict: fields.checks.length ? verdict(quote, fields.checks) : 'PENDING' };
}

function seed() {
  const request = { ...structuredClone(starter), quotes: [] };
  for (const fields of starter.quotes) request.quotes.push(newQuote(request, structuredClone(fields)));
  return [request];
}

export function createDemoApi(storage = globalThis.localStorage) {
  const key = 'quotegate-demo-v1';
  let requests = seed();
  try {
    const saved = storage?.getItem(key);
    if (saved) requests = JSON.parse(saved);
  } catch { /* Local storage can be unavailable. */ }
  const save = () => { try { storage?.setItem(key, JSON.stringify(requests)); } catch { /* Session remains usable. */ } };
  const request = id => {
    const record = requests.find(item => item.id === id);
    if (!record) throw new Error('Request not found.');
    return record;
  };
  const quote = id => {
    const record = requests.flatMap(item => item.quotes).find(item => item.id === id);
    if (!record) throw new Error('Quote not found.');
    return record;
  };
  return {
    account: buyer,
    async read(method, [id, limit] = []) {
      if (method === 'list_requests') return structuredClone([...requests].reverse().slice(id, id + limit));
      if (method === 'get_request') return structuredClone(request(id));
      if (method === 'get_shortlist_proof') return structuredClone(quote(id).proof);
      throw new Error('Unknown demo read.');
    },
    async write(method, args) {
      if (method === 'open_request') {
        const [title, currency, budget_minor, deadline, requirements] = args;
        requests.push({ id:'DEMO-' + String(requests.length + 1).padStart(2, '0'), title, currency, budget_minor,
          deadline, requirements, quotes: [], buyer });
      } else if (method === 'submit_quote') {
        const [id, supplier, price_minor, delivery_on, terms] = args;
        const record = request(id);
        if (record.quotes.length >= 20) throw new Error('This request already has 20 quotes.');
        record.quotes.push(newQuote(record, {supplier, price_minor, delivery_on, terms, checks: []}));
      } else if (method === 'review_quote') {
        const [id, checks] = args;
        const record = quote(id);
        if (record.verdict !== 'PENDING') throw new Error('This quote has already been reviewed.');
        record.checks = checks;
        record.verdict = verdict(record, checks);
      } else if (method === 'shortlist_quote') {
        const [id] = args;
        const record = quote(id);
        if (record.verdict !== 'FIT' || record.shortlisted) throw new Error('Choose an eligible FIT quote.');
        const rfq = request(record.request_id);
        const payload_json = JSON.stringify({mode:'demo', request_id:rfq.id, quote_id:id, supplier:record.supplier,
          price_minor:record.price_minor, currency:record.currency, delivery_on:record.delivery_on,
          budget_minor:rfq.budget_minor, deadline:rfq.deadline, requirements:rfq.requirements,
          checks:record.checks, verdict:record.verdict});
        record.proof = { payload_json, sha256: await sha256(payload_json) };
        record.shortlisted = true;
      } else {
        throw new Error('Unknown demo write.');
      }
      save();
    }
  };
}

export async function checkProof(proof) {
  return (await sha256(proof.payload_json)) === proof.sha256;
}
