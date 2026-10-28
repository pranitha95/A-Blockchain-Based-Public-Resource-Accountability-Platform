import type { ChainInfo } from '../types';

export function anchoringGapDescription(chain: ChainInfo | undefined): string {
  if (!chain) return 'the chain configuration is unavailable';
  if (!chain.contractAddress && !chain.rpcConfigured) {
    return 'no registry contract address or RPC endpoint is configured';
  }
  if (!chain.contractAddress) return 'no registry contract address is configured';
  return 'no RPC endpoint is configured';
}
