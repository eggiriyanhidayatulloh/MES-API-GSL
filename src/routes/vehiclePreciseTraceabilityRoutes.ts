import { Router } from 'express';
import { vehiclePreciseTraceabilityController } from '../controllers/vehiclePreciseTraceabilityController';

const router = Router();

// Trigger manual batch sync
router.post('/sync', (req, res) => vehiclePreciseTraceabilityController.syncNow(req, res));

// Trigger sync for a specific VIN
router.post('/sync/:vin', (req, res) => vehiclePreciseTraceabilityController.syncSingleVin(req, res));

// View recent sync logs
router.get('/logs', (req, res) => vehiclePreciseTraceabilityController.getLogs(req, res));

// View JSON payload for a specific VIN
router.get('/payload/:vin', (req, res) => vehiclePreciseTraceabilityController.getPayload(req, res));

export default router;
