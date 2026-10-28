import type { AnchorDetailView } from '@poi/shared';
import { REGISTRY_ABI } from '@poi/shared';
import type { Eip1193Provider } from 'ethers';

interface InjectedEthereum {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
}

declare global {
  interface Window {
    ethereum?: InjectedEthereum;
  }
}

export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalletError';
  }
}

export function hasInjectedWallet(): boolean {
  return typeof window !== 'undefined' && Boolean(window.ethereum);
}

async function browserProvider() {
  const { BrowserProvider } = await import('ethers');
  if (!window.ethereum) {
    throw new WalletError('No browser wallet was detected. Install MetaMask to submit a blockchain transaction.');
  }
  return new BrowserProvider(window.ethereum as unknown as Eip1193Provider);
}

export interface WalletConnection {
  address: string;
  chainId: number;
}

export async function connectWallet(): Promise<WalletConnection> {
  if (!window.ethereum) {
    throw new WalletError('No browser wallet was detected. Install MetaMask to submit a blockchain transaction.');
  }
  await window.ethereum.request({ method: 'eth_requestAccounts' });
  const provider = await browserProvider();
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const network = await provider.getNetwork();
  return { address, chainId: Number(network.chainId) };
}

export async function switchWalletNetwork(chainId: number, chainName: string): Promise<WalletConnection> {
  if (!window.ethereum) throw new WalletError('No browser wallet was detected.');
  const hexChainId = `0x${chainId.toString(16)}`;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: hexChainId }],
    });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 4902) {
      throw new WalletError(
        `${chainName} is not configured in your wallet. Add the network in MetaMask first, then try again. The platform will not ask for or store a private key.`,
      );
    }
    if (code === 4001) throw new WalletError('You declined the network switch request.');
    throw new WalletError(`The wallet could not switch to ${chainName}. Switch networks manually and try again.`);
  }
  return readWallet();
}

export async function readWallet(): Promise<WalletConnection> {
  const provider = await browserProvider();
  const accounts = (await provider.send('eth_accounts', [])) as string[];
  const network = await provider.getNetwork();
  return { address: accounts[0] ?? '', chainId: Number(network.chainId) };
}

type AnchorableContract = {
  canAnchor: (address: string) => Promise<boolean>;
  anchorRecord: (record: {
    projectId: string;
    recordType: number;
    recordId: string;
    recordVersion: number;
    contentDigest: string;
    previousKey: string;
  }) => Promise<{ hash: string }>;
};

export async function contractIsDeployed(contractAddress: string): Promise<boolean> {
  const provider = await browserProvider();
  const code = await provider.getCode(contractAddress);
  return code !== '0x' && code !== '0x0';
}

export async function walletCanAnchor(contractAddress: string, walletAddress: string): Promise<boolean> {
  const { Contract } = await import('ethers');
  const provider = await browserProvider();
  const contract = new Contract(contractAddress, REGISTRY_ABI, provider) as unknown as AnchorableContract;
  return Boolean(await contract.canAnchor(walletAddress));
}

export async function sendAnchorTransaction(
  anchor: AnchorDetailView,
  expectedChainId: number,
  contractAddress: string,
): Promise<string> {
  const { Contract } = await import('ethers');
  const provider = await browserProvider();
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== expectedChainId) {
    throw new WalletError(`Your wallet is connected to chain ${Number(network.chainId)}, not chain ${expectedChainId}.`);
  }
  const signer = await provider.getSigner();
  const contract = new Contract(contractAddress, REGISTRY_ABI, signer) as unknown as AnchorableContract;
  const transaction = await contract.anchorRecord({
    projectId: anchor.projectIdBytes32,
    recordType: anchor.recordTypeCode,
    recordId: anchor.recordIdBytes32,
    recordVersion: anchor.recordVersion,
    contentDigest: anchor.contentDigest,
    previousKey: anchor.previousKey,
  });
  return String(transaction.hash);
}
