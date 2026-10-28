import { computeCommitment as computeSharedCommitment, computeRecordKey as computeSharedRecordKey } from '@poi/shared';
import { expect } from 'chai';
import { keccak256, ZeroAddress, ZeroHash, toUtf8Bytes } from 'ethers';
import { network } from 'hardhat';

const { ethers } = await network.create();

const PROJECT_ID = keccak256(toUtf8Bytes('73b2e2f8-7154-4b7d-9e6b-d6c12ceb6f95'));
const OTHER_PROJECT_ID = keccak256(toUtf8Bytes('a317e1f4-1555-46c7-8159-27b9e49a9a72'));
const RECORD_ID = keccak256(toUtf8Bytes('0b9a48c9-42d0-4a9c-b9ca-9abfcf7aeb6b'));
const OTHER_RECORD_ID = keccak256(toUtf8Bytes('128578e8-f8f5-46bc-aab8-97aca9bdb3aa'));
const DIGEST_V1 = keccak256(toUtf8Bytes('{"record":"v1","title":"Demonstration record"}'));
const DIGEST_V2 = keccak256(toUtf8Bytes('{"record":"v2","title":"Corrected demonstration record"}'));

const ZERO = ZeroHash;

interface AnchorInput {
  projectId: string;
  recordType: number;
  recordId: string;
  recordVersion: bigint;
  contentDigest: string;
  previousKey: string;
}

describe('ProofOfImpactRegistry', function () {
  let registry: any;
  let admin: any;
  let anchorer: any;
  let stranger: any;
  let anchorRole: string;

  beforeEach(async function () {
    [admin, anchorer, stranger] = await ethers.getSigners();
    registry = await ethers.deployContract('ProofOfImpactRegistry', [admin.address]);
    await registry.waitForDeployment();
    anchorRole = await registry.ANCHOR_ROLE();
    await registry.connect(admin).grantRole(anchorRole, anchorer.address);
  });

  function input(overrides: Partial<AnchorInput> = {}): AnchorInput {
    return {
      projectId: PROJECT_ID,
      recordType: 1,
      recordId: RECORD_ID,
      recordVersion: 1n,
      contentDigest: DIGEST_V1,
      previousKey: ZERO,
      ...overrides,
    };
  }

  describe('deployment and access control', function () {
    it('rejects a zero-address administrator', async function () {
      const factory = await ethers.getContractFactory('ProofOfImpactRegistry');
      await expect(factory.deploy(ZeroAddress))
        .to.be.revertedWithCustomError(factory, 'ZeroAddress');
    });

    it('grants the deployer administrator rights but not anchoring rights', async function () {
      const defaultAdminRole = await registry.DEFAULT_ADMIN_ROLE();
      expect(await registry.hasRole(defaultAdminRole, admin.address)).to.equal(true);
      expect(await registry.hasRole(anchorRole, admin.address)).to.equal(false);
      expect(await registry.canAnchor(anchorer.address)).to.equal(true);
      expect(await registry.canAnchor(stranger.address)).to.equal(false);
    });

    it('allows only administrators to grant and revoke the anchoring role', async function () {
      await expect(registry.connect(anchorer).grantRole(anchorRole, stranger.address))
        .to.be.revertedWithCustomError(registry, 'AccessControlUnauthorizedAccount')
        .withArgs(anchorer.address, await registry.DEFAULT_ADMIN_ROLE());

      await registry.connect(admin).revokeRole(anchorRole, anchorer.address);
      expect(await registry.canAnchor(anchorer.address)).to.equal(false);

      await expect(registry.connect(anchorer).anchorRecord(input()))
        .to.be.revertedWithCustomError(registry, 'AccessControlUnauthorizedAccount')
        .withArgs(anchorer.address, anchorRole);
    });
  });

  describe('commitment computation', function () {
    it('matches the shared off-chain commitment and record-key scheme', async function () {
      const networkInfo = await ethers.provider.getNetwork();
      const contractAddress = await registry.getAddress();

      const contractCommitment = await registry.computeCommitment(
        PROJECT_ID,
        1,
        RECORD_ID,
        3n,
        DIGEST_V1,
      );
      const sharedCommitment = computeSharedCommitment({
        chainId: Number(networkInfo.chainId),
        registryAddress: contractAddress,
        projectId: '73b2e2f8-7154-4b7d-9e6b-d6c12ceb6f95',
        recordType: 'MILESTONE_SUBMISSION',
        recordId: '0b9a48c9-42d0-4a9c-b9ca-9abfcf7aeb6b',
        recordVersion: 3,
        contentDigest: DIGEST_V1,
      });
      expect(contractCommitment).to.equal(sharedCommitment);

      const contractKey = await registry.recordKey(PROJECT_ID, 1, RECORD_ID, 3n);
      const sharedKey = computeSharedRecordKey({
        projectId: '73b2e2f8-7154-4b7d-9e6b-d6c12ceb6f95',
        recordType: 'MILESTONE_SUBMISSION',
        recordId: '0b9a48c9-42d0-4a9c-b9ca-9abfcf7aeb6b',
        recordVersion: 3,
      });
      expect(contractKey).to.equal(sharedKey);
    });

    it('binds the domain, chain, registry and every record field into the commitment', async function () {
      const base = await registry.computeCommitment(PROJECT_ID, 1, RECORD_ID, 1n, DIGEST_V1);
      const variants = [
        await registry.computeCommitment(OTHER_PROJECT_ID, 1, RECORD_ID, 1n, DIGEST_V1),
        await registry.computeCommitment(PROJECT_ID, 2, RECORD_ID, 1n, DIGEST_V1),
        await registry.computeCommitment(PROJECT_ID, 1, OTHER_RECORD_ID, 1n, DIGEST_V1),
        await registry.computeCommitment(PROJECT_ID, 1, RECORD_ID, 2n, DIGEST_V1),
        await registry.computeCommitment(PROJECT_ID, 1, RECORD_ID, 1n, DIGEST_V2),
      ];
      expect(new Set([base, ...variants]).size).to.equal(6);
    });
  });

  describe('validation', function () {
    it('rejects invalid anchor inputs', async function () {
      await expect(registry.connect(anchorer).anchorRecord(input({ projectId: ZERO })))
        .to.be.revertedWithCustomError(registry, 'ZeroProjectId');
      await expect(registry.connect(anchorer).anchorRecord(input({ recordId: ZERO })))
        .to.be.revertedWithCustomError(registry, 'ZeroRecordId');
      await expect(registry.connect(anchorer).anchorRecord(input({ contentDigest: ZERO })))
        .to.be.revertedWithCustomError(registry, 'ZeroDigest');
      await expect(registry.connect(anchorer).anchorRecord(input({ recordVersion: 0n })))
        .to.be.revertedWithCustomError(registry, 'InvalidRecordVersion');
      await expect(registry.connect(anchorer).anchorRecord(input({ recordType: 5 })))
        .to.be.revertedWithCustomError(registry, 'InvalidRecordType');
    });

    it('accepts every declared record type', async function () {
      for (let recordType = 0; recordType < 5; recordType += 1) {
        const recordId = keccak256(toUtf8Bytes(`record-type-${recordType}`));
        await registry.connect(anchorer).anchorRecord(input({ recordType, recordId }));
        const key = await registry.recordKey(PROJECT_ID, recordType, recordId, 1n);
        expect(await registry.recordExists(key)).to.equal(true);
      }
    });
  });

  describe('anchoring and history', function () {
    it('stores an immutable commitment and emits a verifiable event', async function () {
      const anchorInput = input();
      const expectedKey = await registry.recordKey(PROJECT_ID, 1, RECORD_ID, 1n);
      const expectedCommitment = await registry.computeCommitment(PROJECT_ID, 1, RECORD_ID, 1n, DIGEST_V1);

      const [staticKey, staticCommitment] = await registry.connect(anchorer).anchorRecord.staticCall(anchorInput);
      expect(staticKey).to.equal(expectedKey);
      expect(staticCommitment).to.equal(expectedCommitment);

      const transaction = await registry.connect(anchorer).anchorRecord(anchorInput);
      const receipt = await transaction.wait();
      const event = receipt.logs
        .map((log: any) => {
          try {
            return registry.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed: any) => parsed?.name === 'RecordAnchored');

      expect(event).to.not.equal(undefined);
      expect(event.args.key).to.equal(expectedKey);
      expect(event.args.projectId).to.equal(PROJECT_ID);
      expect(event.args.recordType).to.equal(1n);
      expect(event.args.recordId).to.equal(RECORD_ID);
      expect(event.args.recordVersion).to.equal(1n);
      expect(event.args.contentDigest).to.equal(DIGEST_V1);
      expect(event.args.commitment).to.equal(expectedCommitment);
      expect(event.args.previousKey).to.equal(ZERO);
      expect(event.args.anchorer).to.equal(anchorer.address);
      expect(event.args.anchoredAt).to.be.greaterThan(0n);

      const record = await registry.getRecord(expectedKey);
      expect(record.projectId).to.equal(PROJECT_ID);
      expect(record.recordType).to.equal(1n);
      expect(record.recordId).to.equal(RECORD_ID);
      expect(record.recordVersion).to.equal(1n);
      expect(record.contentDigest).to.equal(DIGEST_V1);
      expect(record.commitment).to.equal(expectedCommitment);
      expect(record.previousKey).to.equal(ZERO);
      expect(record.anchorer).to.equal(anchorer.address);
      expect(record.anchoredAt).to.be.greaterThan(0n);
      expect(record.superseded).to.equal(false);

      expect(await registry.verify(expectedKey, expectedCommitment)).to.equal(true);
      expect(await registry.verify(expectedKey, DIGEST_V1)).to.equal(false);
      expect(await registry.activeKey(PROJECT_ID, 1, RECORD_ID)).to.equal(expectedKey);
      expect(await registry.logicalKey(PROJECT_ID, 1, RECORD_ID)).to.not.equal(ZERO);
    });

    it('rejects duplicate anchors and a second unversioned anchor for the same logical record', async function () {
      const key = await registry.recordKey(PROJECT_ID, 1, RECORD_ID, 1n);
      await registry.connect(anchorer).anchorRecord(input());

      await expect(registry.connect(anchorer).anchorRecord(input()))
        .to.be.revertedWithCustomError(registry, 'DuplicateRecord')
        .withArgs(key);

      await expect(registry.connect(anchorer).anchorRecord(input({ recordVersion: 2n })))
        .to.be.revertedWithCustomError(registry, 'ActiveRecordExists')
        .withArgs(key);
    });

    it('supersedes an earlier version only through its explicit current key', async function () {
      await registry.connect(anchorer).anchorRecord(input());
      const firstKey = await registry.recordKey(PROJECT_ID, 1, RECORD_ID, 1n);
      const firstCommitment = await registry.computeCommitment(PROJECT_ID, 1, RECORD_ID, 1n, DIGEST_V1);

      const secondInput = input({ recordVersion: 2n, contentDigest: DIGEST_V2, previousKey: firstKey });
      const secondKey = await registry.recordKey(PROJECT_ID, 1, RECORD_ID, 2n);
      const transaction = await registry.connect(anchorer).anchorRecord(secondInput);
      const receipt = await transaction.wait();
      const supersededEvent = receipt.logs
        .map((log: any) => {
          try {
            return registry.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed: any) => parsed?.name === 'RecordSuperseded');

      expect(supersededEvent).to.not.equal(undefined);
      expect(supersededEvent.args.previousKey).to.equal(firstKey);
      expect(supersededEvent.args.newKey).to.equal(secondKey);
      expect(supersededEvent.args.supersededBy).to.equal(anchorer.address);

      const previous = await registry.getRecord(firstKey);
      expect(previous.superseded).to.equal(true);
      expect(previous.commitment).to.equal(firstCommitment);
      expect(await registry.activeKey(PROJECT_ID, 1, RECORD_ID)).to.equal(secondKey);
      expect(await registry.recordExists(secondKey)).to.equal(true);

      await expect(
        registry.connect(anchorer).anchorRecord(
          input({ recordVersion: 3n, contentDigest: DIGEST_V2, previousKey: firstKey }),
        ),
      )
        .to.be.revertedWithCustomError(registry, 'PreviousRecordMismatch')
        .withArgs(firstKey);
    });

    it('rejects stale, mismatched and non-increasing supersessions', async function () {
      await registry.connect(anchorer).anchorRecord(input());
      const firstKey = await registry.recordKey(PROJECT_ID, 1, RECORD_ID, 1n);
      await registry.connect(anchorer).anchorRecord(
        input({ recordVersion: 2n, contentDigest: DIGEST_V2, previousKey: firstKey }),
      );
      const secondKey = await registry.recordKey(PROJECT_ID, 1, RECORD_ID, 2n);

      await expect(
        registry.connect(anchorer).anchorRecord(
          input({ recordVersion: 3n, previousKey: keccak256(toUtf8Bytes('unknown previous key')) }),
        ),
      ).to.be.revertedWithCustomError(registry, 'PreviousRecordMismatch');

      await registry.connect(anchorer).anchorRecord(
        input({ recordId: OTHER_RECORD_ID, recordVersion: 5n, contentDigest: DIGEST_V1 }),
      );
      const higherVersionKey = await registry.recordKey(PROJECT_ID, 1, OTHER_RECORD_ID, 5n);
      await expect(
        registry.connect(anchorer).anchorRecord(
          input({ recordId: OTHER_RECORD_ID, recordVersion: 3n, contentDigest: DIGEST_V2, previousKey: higherVersionKey }),
        ),
      )
        .to.be.revertedWithCustomError(registry, 'InvalidVersionProgression')
        .withArgs(5n, 3n);

      await expect(
        registry.connect(anchorer).anchorRecord(
          input({ recordId: OTHER_RECORD_ID, recordVersion: 2n, previousKey: secondKey }),
        ),
      ).to.be.revertedWithCustomError(registry, 'PreviousRecordMismatch');
    });

    it('keeps independent logical records and projects isolated', async function () {
      await registry.connect(anchorer).anchorRecord(input());
      await registry.connect(anchorer).anchorRecord(
        input({ recordId: OTHER_RECORD_ID, contentDigest: DIGEST_V2 }),
      );
      await registry.connect(anchorer).anchorRecord(
        input({ projectId: OTHER_PROJECT_ID, contentDigest: DIGEST_V2 }),
      );

      const firstKey = await registry.recordKey(PROJECT_ID, 1, RECORD_ID, 1n);
      const otherRecordKey = await registry.recordKey(PROJECT_ID, 1, OTHER_RECORD_ID, 1n);
      const otherProjectKey = await registry.recordKey(OTHER_PROJECT_ID, 1, RECORD_ID, 1n);
      expect(new Set([firstKey, otherRecordKey, otherProjectKey]).size).to.equal(3);

      expect(await registry.activeKey(PROJECT_ID, 1, RECORD_ID)).to.equal(firstKey);
      expect(await registry.activeKey(PROJECT_ID, 1, OTHER_RECORD_ID)).to.equal(otherRecordKey);
      expect(await registry.activeKey(OTHER_PROJECT_ID, 1, RECORD_ID)).to.equal(otherProjectKey);
    });

    it('reverts when reading an unknown record', async function () {
      const unknownKey = await registry.recordKey(PROJECT_ID, 1, RECORD_ID, 9n);
      await expect(registry.getRecord(unknownKey))
        .to.be.revertedWithCustomError(registry, 'PreviousRecordNotFound')
        .withArgs(unknownKey);
      expect(await registry.recordExists(unknownKey)).to.equal(false);
      expect(await registry.verify(unknownKey, DIGEST_V1)).to.equal(false);
    });
  });
});
