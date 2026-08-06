// ============================================================
// src/lib/pod/storage.ts
//
// Responsibility: the seam between POD metadata and the WORM object store that
// holds the original photo bytes. Built INERT — it records the intended object
// key and no-ops the actual write with a warning — because the bucket and its
// credentials do not exist yet (BLOCKERS.md B-8). Nothing here invents a secret.
//
// ── WHY GCS, NOT SUPABASE STORAGE ───────────────────────────────────────────
// The compliance spec is specific (INDIA_FREIGHT_COMPLIANCE.md §5.4 server-side):
// the original bytes must sit in "WORM / object-lock, versioned, deletion disabled
// for the retention period." That is a legal requirement, not a nice-to-have — the
// hash and the audit log are only credible if the bytes provably could not be
// swapped after capture.
//
//   * GCS gives true WORM: a bucket RETENTION POLICY plus a locked policy makes
//     objects un-deletable until the retention period elapses, and OBJECT HOLDS
//     pin individual objects — enforced by the platform, not by our code. The
//     retention floor for a POD is years (§8.1), which is exactly what a locked
//     retention policy expresses. The rest of the stack is already GCP Cloud Run
//     in asia-south1, so the trust boundary and the region do not change.
//   * Supabase Storage has no first-class object-lock / immutability guarantee; a
//     service-role key can overwrite or delete an object. For dense breadcrumbs or
//     thumbnails that is fine, but for the one artifact whose entire value is "these
//     bytes cannot have changed," it is the wrong tool.
//
// So the DURABLE LEDGER stays in Supabase Postgres (pod_evidence — where the whole
// schema lives) and the IMMUTABLE BYTES go to a GCS WORM bucket. The server never
// re-encodes the pixels (IT Act s.7(b), §5.4 rule 3): the driver's app PUTs the
// original bytes straight to a resumable/signed GCS URL and posts only metadata
// here, so there is no code path in this service that could recompress them.
// ============================================================

export type EvidenceStorageInput = {
  bookingId: string
  evidenceId: string
  sha256Original: string
  contentType?: string | null
}

export type EvidenceStorageResult = {
  // 'stored' once the bucket is wired; 'no_op' while inert. Mirrors
  // pod_evidence.storage_status so the row records the truth, not an assumption.
  status: 'stored' | 'no_op' | 'failed'
  originalBytesUri: string | null
}

type Logger = { warn(obj: unknown, msg: string): void }

// The one env var that flips this live. Absent (the default everywhere today) →
// inert. Present → the object path is computed but the upload authority is still
// the app's signed PUT; this service only ever records where the bytes belong.
const BUCKET_ENV = 'POD_EVIDENCE_GCS_BUCKET'

// Object key layout: partitioned by booking so a legal hold can be applied per
// trip, and named by the content hash so the same bytes are content-addressable
// and a retry cannot fork into two objects. `.bin` because we never assume — nor
// re-encode to — a specific image format.
function objectKey(bookingId: string, sha256: string): string {
  return `pod/${bookingId}/${sha256}.bin`
}

export interface EvidenceStorage {
  reserve(input: EvidenceStorageInput, log?: Logger): Promise<EvidenceStorageResult>
}

// The production/inert seam. There is exactly ONE implementation on purpose: the
// difference between inert and live is a bucket name in the environment, not a code
// change or a second class to keep in sync (the same shape D-14 used for SMS).
export class GcsEvidenceStorage implements EvidenceStorage {
  async reserve(input: EvidenceStorageInput, log?: Logger): Promise<EvidenceStorageResult> {
    const bucket = process.env[BUCKET_ENV]
    const key = objectKey(input.bookingId, input.sha256Original)

    if (!bucket) {
      // INERT. The metadata write in the caller still happens and is real; the bytes
      // simply have nowhere WORM to live yet. Warn loudly — a POD captured while
      // storage is inert has a durable record but no retained original, and ops must
      // be able to see that in the logs rather than discover it in a dispute.
      log?.warn(
        { booking_id: input.bookingId, evidence_id: input.evidenceId, expected_key: key },
        `POD evidence storage is inert (${BUCKET_ENV} unset) — metadata recorded, original bytes NOT retained (BLOCKERS.md B-8)`,
      )
      return { status: 'no_op', originalBytesUri: null }
    }

    // Live path: return the canonical WORM URI. Uploading the bytes is the app's
    // signed-PUT job (server never touches pixels); a later verifier asserts
    // sha256_received == sha256_original out of band. The gs:// URI is the handle
    // the verifier and any export will resolve.
    return { status: 'stored', originalBytesUri: `gs://${bucket}/${key}` }
  }
}

export function defaultEvidenceStorage(): EvidenceStorage {
  return new GcsEvidenceStorage()
}
