import { Router } from 'express';
import { authController } from '../controllers/authController';

const router = Router();

router.post('/login', authController.login.bind(authController));
router.get('/verify', authController.verify.bind(authController));
router.post('/logout', authController.logout.bind(authController));

export default router;
