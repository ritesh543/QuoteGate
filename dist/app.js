import { createStudioApi } from './assets/studionet.js';
import { contract } from './config.js';
import { createDemoApi, currencies, minorUnits, money, checkProof } from './demo.js';

const el = id => document.getElementById(id);
const board = el('board');
const form = el('action-form');
const dialog = el('dialog');
const demo = createDemoApi();
const studio = createStudioApi(contract.address);
const state = { mode:'demo', api:demo, requests:[], request:null, selected:'', quote:'',
  busy:false, loading:false, revision:0, hasMore:false, action:null, tx:'' };
const labels = {FIT:'Fit', OUT_OF_SCOPE:'Out of scope', NEEDS_CLARIFICATION:'Needs clarification',
  PENDING:'Awaiting review', COVERED:'Covered', EXCLUDED:'Excluded', UNCLEAR:'Unclear' };
const tones = {FIT:'good', COVERED:'good', OUT_OF_SCOPE:'bad', EXCLUDED:'bad',
  NEEDS_CLARIFICATION:'caution', UNCLEAR:'caution', PENDING:'neutral'};
const enc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const badge = value => '<span class="badge ' + (tones[value] || 'neutral') + '">' + enc(labels[value] || value) + '</span>';
const formatDate = value => new Intl.DateTimeFormat('en', { day:'numeric', month:'short', year:'numeric',
  timeZone:'UTC' }).format(new Date(value + 'T00:00:00Z'));
const compact = value => value.length > 14 ? value.slice(0, 8) + '…' + value.slice(-4) : value;
const findQuote = () => state.request?.quotes.find(quote => quote.id === state.quote);
const isOwner = () => state.request?.buyer === state.api.account;
const isDemo = () => state.mode === 'demo';
const linkedRequest = new URLSearchParams(window.location.search).get('request') || '';
if (/^RFQ-[0-9]{4,10}$/.test(linkedRequest)) {
  Object.assign(state, {mode:'studio', api:studio, selected:linkedRequest});
}

el('contract-link').href = contract.explorer;
el('contract-link').hidden = false;

function status(message, hash = '') {
  const toast = el('toast');
  toast.replaceChildren(document.createTextNode(message));
  if (/^0x[0-9a-f]{64}$/i.test(hash)) {
    const link = document.createElement('a');
    link.href = contract.tx + hash;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View transaction';
    toast.append(' ', link);
  }
  toast.hidden = !message;
}

function renderHeader() {
  el('demo').setAttribute('aria-pressed', String(isDemo()));
  el('studio').setAttribute('aria-pressed', String(!isDemo()));
  el('wallet').hidden = isDemo();
  el('wallet').textContent = studio.account ? compact(studio.account) : 'Connect wallet';
  for (const id of ['demo','studio','wallet','new-request']) el(id).disabled = state.busy;
  el('network-note').innerHTML = isDemo()
    ? '<strong>Demo</strong><span>Explore sample quotes and try manual reviews. Changes stay in this browser.</span>'
    : '<strong>StudioNet</strong><span>Anyone can read these records. Use sample data and a test wallet for writes.</span>';
}

function renderRequests() {
  const requestList = el('requests');
  requestList.innerHTML = state.requests.map(request =>
    '<button type="button" class="request-tab' + (request.id === state.selected ? ' active' : '') +
    '" data-request="' + enc(request.id) + '" aria-pressed="' + (request.id === state.selected) +
    '"><strong>' + enc(request.title) + '</strong><small>' + enc(request.id) + '</small></button>').join('');
  if (!state.requests.length) requestList.innerHTML = '<p class="muted">' + (state.loading ? 'Loading…' : 'No requests found.') + '</p>';
  if (state.hasMore) requestList.insertAdjacentHTML('beforeend','<button class="text-button" type="button" id="more">Load more requests</button>');
}

function details(quote, request) {
  const checks = request.requirements.map((text, index) => {
    const row = quote.checks[index];
    return '<li><div class="check-title"><span>' + enc(text) + '</span>' +
      (row ? badge(row.decision) : '') + '</div>' +
      (row?.excerpt ? '<blockquote>' + enc(row.excerpt) + '</blockquote>' : '') + '</li>';
  }).join('');
  const annotated = quote.verdict !== 'PENDING';
  const actions = isOwner() && !state.busy ? (
    !annotated ? '<button class="primary" type="button" data-action="review">' + (isDemo() ? 'Review manually' : 'Run scope review') + '</button>'
      : quote.verdict === 'FIT' && !quote.shortlisted
        ? '<button class="primary" type="button" data-action="shortlist">Shortlist quote</button>' : ''
  ) : '';
  return '<section class="evidence" id="evidence"><div class="section-head"><div><p class="meta">' +
    enc(quote.id) + '</p><h3>' + enc(quote.supplier) + '</h3></div>' + badge(quote.verdict) +
    '</div><h4>Scope checklist</h4><ul class="checks">' + checks + '</ul>' +
    '<details class="terms"><summary>Original supplier terms</summary><p>' + enc(quote.terms) + '</p>' +
    (!isDemo() ? '<small>Signed by <span class="mono">' + enc(quote.issuer) + '</span></small>' : '') + '</details>' +
    '<div class="detail-actions">' + actions +
    (quote.shortlisted ? '<button class="secondary" type="button" data-action="proof">View shortlist proof</button>' : '') +
    (!annotated && !isOwner() ? '<p class="muted">The request owner can start the scope review.</p>' : '') +
    '</div></section>';
}

function renderBoard() {
  board.setAttribute('aria-busy', String(state.loading));
  const request = state.request;
  if (!request) {
    board.innerHTML = '<div class="empty"><h2>' + (state.loading ? 'Loading requests…' : 'Select or create a request') +
      '</h2><p>' + (state.loading ? 'Retrieving records.' : 'Add a budget, deadline and checklist to start comparing quotes.') +
      '</p></div>';
    return;
  }
  const quote = findQuote();
  const quotes = request.quotes.map(item => {
    const selected = item.id === state.quote;
    return '<tr' + (selected ? ' class="selected"' : '') + '><th scope="row"><button type="button" class="vendor" data-quote="' +
      enc(item.id) + '" aria-pressed="' + selected + '">' + enc(item.supplier) + '</button></th><td>' +
      enc(money(item.price_minor, request.currency)) + '<small class="' + (item.budget_ok ? 'pass' : 'fail') + '">' +
      (item.budget_ok ? 'Within budget' : 'Over budget') + '</small></td><td>' +
      enc(formatDate(item.delivery_on)) + '<small class="' + (item.date_ok ? 'pass' : 'fail') + '">' +
      (item.date_ok ? 'On time' : 'Past deadline') + '</small></td><td>' + badge(item.verdict) +
      (item.shortlisted ? '<small class="pass">Shortlisted</small>' : '') + '</td></tr>';
  }).join('');
  board.innerHTML = '<div class="request-head"><div><p class="meta">' + enc(request.id) +
    '</p><h2>' + enc(request.title) + '</h2></div><div class="head-actions">' +
    (isDemo() ? '' : '<button type="button" class="secondary" data-action="share">Copy request link</button>') + '<button type="button" class="secondary" data-action="quote"' +
    (state.busy || request.quotes.length >= 20 ? ' disabled' : '') + '>Add quote</button></div></div>' +
    '<dl class="stats"><div><dt>Budget cap</dt><dd>' + enc(money(request.budget_minor, request.currency)) +
    '</dd></div><div><dt>Delivery by</dt><dd>' + enc(formatDate(request.deadline)) +
    '</dd></div><div><dt>Scope requirements</dt><dd>' + request.requirements.length +
    '</dd></div></dl><div class="section-head table-head"><h3>Supplier quotes</h3><span class="meta">' +
    request.quotes.length + (request.quotes.length === 1 ? ' quote' : ' quotes') + '</span></div>' +
    (quotes ? '<div class="table-wrap"><table><thead><tr><th scope="col">Supplier</th><th scope="col">Price</th>' +
      '<th scope="col">Delivery</th><th scope="col">Verdict</th></tr></thead><tbody>' + quotes +
      '</tbody></table></div>' : '<p class="empty-quotes">Add a supplier quote to compare it to this checklist.</p>') +
    (quote ? details(quote, request) : '<ul class="request-checklist">' +
      request.requirements.map(value => '<li>' + enc(value) + '</li>').join('') + '</ul>');
}

function render() { renderHeader(); renderRequests(); renderBoard(); }

async function loadRequests({ more = false, newest = false } = {}) {
  const revision = ++state.revision;
  const size = 12;
  const offset = more ? state.requests.length : 0;
  state.loading = true;
  render();
  try {
    const rows = await state.api.read('list_requests', [offset, size]);
    if (revision !== state.revision) return;
    state.requests = more ? [...state.requests, ...rows.filter(row => !state.requests.some(old => old.id === row.id))] : rows;
    state.hasMore = rows.length === size;
    const selected = newest || !state.selected ? state.requests[0]?.id : state.selected;
    if (selected) await loadRequest(selected);
  } catch (error) {
    if (revision === state.revision) status(error.message || 'Could not load requests.');
  } finally {
    if (revision === state.revision) { state.loading = false; render(); }
  }
}

async function loadRequest(id) {
  const revision = ++state.revision;
  if (state.selected !== id) { state.quote = ''; state.request = null; }
  state.selected = id;
  state.loading = true;
  render();
  try {
    const request = await state.api.read('get_request', [id]);
    if (revision !== state.revision) return;
    state.request = request;
    if (!findQuote()) state.quote = request.quotes[0]?.id || '';
  } catch (error) {
    if (revision === state.revision) status(error.message || 'Could not load this request.');
  } finally {
    if (revision === state.revision) { state.loading = false; render(); }
  }
}

async function switchMode(mode) {
  if (state.busy || mode === state.mode) return;
  state.mode = mode;
  state.api = mode === 'demo' ? demo : studio;
  Object.assign(state, { requests:[], request:null, selected:'', quote:'', hasMore:false });
  status('');
  await loadRequests();
}

const field = (text, input) => '<label><span>' + text + '</span>' + input + '</label>';
function showDialog(title, markup, action, submit = 'Save') {
  state.action = action;
  el('dialog-title').textContent = title;
  el('dialog-body').innerHTML = markup;
  el('submit-dialog').textContent = submit;
  el('submit-dialog').hidden = !action;
  el('form-error').hidden = true;
  if (!dialog.open) dialog.showModal();
  (el('dialog-body').querySelector('input,textarea,select') || el('close-dialog')).focus();
}
const get = (data, key) => String(data.get(key) || '').trim();

function mustConnect() {
  if (state.api.account) return false;
  status('Connect a StudioNet wallet to make changes.');
  el('wallet').focus();
  return true;
}

function openRequestForm() {
  if (state.busy || mustConnect()) return;
  showDialog('New request',
    field('Request title','<input name="title" minlength="3" maxlength="100" required placeholder="Community workshop print packs">') +
    '<div class="form-row">' +
    field('Currency','<select name="currency">' + currencies.map(value => '<option>' + value + '</option>').join('') + '</select>') +
    field('Budget cap','<input name="budget" inputmode="decimal" placeholder="1800.00" required>') + '</div>' +
    field('Latest delivery date','<input name="deadline" type="date" min="0001-01-01" max="9999-12-31" required>') +
    field('Scope checklist · one requirement per line','<textarea name="requirements" rows="5" maxlength="1447" required placeholder="Supply 250 printed training packs.&#10;Include delivery to the venue."></textarea>'),
    { method:'open_request', args(data) {
      const requirements = get(data,'requirements').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      if (requirements.length < 1 || requirements.length > 8 || requirements.some(r => r.length < 4 || r.length > 180)) {
        throw new Error('Enter 1–8 requirements, each 4–180 characters long.');
      }
      if (new Set(requirements.map(r => r.toLowerCase())).size !== requirements.length) throw new Error('Use distinct requirements.');
      const title = get(data,'title');
      if (title.length < 3) throw new Error('Enter a request title of at least 3 characters.');
      return [title, get(data,'currency'), minorUnits(get(data,'budget')), get(data,'deadline'), requirements];
    }}, 'Open request');
}

function openQuoteForm(request) {
  const currency = enc(request.currency);
  showDialog('Add supplier quote',
    field('Supplier name','<input name="supplier" maxlength="80" minlength="2" required placeholder="Cedar Press">') +
    '<div class="form-row">' + field('Price in ' + currency,'<input name="price" inputmode="decimal" required placeholder="1580.00">') +
    field('Promised delivery','<input name="delivery" type="date" min="0001-01-01" max="9999-12-31" required>') + '</div>' +
    field('Supplier terms','<textarea name="terms" maxlength="2800" minlength="15" rows="6" required placeholder="Paste the written scope, inclusions and exclusions."></textarea>'),
    {method:'submit_quote', args(data) {
      const supplier = get(data,'supplier');
      const terms = get(data,'terms');
      if (supplier.length < 2 || terms.length < 15) throw new Error('Enter a supplier name and at least 15 characters of terms.');
      return [request.id, supplier, minorUnits(get(data,'price')), get(data,'delivery'), terms];
    }}, 'Submit quote');
}

function openReviewForm(request, quote) {
  if (!isDemo()) {
    showDialog('Run scope review', '<p>GenLayer validators independently evaluate each checklist item. A review is saved when the required validators agree on the exact decisions.</p>',
      {method:'review_quote', args:() => [quote.id]}, 'Sign review');
    return;
  }
  const rows = request.requirements.map((value, index) => '<fieldset><legend>' + enc(value) + '</legend>' +
    field('Decision','<select name="decision-' + index + '"><option value="UNCLEAR">Unclear</option><option value="COVERED">Covered</option><option value="EXCLUDED">Excluded</option></select>') +
    field('Verbatim evidence','<input name="excerpt-' + index + '" maxlength="240">') + '</fieldset>').join('');
  showDialog('Review quote manually','<blockquote class="review-terms">' + enc(quote.terms) + '</blockquote>' + rows,
    {method:'review_quote',args(data) {
      return [quote.id, request.requirements.map((_, index) => {
        const decision = get(data,'decision-' + index);
        const excerpt = get(data,'excerpt-' + index);
        if ((excerpt || decision !== 'UNCLEAR') && (excerpt.length < 5 || !quote.terms.includes(excerpt))) {
          throw new Error('For each decision with evidence, copy a verbatim excerpt of at least 5 characters from the supplier terms.');
        }
        return {id:index + 1, decision, excerpt};
      })];
    }}, 'Save review');
}

async function showProof(quote) {
  const api = state.api;
  try {
    const proof = await api.read('get_shortlist_proof',[quote.id]);
    const verified = await checkProof(proof);
    if (api !== state.api || state.quote !== quote.id || dialog.open) return;
    showDialog('Shortlist proof','<p class="' + (verified ? 'pass' : 'fail') + '">' + (verified ? 'SHA-256 matches this snapshot.' : 'SHA-256 does not match the snapshot.') +
      '</p><code class="proof-hash">' + enc(proof.sha256) + '</code><details class="terms"><summary>Snapshot JSON</summary><pre>' +
      enc(JSON.stringify(JSON.parse(proof.payload_json), null, 2)) + '</pre></details><button type="button" class="secondary" id="download-proof">Download proof JSON</button>',null);
    el('download-proof').onclick = () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(proof,null,2) + '\n'],{type:'application/json'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = quote.id + '-shortlist.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
    };
  } catch (error) { status(error.message || 'Could not read the shortlist proof.'); }
}

board.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || state.busy) return;
  if (button.dataset.quote) {
    state.quote = button.dataset.quote;
    renderBoard();
    board.querySelector('[data-quote="' + CSS.escape(state.quote) + '"]')?.focus({preventScroll:true});
    if (window.matchMedia('(max-width: 760px)').matches) el('evidence').scrollIntoView({block:'nearest'});
    return;
  }
  const action = button.dataset.action;
  if (!action) return;
  const request = state.request;
  const quote = findQuote();
  if (action === 'proof') { void showProof(quote); return; }
  if (action === 'share') {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({request:request.id});
    url.hash = '';
    if (!navigator.clipboard) { status('Copy this link to share the request. ' + url.href); return; }
    navigator.clipboard.writeText(url.href)
      .then(() => status('StudioNet request link copied.'))
      .catch(() => status('Copy this link to share the request. ' + url.href));
    return;
  }
  if (mustConnect()) return;
  if (action === 'quote') openQuoteForm(request);
  if (action === 'review') openReviewForm(request, quote);
  if (action === 'shortlist') showDialog('Shortlist quote',
    '<p>Record ' + enc(quote.supplier) + ' as eligible with a verifiable snapshot of the request and review.</p>',
    {method:'shortlist_quote',args:() => [quote.id]}, 'Shortlist');
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy || !state.action || !form.reportValidity()) return;
  const action = state.action;
  const api = state.api;
  const errorLine = el('form-error');
  errorLine.hidden = true;
  state.tx = '';
  try {
    const args = action.args(new FormData(form));
    state.busy = true;
    el('submit-dialog').disabled = true;
    renderHeader();
    el('submit-dialog').textContent = isDemo() ? 'Saving…' : 'Waiting for finality…';
    await api.write(action.method,args,hash => {
      state.tx = hash;
      status('Submitted. Waiting for StudioNet finality.', hash);
    });
    dialog.close();
    status(isDemo() ? 'Saved in this browser.' : 'Transaction finalized.', state.tx);
    if (action.method === 'open_request') {
      await loadRequests({newest:isDemo()});
    } else {
      const existing = new Set(state.request.quotes.map(quote => quote.id));
      await loadRequest(state.selected);
      if (action.method === 'submit_quote') {
        const created = state.request?.quotes.filter(item => !existing.has(item.id) && item.issuer === (isDemo() ? 'local-supplier' : api.account));
        if (created?.length === 1) state.quote = created[0].id;
      }
    }
  } catch (error) {
    const message = error.shortMessage || error.message || 'This action could not be completed.';
    errorLine.textContent = message;
    errorLine.hidden = false;
    if (state.tx) status(message, state.tx);
    el('submit-dialog').textContent = state.tx ? 'Review transaction first' : 'Try again';
  } finally {
    state.busy = false;
    el('submit-dialog').disabled = Boolean(state.tx && dialog.open);
    render();
  }
});

dialog.addEventListener('close', () => { state.action = null; el('submit-dialog').disabled = false; });
dialog.addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
el('close-dialog').onclick = el('cancel-dialog').onclick = () => { if (!state.busy) dialog.close(); };
el('new-request').onclick = openRequestForm;
el('demo').onclick = () => void switchMode('demo');
el('studio').onclick = () => void switchMode('studio');
el('wallet').onclick = async () => {
  if (state.busy) return;
  if (studio.account) {
    studio.disconnect();
    status('Wallet disconnected from QuoteGate.');
  } else {
    try { await studio.connect(); status('StudioNet wallet connected.'); }
    catch (error) { status(error.shortMessage || error.message); }
  }
  render();
};
for (const event of ['accountsChanged','chainChanged']) window.ethereum?.on?.(event, () => {
  if (!studio.account) return;
  studio.disconnect();
  if (!isDemo()) status('Wallet settings changed. Connect again to sign on StudioNet.');
  render();
});
el('requests').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (state.busy || !button) return;
  if (button.id === 'more') void loadRequests({more:true});
  else if (button.dataset.request) void loadRequest(button.dataset.request);
});
void loadRequests();
