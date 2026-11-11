import crypto from 'crypto';
import { config } from '../config';

export interface AuthTokenPayload {
  username: string;
  role: string;
  exp: number;
}

export function generateToken(username: string): string {
  // Token valid for 7 days
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload: AuthTokenPayload = {
    username,
    role: 'administrator',
    exp,
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.auth.jwtSecret)
    .update(payloadBase64)
    .digest('base64url');

  return `${payloadBase64}.${signature}`;
}

export function verifyToken(token: string): AuthTokenPayload | null {
  if (!token || typeof token !== 'string' || !config.auth.jwtSecret) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [payloadBase64, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', config.auth.jwtSecret)
    .update(payloadBase64)
    .digest('base64url');

  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
    const payload: AuthTokenPayload = JSON.parse(payloadJson);

    if (Date.now() > payload.exp) {
      return null; // Expired
    }

    return payload;
  } catch (err) {
    return null;
  }
}
