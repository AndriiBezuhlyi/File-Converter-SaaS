import {
  AuthRequestError,
  type AuthGateway,
  type AuthSession,
} from '../src/features/auth/lib/auth-gateway';
import { wait } from './gateway';

// Controlled responses, never a credential store or authentication implementation.
export class FixtureAuthGateway implements AuthGateway {
  readonly scope = 'fixture-auth';
  readonly calls: Record<string, number> = {};
  private session: AuthSession;
  constructor(readonly scenario: string) {
    this.session =
      scenario === 'signed-in' || scenario === 'logout-error'
        ? { kind: 'authenticated', email: 'reader@example.test' }
        : { kind: 'anonymous' };
  }
  async readSession(signal: AbortSignal) {
    await wait(20, signal);
    this.count('session');
    if (this.scenario === 'session-error' && this.calls.session === 1)
      throw new AuthRequestError('network');
    return this.session;
  }
  async register() {
    await this.request('register');
  }
  async signIn() {
    await this.request('login');
    if (this.scenario === 'invalid-credentials') throw new AuthRequestError('invalid-credentials');
    if (this.scenario === 'unverified') return 'verification-required' as const;
    this.session = { kind: 'authenticated', email: 'reader@example.test' };
    return 'signed-in' as const;
  }
  async signOut() {
    await this.request('logout');
    if (this.scenario === 'logout-error' && this.calls.logout === 1)
      throw new AuthRequestError('network');
    this.session = { kind: 'anonymous' };
  }
  async resendVerification() {
    await this.request('resend');
  }
  async verifyEmail(token: string) {
    await this.request('verify');
    if (token !== 'fixture-token') throw new AuthRequestError('invalid-token');
  }
  async requestPasswordReset() {
    await this.request('recovery');
  }
  async resetPassword(token: string) {
    await this.request('reset');
    if (token !== 'fixture-token') throw new AuthRequestError('invalid-token');
    this.session = { kind: 'anonymous' };
  }
  private count(operation: string) {
    this.calls[operation] = (this.calls[operation] ?? 0) + 1;
  }
  private async request(operation: string) {
    this.count(operation);
    await wait(400);
    if (this.scenario === 'network') throw new AuthRequestError('network');
    if (this.scenario === 'rate-limited') throw new AuthRequestError('rate-limited');
  }
}
