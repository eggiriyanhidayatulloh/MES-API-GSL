import { Router } from 'express';
import { vehicleOfflineBomController } from '../controllers/vehicleOfflineBomController';

const router = Router();

router.post('/sync', (req, res) => vehicleOfflineBomController.syncNow(req, res));
router.post('/sync/vin/:vin', (req, res) => vehicleOfflineBomController.syncByVin(req, res));
router.post('/sync/:id', (req, res) => vehicleOfflineBomController.syncSingleRecord(req, res));
router.post('/materialize', (req, res) => vehicleOfflineBomController.materialize(req, res));
router.get('/master', (req, res) => vehicleOfflineBomController.getMasterSummary(req, res));
router.get('/logs', (req, res) => vehicleOfflineBomController.getLogs(req, res));
router.get('/payload/:id', (req, res) => vehicleOfflineBomController.getPayload(req, res));

export default router;
