import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InfrastructureService } from '../infrastructure.service';
import { IntegrationKeyService } from './key.service';
import { AuthService } from '../security/auth.service';
import { digest, seal } from '../security/crypto';
import { fail } from '../security/dto';
import type { EventInput } from './dto';
import { parseConfig } from '../../../packages/config/src';
import {
  enqueueEmail,
  reserveCounter,
  QuotaError,
  renderTemplate,
  utcDay,
} from '../../../packages/email/src/store';
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function permissionValid(input: EventInput) {
  const e = input.communicationEvidence;
  return (
    !!input.communicationPreferences?.emailTransactional &&
    !!e &&
    e.reference === input.externalEventId &&
    Date.parse(e.occurredAt) <= Date.now() + 300000 &&
    Date.parse(e.occurredAt) >= Date.now() - 30 * 86400000
  );
}
@Injectable()
export class EventsService {
  private readonly config = parseConfig(process.env);
  constructor(
    @Inject(InfrastructureService)
    private readonly infra: InfrastructureService,
    @Inject(IntegrationKeyService) private readonly keys: IntegrationKeyService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  async ingest(
    authorization: string | undefined,
    idempotencyKey: string | undefined,
    input: EventInput,
  ) {
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey))
      fail(
        400,
        'IDEMPOTENCY_REQUIRED',
        'Provide an Idempotency-Key of 8-128 letters, digits, dots, colons, underscores or hyphens.',
      );
    const key = await this.keys.authenticate(authorization);
    await this.auth.rate('events-tenant:' + key.tenantId, 60, 60);
    const hash = digest(canonical(input));
    try {
      return await this.infra.database.$transaction(async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Tenant" WHERE "id" = ${key.tenantId}::uuid FOR UPDATE`,
        );
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: key.tenantId },
        });
        if (
          tenant.status === 'SUSPENDED' ||
          (tenant.status === 'TRIAL' && tenant.trialEndsAt <= new Date())
        )
          fail(403, 'TENANT_INACTIVE', 'This business is not active.');
        const previous = await tx.integrationEvent.findFirst({
          where: {
            tenantId: tenant.id,
            environment: key.environment,
            OR: [
              { idempotencyKey },
              { externalEventId: input.externalEventId },
            ],
          },
          include: {
            email: { select: { id: true, status: true, errorCode: true } },
          },
        });
        if (previous) {
          if (
            previous.payloadHash !== hash ||
            previous.externalEventId !== input.externalEventId
          )
            fail(
              409,
              'IDEMPOTENCY_CONFLICT',
              'The key or external event ID was already used with a different payload.',
            );
          return {
            success: true,
            eventId: previous.id,
            status: 'accepted',
            duplicate: true,
            email: previous.email,
            decision: previous.emailDecision,
          };
        }
        await reserveCounter(
          tx,
          'events:' + tenant.id + ':' + utcDay(),
          this.config.EVENTS_TENANT_PER_DAY,
        );
        const permitted = permissionValid(input);
        const contact = await tx.contact.upsert({
          where: {
            tenantId_email: { tenantId: tenant.id, email: input.contact.email },
          },
          create: {
            tenantId: tenant.id,
            ...input.contact,
            transactionalAllowed: permitted,
            permissionEvidence: input.communicationEvidence ?? Prisma.JsonNull,
          },
          update: {
            name: input.contact.name,
            phone: input.contact.phone,
            transactionalAllowed: permitted,
            permissionEvidence: input.communicationEvidence ?? Prisma.JsonNull,
          },
        });
        const settings = await tx.emailAutomation.findUnique({
          where: { tenantId: tenant.id },
        });
        const suppressed = await tx.emailSuppression.findUnique({
          where: {
            tenantId_emailHash: {
              tenantId: tenant.id,
              emailHash: digest(input.contact.email),
            },
          },
        });
        let decision = !settings?.enabled
          ? 'AUTOMATION_DISABLED'
          : !settings.enabledEvents.includes(input.event)
            ? 'TRIGGER_DISABLED'
            : !permitted
              ? 'TRANSACTIONAL_PERMISSION_REQUIRED'
              : suppressed
                ? 'RECIPIENT_SUPPRESSED'
                : 'EMAIL_QUEUED';
        const event = await tx.integrationEvent.create({
          data: {
            tenantId: tenant.id,
            environment: key.environment,
            externalEventId: input.externalEventId,
            idempotencyKey,
            payloadHash: hash,
            eventType: input.event,
            encryptedPayload: seal(
              JSON.stringify(input),
              this.config.AUTH_JWT_SECRET!,
              'event-payload',
            ),
            contactId: contact.id,
            emailDecision: decision,
          },
        });
        let email = null;
        if (decision === 'EMAIL_QUEUED' && settings) {
          const vars = {
            businessName: tenant.name,
            contactName: contact.name,
            reference: input.externalEventId,
          };
          const created = await enqueueEmail(
            tx,
            {
              tenantId: tenant.id,
              integrationEventId: event.id,
              purpose: 'ACK',
              to: contact.email,
              subject: renderTemplate(settings.subject, vars),
              text: renderTemplate(settings.body, vars),
            },
            this.config,
          );
          email = {
            id: created.id,
            status: created.status,
            errorCode: created.errorCode,
          };
          if (created.status === 'SUPPRESSED') {
            decision = created.errorCode ?? 'SUPPRESSED';
            await tx.integrationEvent.update({
              where: { id: event.id },
              data: { emailDecision: decision },
            });
          }
        }
        await tx.auditLog.create({
          data: {
            tenantId: tenant.id,
            actorId: 'api-key:' + key.id,
            resourceId: event.id,
            action: 'event.accepted',
          },
        });
        return {
          success: true,
          eventId: event.id,
          status: 'accepted',
          duplicate: false,
          email,
          decision,
        };
      });
    } catch (e) {
      if (e instanceof QuotaError)
        fail(
          429,
          'EVENT_QUOTA_EXCEEDED',
          'Daily accepted-event allowance exceeded.',
        );
      throw e;
    }
  }
  async receipt(authorization: string | undefined, id: string) {
    const key = await this.keys.authenticate(authorization);
    const event = await this.infra.database.integrationEvent.findFirst({
      where: { id, tenantId: key.tenantId, environment: key.environment },
      select: {
        id: true,
        eventType: true,
        emailDecision: true,
        createdAt: true,
        email: {
          select: {
            id: true,
            status: true,
            errorCode: true,
            attemptCount: true,
            acceptedAt: true,
            followUp: {
              select: {
                id: true,
                status: true,
                scheduledAt: true,
                errorCode: true,
              },
            },
          },
        },
      },
    });
    if (!event) fail(404, 'NOT_FOUND', 'Event not found.');
    return {
      success: true,
      eventId: event.id,
      eventType: event.eventType,
      decision: event.emailDecision,
      email: event.email,
      createdAt: event.createdAt,
    };
  }
}
