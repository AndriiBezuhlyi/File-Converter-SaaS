import type { Prisma } from '../../../generated/prisma/client.js';

export type GuestPrincipal = { kind: 'guest'; guestSessionId: string; tokenHash: string };
export type GuestSessionDto = {
  trialState: 'available' | 'reserved' | 'consumed';
  activeConversionId: string | null;
};
export type GuestTransaction = Prisma.TransactionClient;
