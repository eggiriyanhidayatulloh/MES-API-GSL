import { Router } from 'express';
import { orderBroadcastController } from '../controllers/orderBroadcastController';

const router = Router();

// Trigger manual batch sync
router.post('/sync', (req, res) => orderBroadcastController.syncNow(req, res));

// Trigger sync for a specific VIN
router.post('/sync/:vin', (req, res) => orderBroadcastController.syncSingleVin(req, res));

// View recent sync logs
router.get('/logs', (req, res) => orderBroadcastController.getLogs(req, res));

// View JSON payload for a specific VIN
router.get('/payload/:vin', (req, res) => orderBroadcastController.getPayload(req, res));

export default router;
