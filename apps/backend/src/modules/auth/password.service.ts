import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { randomBytes } from 'node:crypto';

@Injectable()
export class PasswordService {
  private readonly dummy = this.hash(randomBytes(32).toString('hex'));
  hash(password: string) {
    return hash(password, { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  }
  async matches(password: string, passwordHash?: string) {
    try {
      return (await verify(passwordHash ?? (await this.dummy), password)) && Boolean(passwordHash);
    } catch {
      return false;
    }
  }
}
