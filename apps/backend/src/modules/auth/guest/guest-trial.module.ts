import { Module } from '@nestjs/common';
import { GuestTrialService } from './guest-trial.service.js';

// Transaction-facing accounting has no HTTP, Redis/session or notification providers.
@Module({ providers: [GuestTrialService], exports: [GuestTrialService] })
export class GuestTrialModule {}
