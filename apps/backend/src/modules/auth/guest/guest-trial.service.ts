import { Injectable } from '@nestjs/common';
import type { GuestSession, Prisma } from '../../../generated/prisma/client.js';
import { AuthError } from '../auth-error.js';
import { GUEST_ADMISSION_WINDOW_MS, GUEST_RESULT_WINDOW_MS } from './guest-config.js';
import { guestConflict, invalidGuest } from './guest-error.js';
import type { GuestPrincipal, GuestTransaction } from './guest.types.js';

@Injectable()
export class GuestTrialService {
  private async lock(tx: GuestTransaction, id: string): Promise<GuestSession> {
    await tx.$queryRaw`SELECT "id" FROM "GuestSession" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const guest = await tx.guestSession.findUnique({ where: { id } });
    if (!guest) throw invalidGuest();
    return guest;
  }
  private async now(tx: GuestTransaction) {
    const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    return row!.now;
  }
  // Caller owns this short transaction. Callback performs database work only: input, queued job and dispatch intent.
  async reserve<T extends { id: string }>(
    tx: GuestTransaction,
    principal: GuestPrincipal,
    accept: (tx: GuestTransaction, guest: GuestSession) => Promise<T>,
  ): Promise<T> {
    const guest = await this.lock(tx, principal.guestSessionId);
    const now = await this.now(tx);
    if (guest.tokenHash !== principal.tokenHash || guest.credentialExpiresAt <= now)
      throw invalidGuest();
    if (guest.trialState === 'consumed')
      throw new AuthError(
        401,
        'GUEST_CONVERSION_LIMIT_REACHED',
        'Sign in to convert another file.',
      );
    if (guest.trialState === 'reserved')
      throw new AuthError(
        409,
        'GUEST_CONVERSION_IN_PROGRESS',
        'A guest conversion is already in progress.',
      );
    if (guest.credentialExpiresAt.getTime() - now.getTime() < GUEST_ADMISSION_WINDOW_MS)
      throw invalidGuest();
    const accepted = await accept(tx, guest);
    const conversion = await tx.conversion.findUnique({ where: { id: accepted.id } });
    const dispatch = await tx.backgroundTask.findFirst({
      where: { type: 'conversion_dispatch', resourceId: accepted.id },
      select: { id: true },
    });
    if (
      !conversion ||
      conversion.guestSessionId !== guest.id ||
      conversion.userId ||
      conversion.saveResult ||
      conversion.status !== 'queued' ||
      !dispatch
    )
      throw guestConflict();
    await tx.guestSession.update({
      where: { id: guest.id },
      data: { trialState: 'reserved', reservedConversionId: accepted.id },
    });
    return accepted;
  }
  // Always take the guest lock BEFORE the conversion lock. Future workers publish/fail conditionally inside work.
  async settle<T>(
    tx: GuestTransaction,
    guestSessionId: string,
    conversionId: string,
    expected: { processingVersion: number; leaseToken: string | null },
    work: (tx: GuestTransaction, guest: GuestSession) => Promise<T>,
  ): Promise<T | undefined> {
    return this.transition(tx, guestSessionId, conversionId, expected, work, 'active');
  }
  // Only a reconciler may recover an expired processing lease; it can fail/requeue, never publish success.
  async reconcileExpired<T>(
    tx: GuestTransaction,
    guestSessionId: string,
    conversionId: string,
    expected: { processingVersion: number; leaseToken: string | null },
    work: (tx: GuestTransaction, guest: GuestSession) => Promise<T>,
  ): Promise<T | undefined> {
    return this.transition(tx, guestSessionId, conversionId, expected, work, 'expired');
  }
  private async transition<T>(
    tx: GuestTransaction,
    guestSessionId: string,
    conversionId: string,
    expected: { processingVersion: number; leaseToken: string | null },
    work: (tx: GuestTransaction, guest: GuestSession) => Promise<T>,
    mode: 'active' | 'expired',
  ): Promise<T | undefined> {
    const guest = await this.lock(tx, guestSessionId);
    await tx.$queryRaw`SELECT "id" FROM "Conversion" WHERE "id" = ${conversionId}::uuid FOR UPDATE`;
    const conversion = await tx.conversion.findUnique({ where: { id: conversionId } });
    if (!conversion || conversion.guestSessionId !== guest.id || conversion.userId)
      throw guestConflict();
    if (conversion.status === 'completed' || conversion.status === 'failed') return undefined;
    if (
      guest.trialState !== 'reserved' ||
      guest.reservedConversionId !== conversionId ||
      conversion.processingVersion !== expected.processingVersion ||
      conversion.leaseToken !== expected.leaseToken
    )
      throw guestConflict();
    const startedAt = await this.now(tx);
    if (mode === 'expired') {
      if (
        conversion.status !== 'processing' ||
        !conversion.leaseToken ||
        !conversion.leaseExpiresAt ||
        conversion.leaseExpiresAt > startedAt
      )
        throw guestConflict();
    } else if (
      conversion.status === 'processing' &&
      (!conversion.leaseToken ||
        !conversion.leaseExpiresAt ||
        conversion.leaseExpiresAt <= startedAt)
    )
      throw guestConflict();
    const value = await work(tx, guest);
    const outcome = await tx.conversion.findUniqueOrThrow({ where: { id: conversionId } });
    const now = await this.now(tx);
    if (
      mode === 'active' &&
      conversion.status === 'processing' &&
      conversion.leaseExpiresAt! <= now
    )
      throw guestConflict();
    if (outcome.status === 'completed') {
      if (
        mode === 'expired' ||
        conversion.status !== 'processing' ||
        !conversion.leaseToken ||
        !conversion.leaseExpiresAt ||
        conversion.leaseExpiresAt <= now
      )
        throw guestConflict();
      const result = outcome.resultFileId
        ? await tx.file.findUnique({ where: { id: outcome.resultFileId } })
        : null;
      if (
        !outcome.completedAt ||
        outcome.completedAt < startedAt ||
        outcome.completedAt > now ||
        !result ||
        result.guestSessionId !== guest.id ||
        result.userId ||
        result.purpose !== 'output' ||
        result.retention !== 'temporary' ||
        !result.expiresAt ||
        result.expiresAt <= now ||
        result.deletedAt ||
        result.storageDeletionState !== 'present' ||
        result.expiresAt.getTime() !== outcome.completedAt.getTime() + GUEST_RESULT_WINDOW_MS ||
        guest.credentialExpiresAt.getTime() < now.getTime() + GUEST_RESULT_WINDOW_MS ||
        result.expiresAt > guest.credentialExpiresAt
      )
        throw guestConflict();
      await tx.guestSession.update({
        where: { id: guest.id },
        data: {
          trialState: 'consumed',
          reservedConversionId: null,
          consumedAt: outcome.completedAt,
        },
      });
    } else if (
      outcome.status === 'failed' &&
      guest.trialState === 'reserved' &&
      guest.reservedConversionId === conversionId
    ) {
      await tx.guestSession.update({
        where: { id: guest.id },
        data: { trialState: 'available', reservedConversionId: null },
      });
    }
    return value;
  }
  // Restricted lookup for future status/download adapters; an account ID never substitutes for this capability.
  async ownedConversion(
    tx: Prisma.TransactionClient,
    principal: GuestPrincipal,
    conversionId: string,
  ) {
    const [valid] = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "GuestSession" WHERE "id" = ${principal.guestSessionId}::uuid AND "tokenHash" = ${principal.tokenHash} AND "credentialExpiresAt" > clock_timestamp()`;
    if (!valid) throw invalidGuest();
    const conversion = await tx.conversion.findFirst({
      where: { id: conversionId, guestSessionId: valid.id, userId: null },
    });
    if (!conversion) throw new AuthError(404, 'NOT_FOUND', 'Conversion not found.');
    return conversion;
  }
}
