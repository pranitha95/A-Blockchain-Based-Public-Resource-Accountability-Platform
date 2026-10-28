import { getAddress, isAddress } from 'ethers';
import { network } from 'hardhat';

function optionalAddress(name: string): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  if (!isAddress(raw)) {
    throw new Error(`${name} must be a valid 20-byte Ethereum address`);
  }
  return getAddress(raw);
}

async function main(): Promise<void> {
  const { ethers } = await network.create();
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error('No deployer account is configured for this network');
  }

  const configuredAdmin = optionalAddress('REGISTRY_ADMIN_ADDRESS');
  const initialAnchorer = optionalAddress('INITIAL_ANCHORER_ADDRESS');
  const adminAddress = configuredAdmin ?? deployer.address;

  const registry = await ethers.deployContract('ProofOfImpactRegistry', [adminAddress]);
  await registry.waitForDeployment();
  const deploymentTransaction = registry.deploymentTransaction();
  const receipt = await deploymentTransaction?.wait();
  const contractAddress = await registry.getAddress();
  const networkInfo = await ethers.provider.getNetwork();

  let grantedAnchorer: string | null = null;
  if (initialAnchorer) {
    const isDeployerAdmin = await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), deployer.address);
    if (isDeployerAdmin) {
      const anchorRole = await registry.ANCHOR_ROLE();
      const grantTransaction = await registry.grantRole(anchorRole, initialAnchorer);
      await grantTransaction.wait();
      grantedAnchorer = initialAnchorer;
    } else {
      throw new Error(
        'The deployer is not the registry administrator, so it cannot grant ANCHOR_ROLE. Deploy without INITIAL_ANCHORER_ADDRESS, then grant the role from the administrator account.',
      );
    }
  }

  console.log('\nProofOfImpactRegistry deployed.');
  console.log(`  network:           ${networkInfo.name} (chain id ${networkInfo.chainId})`);
  console.log(`  contract address:  ${contractAddress}`);
  console.log(`  transaction hash:  ${deploymentTransaction?.hash ?? 'unavailable'}`);
  console.log(`  block number:      ${receipt?.blockNumber ?? 'unavailable'}`);
  console.log(`  deployer:          ${deployer.address}`);
  console.log(`  administrator:     ${adminAddress}`);
  console.log(`  initial anchorer:  ${grantedAnchorer ?? 'not granted'}`);
  console.log('\nNext steps:');
  console.log(`  1. Add CONTRACT_ADDRESS=${contractAddress} to the server environment (never to a VITE_ variable).`);
  console.log('  2. Set CHAIN_ID and RPC_URL for the same network.');
  console.log('  3. Grant ANCHOR_ROLE only to authorized wallet addresses using the administrator account.');
  console.log('  4. Never place a private key in frontend code or any VITE_ environment variable.');
  if (!grantedAnchorer) {
    console.log('\nNo ANCHOR_ROLE was granted. Run scripts/grant-anchorer.ts from an administrator account when ready.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
