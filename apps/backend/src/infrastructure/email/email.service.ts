import { Inject, Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool/index.js';
import { INFRA_CONFIG, type InfrastructureEnvironment } from '../config/infrastructure-config.js';
import type { InfrastructureDependency } from '../dependency.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class EmailService implements InfrastructureDependency {
  readonly transport;
  constructor(@Inject(INFRA_CONFIG) private readonly config: InfrastructureEnvironment) {
    const options: SMTPPool.Options = {
      pool: true,
      maxConnections: 2,
      maxMessages: 100,
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      requireTLS: config.SMTP_REQUIRE_TLS,
      connectionTimeout: config.INFRA_TIMEOUT_MS,
      greetingTimeout: config.INFRA_TIMEOUT_MS,
      socketTimeout: config.INFRA_TIMEOUT_MS,
      dnsTimeout: config.INFRA_TIMEOUT_MS,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
      ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } } : {}),
    };
    this.transport = nodemailer.createTransport(options);
  }
  async start() {
    await this.check();
  }
  async check() {
    await this.transport.verify();
  }
  async send(message: EmailMessage) {
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(message.to) || /[\r\n]/.test(message.subject))
      throw new Error('Invalid email envelope.');
    try {
      await this.transport.sendMail({
        from: this.config.SMTP_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html !== undefined ? { html: message.html } : {}),
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    } catch {
      throw new Error('Email delivery failed.');
    }
  }
  stop() {
    this.transport.close();
  }
}
