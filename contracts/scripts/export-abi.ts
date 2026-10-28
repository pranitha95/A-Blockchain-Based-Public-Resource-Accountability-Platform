import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const artifactPath = path.resolve(
  here,
  '../artifacts/contracts/ProofOfImpactRegistry.sol/ProofOfImpactRegistry.json',
);
const outputPath = path.resolve(here, '../../packages/shared/src/abi/registryAbi.ts');

if (!fs.existsSync(artifactPath)) {
  throw new Error('Compiled artifact not found. Run "npm run compile -w @poi/contracts" first.');
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as { abi: unknown[] };
if (!Array.isArray(artifact.abi)) {
  throw new Error('The compiled artifact does not contain a valid ABI array.');
}

const contents = `// Generated from contracts/artifacts/contracts/ProofOfImpactRegistry.sol/ProofOfImpactRegistry.json.
// Regenerate with: npm run export:abi -w @poi/contracts
export const REGISTRY_ABI = ${JSON.stringify(artifact.abi, null, 2)} as const;
`;

fs.writeFileSync(outputPath, contents, 'utf8');
console.log(`Exported ${artifact.abi.length} ABI entries to ${path.relative(process.cwd(), outputPath)}`);
