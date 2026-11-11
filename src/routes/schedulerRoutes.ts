import { Router } from 'express';
import { schedulerController } from '../controllers/schedulerController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Endpoint baca detail & config (dapat diakses dengan auth)
router.get('/config', authMiddleware, schedulerController.getConfig.bind(schedulerController));
router.get('/details/:interfaceKey', authMiddleware, schedulerController.getInterfaceDetails.bind(schedulerController));

// Endpoint modifikasi jadwal (memerlukan auth)
router.put('/config/:interfaceKey', authMiddleware, schedulerController.updateConfig.bind(schedulerController));
router.post('/toggle/:interfaceKey', authMiddleware, schedulerController.toggleInterface.bind(schedulerController));
router.post('/global', authMiddleware, schedulerController.setGlobal.bind(schedulerController));

export default router;
