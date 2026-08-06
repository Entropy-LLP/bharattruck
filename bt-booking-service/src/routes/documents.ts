import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { BookingError } from '../lib/types.js'
import * as docsvc from '../lib/documents/service.js'

// ============================================================
// Freight documents — LR / consignment note, tax invoice, e-way bill record.
//
// Registered under the EXISTING /bookings prefix rather than a new one, on
// purpose: bt-gateway already routes /bookings to this service, so this slice
// ships without an edge config change and cannot be half-deployed (routes live,
// gateway not updated). Every path here is new — nothing existing changes shape.
//
// All four are safe against a pre-0024 database: the reads answer "no documents"
// and the writes fail with a 503 naming the missing migration.
// ============================================================

const UuidParamSchema = z.object({ id: z.string().uuid('id must be a valid UUID') })

function handleError(reply: FastifyReply, err: unknown) {
  if (err instanceof BookingError) {
    return reply.status(err.httpStatus).send({ success: false, error: err.message, code: err.code })
  }
  reply.log.error(err, 'Unhandled error in document routes')
  return reply.status(500).send({ success: false, error: 'Internal server error' })
}

function parseId(reply: FastifyReply, params: unknown): string | null {
  const parsed = UuidParamSchema.safeParse(params)
  if (!parsed.success) {
    reply.status(400).send({ success: false, error: parsed.error.errors[0].message, code: 'VALIDATION_ERROR' })
    return null
  }
  return parsed.data.id
}

function parseBody<T>(reply: FastifyReply, schema: z.ZodType<T>, body: unknown): T | null {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.errors[0]
    reply.status(400).send({
      success: false,
      error: `${issue.path.join('.') || 'body'}: ${issue.message}`,
      code: 'VALIDATION_ERROR',
    })
    return null
  }
  return parsed.data
}

export async function documentRoutes(app: FastifyInstance) {

  // GET /bookings/:id/documents — everything on file for the trip.
  app.get('/:id/documents', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    try {
      return reply.send({ success: true, data: await docsvc.getBookingDocuments(id, req.user) })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // POST /bookings/:id/documents/lr — the CARRIER issues the consignment note.
  //
  // 201 on first issue, 200 on a repeat: the RPC is idempotent per booking and
  // returns the document already issued rather than minting a second one, because
  // a document that is already in the consignee's hands is never renumbered.
  app.post('/:id/documents/lr', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    const body = parseBody(reply, docsvc.IssueLorryReceiptBodySchema, req.body)
    if (!body) return
    try {
      const lr = await docsvc.issueLorryReceipt(id, body, req.user)
      return reply.status(201).send({ success: true, data: lr })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // POST /bookings/:id/documents/invoice — the SHIPPER issues their tax invoice,
  // numbered on their own series (never the carrier's).
  app.post('/:id/documents/invoice', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    const body = parseBody(reply, docsvc.IssueInvoiceBodySchema, req.body)
    if (!body) return
    try {
      const invoice = await docsvc.issueFreightInvoice(id, body, req.user)
      return reply.status(201).send({ success: true, data: invoice })
    } catch (err) {
      return handleError(reply, err)
    }
  })

  // POST /bookings/:id/documents/eway-bill — RECORD an externally generated bill
  // (D-17). valid_upto is required in the body and is stored verbatim; there is
  // no code path in this service that computes one.
  app.post('/:id/documents/eway-bill', async (req, reply) => {
    const id = parseId(reply, req.params)
    if (!id) return
    const body = parseBody(reply, docsvc.RecordEwayBillBodySchema, req.body)
    if (!body) return
    try {
      const record = await docsvc.recordEwayBill(id, body, req.user)
      return reply.status(201).send({ success: true, data: record })
    } catch (err) {
      return handleError(reply, err)
    }
  })
}
