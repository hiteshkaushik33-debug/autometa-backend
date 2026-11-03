import type { OutboundEmail, Prisma } from '@prisma/client';
import type { Config } from '../../config/src';
import { enqueueEmail } from './store';
// Runs in the same transaction as recording ACK acceptance. One child per ACK.
export async function scheduleFollowUp(
  tx: Prisma.TransactionClient,
  parent: OutboundEmail,
  acceptedAt: Date,
  config: Config,
) {
  if (
    parent.purpose !== 'ACK' ||
    !parent.tenantId ||
    !parent.integrationEventId ||
    !config.EMAIL_FOLLOW_UP_ENABLED
  )
    return;
  const settings = await tx.emailAutomation.findUnique({
    where: { tenantId: parent.tenantId },
  });
  if (!settings?.enabled || !settings.followUpEnabled) return;
  const event = await tx.integrationEvent.findFirst({
    where: { id: parent.integrationEventId, tenantId: parent.tenantId },
    include: { contact: true, tenant: true },
  });
  if (
    !event ||
    !settings.enabledEvents.includes(event.eventType) ||
    !event.contact.transactionalAllowed
  )
    return;
  if (
    await tx.outboundEmail.findUnique({ where: { parentEmailId: parent.id } })
  )
    return;
  const scheduledAt = new Date(
    acceptedAt.getTime() + config.EMAIL_FOLLOW_UP_DELAY_SECONDS * 1000,
  );
  await enqueueEmail(
    tx,
    {
      tenantId: parent.tenantId,
      parentEmailId: parent.id,
      purpose: 'FOLLOW_UP',
      billingCostPaise: parent.billingCostPaise ?? 0,
      to: parent.recipient,
      subject: ('Following up on your message to ' + event.tenant.name).slice(
        0,
        180,
      ),
      text:
        'Hi ' +
        event.contact.name +
        ',\n\nDo you still need help with your inquiry at ' +
        event.tenant.name +
        '? Please contact the team through the original website if you need further assistance.\n\nReference: ' +
        event.externalEventId +
        '\n\nThis is an automated follow-up.',
      scheduledAt,
      expiresAt: new Date(scheduledAt.getTime() + 86400000),
    },
    {
      ...config,
      MAIL_PROVIDER: parent.provider as Config['MAIL_PROVIDER'],
      MAIL_FROM: parent.sender,
    },
  );
}
