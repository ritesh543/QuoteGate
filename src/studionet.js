import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant, TransactionStatus } from 'genlayer-js/types';

const studioChain = '0x' + studionet.id.toString(16);
const validAddress = value => /^0x[0-9a-fA-F]{40}$/.test(value);

export function receiptSucceeded(tx) {
  const leaders = tx.consensus_data?.leader_receipt;
  const leader = Array.isArray(leaders) ? leaders.at(-1) : leaders;
  const execution = String(leader?.execution_result ?? tx.txExecutionResultName ?? '').toUpperCase();
  return execution === 'SUCCESS' || execution === 'FINISHED_WITH_RETURN';
}

async function switchToStudio(provider) {
  if (Number(await provider.request({ method: 'eth_chainId' })) === studionet.id) return;
  const switchRequest = { method: 'wallet_switchEthereumChain', params: [{ chainId: studioChain }] };
  try {
    await provider.request(switchRequest);
  } catch (error) {
    if (Number(error.code) !== 4902) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: studioChain,
      chainName: 'GenLayer StudioNet',
      nativeCurrency: studionet.nativeCurrency,
      rpcUrls: studionet.rpcUrls.default.http,
      blockExplorerUrls: [studionet.blockExplorers.default.url]
    }] });
    await provider.request(switchRequest);
  }
}

export function createStudioApi(address, provider = window.ethereum) {
  if (!validAddress(address)) throw new Error('A verified StudioNet contract address is required.');
  const reader = createClient({ chain: studionet });
  let writer;
  let account = '';
  return {
    get account() { return account; },
    disconnect() { writer = undefined; account = ''; },
    async connect() {
      if (!provider?.request) throw new Error('Open this page in an EIP-1193 wallet browser or enable a compatible wallet extension.');
      const [selected] = await provider.request({ method: 'eth_requestAccounts' });
      if (!validAddress(selected)) throw new Error('Select a wallet account to continue.');
      await switchToStudio(provider);
      if (Number(await provider.request({ method: 'eth_chainId' })) !== studionet.id) {
        throw new Error('Switch your wallet to StudioNet (61999).');
      }
      writer = createClient({ chain: studionet, account: selected, provider });
      account = selected.toLowerCase();
      return account;
    },
    read(functionName, args = []) {
      return reader.readContract({ address, functionName, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
    },
    async write(functionName, args = [], submitted = () => {}) {
      if (!writer || !account) throw new Error('Connect a StudioNet wallet to sign.');
      const [chain, accounts] = await Promise.all([
        provider.request({ method: 'eth_chainId' }),
        provider.request({ method: 'eth_accounts' })
      ]);
      if (Number(chain) !== studionet.id || accounts[0]?.toLowerCase() !== account) {
        throw new Error('Reconnect the wallet on StudioNet before signing.');
      }
      const hash = await writer.writeContract({ address, functionName, args, value: 0n, leaderOnly: false });
      submitted(hash);
      let result;
      try {
        result = await reader.waitForTransactionReceipt({
          hash, status: TransactionStatus.FINALIZED, retries: 45, interval: 3000, fullTransaction: true
        });
      } catch (error) {
        const pending = new Error('Finalized receipt unavailable. Check the submitted transaction in Explorer before retrying.', { cause: error });
        pending.hash = hash;
        throw pending;
      }
      if (!receiptSucceeded(result)) {
        const failed = new Error('StudioNet did not report successful execution. Check the receipt in Explorer.');
        failed.hash = hash;
        throw failed;
      }
      return { hash };
    }
  };
}
