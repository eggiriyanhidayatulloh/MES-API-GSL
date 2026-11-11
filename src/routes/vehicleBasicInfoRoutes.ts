import { Router } from 'express';
import { vehicleBasicInfoController } from '../controllers/vehicleBasicInfoController';

const router = Router();

// Trigger manual batch sync
router.post('/sync', (req, res) => vehicleBasicInfoController.syncNow(req, res));

// Trigger sync for a specific VIN
router.post('/sync/:vin', (req, res) => vehicleBasicInfoController.syncSingleVin(req, res));

// View recent sync logs
router.get('/logs', (req, res) => vehicleBasicInfoController.getLogs(req, res));

// View JSON payload for a specific VIN
router.get('/payload/:vin', (req, res) => vehicleBasicInfoController.getPayload(req, res));

export default router;
