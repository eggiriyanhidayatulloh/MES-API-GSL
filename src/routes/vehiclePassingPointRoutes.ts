import { Router } from 'express';
import { vehiclePassingPointController } from '../controllers/vehiclePassingPointController';

const router = Router();

// Trigger manual batch sync
router.post('/sync', (req, res) => vehiclePassingPointController.syncNow(req, res));

// Trigger sync for a specific VIN
router.post('/sync/:vin', (req, res) => vehiclePassingPointController.syncSingleVin(req, res));

// View recent sync logs
router.get('/logs', (req, res) => vehiclePassingPointController.getLogs(req, res));

// View JSON payload for a specific VIN
router.get('/payload/:vin', (req, res) => vehiclePassingPointController.getPayload(req, res));

export default router;
