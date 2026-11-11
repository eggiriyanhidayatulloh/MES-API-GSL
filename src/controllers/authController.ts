import { Request, Response } from 'express';
import { config } from '../config';
import { generateToken, verifyToken } from '../utils/auth';
import { logger } from '../utils/logger';

export class AuthController {
  public async login(req: Request, res: Response): Promise<void> {
    try {
      const { username, password } = req.body;

      if (!config.auth.password || !config.auth.jwtSecret) {
        res.status(500).json({
          success: false,
          message: 'Server authentication is not configured. Set AUTH_PASSWORD and JWT_SECRET in .env.',
        });
        return;
      }

      if (!username || !password) {
        res.status(400).json({
          success: false,
          message: 'Username and password are required.',
        });
        return;
      }

      const isValidUser = username.trim().toLowerCase() === config.auth.username.toLowerCase();
      const isValidPass = password === config.auth.password;

      if (!isValidUser || !isValidPass) {
        logger.warn(`Failed login attempt for username: [${username}] from IP: ${req.ip}`);
        res.status(401).json({
          success: false,
          message: 'Invalid username or password.',
        });
        return;
      }

      const token = generateToken(config.auth.username);
      logger.info(`User [${config.auth.username}] logged in successfully.`);

      res.status(200).json({
        success: true,
        message: 'Login successful.',
        data: {
          token,
          user: {
            username: config.auth.username,
            role: 'Administrator',
          },
        },
      });
    } catch (error: any) {
      logger.error('Error during login:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Internal server error',
      });
    }
  }

  public async verify(req: Request, res: Response): Promise<void> {
    const authHeader = req.headers.authorization;
    let token = '';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (req.query && typeof req.query.token === 'string') {
      token = req.query.token;
    }

    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({
        success: false,
        authenticated: false,
        message: 'Session is invalid or expired.',
      });
      return;
    }

    res.status(200).json({
      success: true,
      authenticated: true,
      data: {
        username: payload.username,
        role: payload.role,
        expiresAt: new Date(payload.exp).toISOString(),
      },
    });
  }

  public async logout(_req: Request, res: Response): Promise<void> {
    res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  }
}

export const authController = new AuthController();
