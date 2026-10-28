import { getAddress, isAddress } from 'ethers';
import { network } from 'hardhat';

async function main(): Promise<void> {
  const rawContract = process.env.CONTRACT_ADDRESS?.trim();
  const rawAnchorer = process.env.ANCHORER_ADDRESS?.trim();
  if (!rawContract || !isAddress(rawContract)) {
    throw new Error('CONTRACT_ADDRESS must be set to the deployed registry address');
  }
  if (!rawAnchorer || !isAddress(rawAnchorer)) {
    throw new Error('ANCHORER_ADDRESS must be set to the wallet address that should anchor records');
  }

  const { ethers } = await network.create();
  const [signer] = await ethers.getSigners();
  if (!signer) {
    throw new Error('No signer is configured for this network');
  }

  const registry = await ethers.getContractAt('ProofOfImpactRegistry', getAddress(rawContract), signer);
  const adminRole = await registry.DEFAULT_ADMIN_ROLE();
  if (!(await registry.hasRole(adminRole, signer.address))) {
    throw new Error(`Signer ${signer.address} does not hold DEFAULT_ADMIN_ROLE on this registry`);
  }

  const anchorRole = await registry.ANCHOR_ROLE();
  if (await registry.hasRole(anchorRole, getAddress(rawAnchorer))) {
    console.log(`Address ${getAddress(rawAnchorer)} already holds ANCHOR_ROLE.`);
    return;
  }

  const transaction = await registry.grantRole(anchorRole, getAddress(rawAnchorer));
  await transaction.wait();
  console.log(`Granted ANCHOR_ROLE to ${getAddress(rawAnchorer)}`);
  console.log(`  contract:    ${getAddress(rawContract)}`);
  console.log(`  transaction: ${transaction.hash}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
