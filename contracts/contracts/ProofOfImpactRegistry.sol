// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ProofOfImpactRegistry
 * @notice Stores versioned, append-only commitments to selected public accountability
 * records. The contract does not store documents or personal data and does not attest
 * that a claim is true; it only preserves what was committed, when, by which address,
 * and how a correction superseded an earlier commitment.
 *
 * Commitment format (version 1):
 *   keccak256(abi.encode(
 *     keccak256("PROOF_OF_IMPACT_RECORD_V1"),
 *     block.chainid,
 *     address(this),
 *     projectId,
 *     recordType,
 *     recordId,
 *     recordVersion,
 *     contentDigest
 *   ))
 *
 * projectId and recordId are bytes32 values derived by the application as
 * keccak256(utf8(canonical UUID string)). contentDigest is
 * keccak256(utf8(canonicalJson(payload))) calculated off-chain.
 */
contract ProofOfImpactRegistry is AccessControl {
    bytes32 public constant ANCHOR_ROLE = keccak256("ANCHOR_ROLE");
    bytes32 public constant COMMITMENT_DOMAIN = keccak256("PROOF_OF_IMPACT_RECORD_V1");

    uint8 public constant RECORD_TYPE_PROJECT = 0;
    uint8 public constant RECORD_TYPE_MILESTONE_SUBMISSION = 1;
    uint8 public constant RECORD_TYPE_REVIEW = 2;
    uint8 public constant RECORD_TYPE_EXPENDITURE_CLAIM = 3;
    uint8 public constant RECORD_TYPE_AUDIT_BATCH = 4;
    uint8 public constant RECORD_TYPE_COUNT = 5;

    struct AnchorInput {
        bytes32 projectId;
        uint8 recordType;
        bytes32 recordId;
        uint64 recordVersion;
        bytes32 contentDigest;
        bytes32 previousKey;
    }

    struct AnchorRecord {
        bytes32 projectId;
        uint8 recordType;
        bytes32 recordId;
        uint64 recordVersion;
        bytes32 contentDigest;
        bytes32 commitment;
        bytes32 previousKey;
        address anchorer;
        uint64 anchoredAt;
        bool superseded;
    }

    mapping(bytes32 => AnchorRecord) private _records;
    // keccak256(abi.encode(projectId, recordType, recordId)) => active commitment key
    mapping(bytes32 => bytes32) private _activeKeys;

    event RecordAnchored(
        bytes32 indexed key,
        bytes32 indexed projectId,
        uint8 indexed recordType,
        bytes32 recordId,
        uint64 recordVersion,
        bytes32 contentDigest,
        bytes32 commitment,
        bytes32 previousKey,
        address anchorer,
        uint64 anchoredAt
    );

    event RecordSuperseded(bytes32 indexed previousKey, bytes32 indexed newKey, address supersededBy);

    error ZeroAddress();
    error ZeroProjectId();
    error ZeroRecordId();
    error ZeroDigest();
    error InvalidRecordVersion();
    error InvalidRecordType();
    error DuplicateRecord(bytes32 key);
    error ActiveRecordExists(bytes32 activeKey);
    error PreviousRecordNotFound(bytes32 previousKey);
    error PreviousRecordAlreadySuperseded(bytes32 previousKey);
    error PreviousRecordMismatch(bytes32 previousKey);
    error InvalidVersionProgression(uint64 previousVersion, uint64 newVersion);

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function canAnchor(address account) external view returns (bool) {
        return hasRole(ANCHOR_ROLE, account);
    }

    function recordKey(
        bytes32 projectId,
        uint8 recordType,
        bytes32 recordId,
        uint64 recordVersion
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(projectId, recordType, recordId, recordVersion));
    }

    function logicalKey(bytes32 projectId, uint8 recordType, bytes32 recordId) public pure returns (bytes32) {
        return keccak256(abi.encode(projectId, recordType, recordId));
    }

    function computeCommitment(
        bytes32 projectId,
        uint8 recordType,
        bytes32 recordId,
        uint64 recordVersion,
        bytes32 contentDigest
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    COMMITMENT_DOMAIN,
                    block.chainid,
                    address(this),
                    projectId,
                    recordType,
                    recordId,
                    recordVersion,
                    contentDigest
                )
            );
    }

    /**
     * @notice Anchors a new commitment. Corrections must reference the currently
     * active commitment for the same logical record through `previousKey`.
     */
    function anchorRecord(AnchorInput calldata input) external onlyRole(ANCHOR_ROLE) returns (bytes32 key, bytes32 commitment) {
        if (input.projectId == bytes32(0)) revert ZeroProjectId();
        if (input.recordId == bytes32(0)) revert ZeroRecordId();
        if (input.contentDigest == bytes32(0)) revert ZeroDigest();
        if (input.recordVersion == 0) revert InvalidRecordVersion();
        if (input.recordType >= RECORD_TYPE_COUNT) revert InvalidRecordType();

        key = recordKey(input.projectId, input.recordType, input.recordId, input.recordVersion);
        if (_records[key].anchoredAt != 0) revert DuplicateRecord(key);

        bytes32 logicalKeyValue = logicalKey(input.projectId, input.recordType, input.recordId);
        bytes32 currentActiveKey = _activeKeys[logicalKeyValue];

        if (input.previousKey == bytes32(0)) {
            if (currentActiveKey != bytes32(0)) revert ActiveRecordExists(currentActiveKey);
        } else {
            if (currentActiveKey != input.previousKey) revert PreviousRecordMismatch(input.previousKey);
            AnchorRecord storage previous = _records[input.previousKey];
            if (previous.anchoredAt == 0) revert PreviousRecordNotFound(input.previousKey);
            if (previous.superseded) revert PreviousRecordAlreadySuperseded(input.previousKey);
            if (
                previous.projectId != input.projectId ||
                previous.recordType != input.recordType ||
                previous.recordId != input.recordId
            ) revert PreviousRecordMismatch(input.previousKey);
            if (input.recordVersion <= previous.recordVersion) {
                revert InvalidVersionProgression(previous.recordVersion, input.recordVersion);
            }
            previous.superseded = true;
            emit RecordSuperseded(input.previousKey, key, _msgSender());
        }

        commitment = computeCommitment(
            input.projectId,
            input.recordType,
            input.recordId,
            input.recordVersion,
            input.contentDigest
        );

        _activeKeys[logicalKeyValue] = key;
        _records[key] = AnchorRecord({
            projectId: input.projectId,
            recordType: input.recordType,
            recordId: input.recordId,
            recordVersion: input.recordVersion,
            contentDigest: input.contentDigest,
            commitment: commitment,
            previousKey: input.previousKey,
            anchorer: _msgSender(),
            anchoredAt: uint64(block.timestamp),
            superseded: false
        });

        emit RecordAnchored(
            key,
            input.projectId,
            input.recordType,
            input.recordId,
            input.recordVersion,
            input.contentDigest,
            commitment,
            input.previousKey,
            _msgSender(),
            uint64(block.timestamp)
        );
    }

    function getRecord(bytes32 key) external view returns (AnchorRecord memory) {
        AnchorRecord memory record = _records[key];
        if (record.anchoredAt == 0) revert PreviousRecordNotFound(key);
        return record;
    }

    function recordExists(bytes32 key) external view returns (bool) {
        return _records[key].anchoredAt != 0;
    }

    function activeKey(bytes32 projectId, uint8 recordType, bytes32 recordId) external view returns (bytes32) {
        return _activeKeys[logicalKey(projectId, recordType, recordId)];
    }

    function verify(bytes32 key, bytes32 expectedCommitment) external view returns (bool) {
        AnchorRecord storage record = _records[key];
        return record.anchoredAt != 0 && record.commitment == expectedCommitment;
    }
}
