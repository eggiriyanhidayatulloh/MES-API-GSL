import cron, { ScheduledTask } from 'node-cron';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';
import { orderBroadcastService } from './orderBroadcastService';
import { vehicleBasicInfoService } from './vehicleBasicInfoService';
import { vehiclePassingPointService } from './vehiclePassingPointService';
import { vehiclePreciseTraceabilityService } from './vehiclePreciseTraceabilityService';
import { vehicleOfflineBomService } from './vehicleOfflineBomService';
import { logCleanupService } from './logCleanupService';

export interface InterfaceScheduleConfig {
  enabled: boolean;
  name: string;
  preset: 'shift_split' | 'every_30m' | 'every_15m' | 'every_1h' | 'custom';
  patterns: string[];
  description: string;
  lastRun?: string;
  lastStatus?: string;
}

export interface SchedulerConfigFile {
  globalEnabled: boolean;
  interfaces: Record<string, InterfaceScheduleConfig>;
}

export const PRESET_PATTERNS = {
  shift_split: {
    patterns: ['*/30 8-19 * * *', '0 20-23,0-7 * * *'],
    description: 'Shift Siang (08:00 - 20:00) per 30 Menit, Shift Malam (20:00 - 08:00) per 1 Jam',
  },
  every_30m: {
    patterns: ['*/30 * * * *'],
    description: 'Setiap 30 Menit (Sepanjang Hari)',
  },
  every_15m: {
    patterns: ['*/15 * * * *'],
    description: 'Setiap 15 Menit (Frekuensi Tinggi)',
  },
  every_1h: {
    patterns: ['0 * * * *'],
    description: 'Setiap 1 Jam Sekali (Menit 00)',
  },
};

export class SchedulerService {
  private configFilePath: string = path.join(process.cwd(), 'config', 'scheduler.json');
  private activeTasks: Map<string, ScheduledTask[]> = new Map();
  private cleanupTask: ScheduledTask | null = null;
  private runningFlags: Map<string, boolean> = new Map();

  private currentConfig: SchedulerConfigFile = {
    globalEnabled: config.scheduler.enabled,
    interfaces: {
      'order-broadcast': {
        enabled: true,
        name: 'Order Broadcast',
        preset: 'shift_split',
        patterns: ['*/30 8-19 * * *', '0 20-23,0-7 * * *'],
        description: 'Shift Siang (08:00 - 20:00) per 30 Menit, Shift Malam (20:00 - 08:00) per 1 Jam',
      },
      'vehicle-basic-info': {
        enabled: true,
        name: 'Vehicle Basic Info',
        preset: 'shift_split',
        patterns: ['*/30 8-19 * * *', '0 20-23,0-7 * * *'],
        description: 'Shift Siang (08:00 - 20:00) per 30 Menit, Shift Malam (20:00 - 08:00) per 1 Jam',
      },
      'vehicle-passing-point': {
        enabled: true,
        name: 'Vehicle Passing Point',
        preset: 'shift_split',
        patterns: ['*/30 8-19 * * *', '0 20-23,0-7 * * *'],
        description: 'Shift Siang (08:00 - 20:00) per 30 Menit, Shift Malam (20:00 - 08:00) per 1 Jam',
      },
      'vehicle-precise-traceability': {
        enabled: true,
        name: 'Vehicle Precise Traceability',
        preset: 'shift_split',
        patterns: ['*/30 8-19 * * *', '0 20-23,0-7 * * *'],
        description: 'Shift Siang (08:00 - 20:00) per 30 Menit, Shift Malam (20:00 - 08:00) per 1 Jam',
      },
      'vehicle-offline-bom': {
        enabled: false,
        name: 'Vehicle Offline BOM',
        preset: 'shift_split',
        patterns: ['*/30 8-19 * * *', '0 20-23,0-7 * * *'],
        description: 'Shift Siang (08:00 - 20:00) per 30 Menit, Shift Malam (20:00 - 08:00) per 1 Jam',
      },
    },
  };

  constructor() {
    this.loadConfiguration();
  }

  /**
   * Membaca konfigurasi scheduler dari file lokal config/scheduler.json
   */
  private loadConfiguration(): void {
    try {
      const dir = path.dirname(this.configFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.configFilePath)) {
        const raw = fs.readFileSync(this.configFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.currentConfig = {
          ...this.currentConfig,
          ...parsed,
          interfaces: {
            ...this.currentConfig.interfaces,
            ...(parsed.interfaces || {}),
          },
        };
        logger.info('Scheduler configuration loaded from config/scheduler.json');
      } else {
        this.saveConfiguration();
      }
    } catch (err) {
      logger.error('Failed to load scheduler configuration, using defaults:', err);
    }
  }

  /**
   * Menyimpan konfigurasi scheduler ke config/scheduler.json
   */
  private saveConfiguration(): void {
    try {
      const dir = path.dirname(this.configFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configFilePath, JSON.stringify(this.currentConfig, null, 2), 'utf-8');
      logger.info('Scheduler configuration saved to config/scheduler.json');
    } catch (err) {
      logger.error('Failed to save scheduler configuration to disk:', err);
    }
  }

  /**
   * Menjalankan scheduler service saat aplikasi boot
   */
  public start(): void {
    // 0. Auto-cleanup logs >90 hari (dijalankan saat boot dan setiap jam 01:00 AM)
    logCleanupService.cleanupOldLogs(90).catch((err) => {
      logger.error('Startup log retention cleanup failed:', err);
    });

    this.cleanupTask = cron.schedule('0 1 * * *', async () => {
      try {
        await logCleanupService.cleanupOldLogs(90);
      } catch (err) {
        logger.error('Scheduled daily log retention cleanup failed:', err);
      }
    });

    // Cek apakah scheduler aktif secara global
    if (!this.currentConfig.globalEnabled && !config.scheduler.enabled) {
      logger.warn('Synchronization scheduler is globally DISABLED (CRON_ENABLED=false). Development mode active.');
      return;
    }

    this.currentConfig.globalEnabled = true;

    // Inisialisasi masing-masing interface
    for (const key of Object.keys(this.currentConfig.interfaces)) {
      this.initInterfaceTasks(key);
    }

    logger.info('Scheduler started successfully. Dynamic jobs initialized.');
  }

  /**
   * Menghentikan semua task scheduler yang sedang aktif
   */
  public stop(): void {
    for (const [key, taskList] of this.activeTasks.entries()) {
      for (const t of taskList) {
        t.stop();
      }
      logger.info(`Stopped scheduled tasks for [${key}]`);
    }
    this.activeTasks.clear();

    if (this.cleanupTask) {
      this.cleanupTask.stop();
      this.cleanupTask = null;
    }
    logger.info('Scheduler fully stopped.');
  }

  /**
   * Memasang cron task untuk suatu interface sesuai pola pattern-nya
   */
  private initInterfaceTasks(interfaceKey: string): void {
    // Hentikan task lama jika ada
    const existing = this.activeTasks.get(interfaceKey);
    if (existing) {
      for (const t of existing) {
        t.stop();
      }
      this.activeTasks.delete(interfaceKey);
    }

    const cfg = this.currentConfig.interfaces[interfaceKey];
    if (!cfg || !cfg.enabled || !this.currentConfig.globalEnabled) {
      logger.info(`Scheduler for interface [${interfaceKey}] is disabled.`);
      return;
    }

    const newTasks: ScheduledTask[] = [];

    for (const pattern of cfg.patterns) {
      if (!pattern || !cron.validate(pattern.trim())) {
        logger.error(`Invalid cron pattern [${pattern}] for interface [${interfaceKey}]. Skipped.`);
        continue;
      }

      const cleanPattern = pattern.trim();
      logger.info(`Registering cron [${cleanPattern}] for interface [${interfaceKey}]...`);

      const task = cron.schedule(cleanPattern, async () => {
        await this.runInterfaceJob(interfaceKey);
      });

      newTasks.push(task);
    }

    this.activeTasks.set(interfaceKey, newTasks);
    logger.info(`Active cron rules for [${interfaceKey}]: ${newTasks.length} task(s).`);
  }

  /**
   * Eksekusi sync batch untuk interface tertentu
   */
  public async runInterfaceJob(interfaceKey: string): Promise<any> {
    if (this.runningFlags.get(interfaceKey)) {
      logger.warn(`Previous job for [${interfaceKey}] is still running. Skipping this iteration.`);
      return { skipped: true, reason: 'Already running' };
    }

    this.runningFlags.set(interfaceKey, true);
    const startTime = Date.now();
    logger.info(`=== [CRON] Starting Sync for [${interfaceKey}] ===`);

    let result: any = null;
    let statusText = 'SUCCESS';

    try {
      if (interfaceKey === 'order-broadcast') {
        result = await orderBroadcastService.syncBatch();
      } else if (interfaceKey === 'vehicle-basic-info') {
        result = await vehicleBasicInfoService.syncBatch();
      } else if (interfaceKey === 'vehicle-passing-point') {
        result = await vehiclePassingPointService.syncBatch();
      } else if (interfaceKey === 'vehicle-precise-traceability') {
        result = await vehiclePreciseTraceabilityService.syncBatch();
      } else if (interfaceKey === 'vehicle-offline-bom') {
        result = await vehicleOfflineBomService.syncBatch();
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(
        `=== [CRON] Finished Sync for [${interfaceKey}] in ${duration}s (Processed: ${result?.totalProcessed || 0}, Success: ${result?.successCount || 0}, Failed: ${result?.failureCount || 0}) ===`
      );
    } catch (error: any) {
      statusText = 'FAILED';
      logger.error(`=== [CRON] Unhandled error during sync for [${interfaceKey}] ===`, error);
    } finally {
      this.runningFlags.set(interfaceKey, false);

      // Update last run info
      const cfg = this.currentConfig.interfaces[interfaceKey];
      if (cfg) {
        cfg.lastRun = new Date().toISOString();
        cfg.lastStatus = statusText;
        this.saveConfiguration();
      }
    }

    return result;
  }

  public isInterfaceEnabled(interfaceKey: string): boolean {
    const cfg = this.currentConfig.interfaces[interfaceKey];
    return Boolean(cfg && cfg.enabled);
  }

  /**
   * Mengambil status dan konfigurasi scheduler seluruh interface
   */
  public getStatus(): SchedulerConfigFile & { taskCounts: Record<string, number> } {
    const taskCounts: Record<string, number> = {};
    for (const key of Object.keys(this.currentConfig.interfaces)) {
      taskCounts[key] = this.activeTasks.get(key)?.length || 0;
    }

    return {
      ...this.currentConfig,
      taskCounts,
    };
  }

  /**
   * Memperbarui konfigurasi jadwal scheduler untuk interface tertentu secara real-time
   */
  public updateInterfaceSchedule(
    interfaceKey: string,
    updates: Partial<InterfaceScheduleConfig>
  ): InterfaceScheduleConfig {
    const cfg = this.currentConfig.interfaces[interfaceKey];
    if (!cfg) {
      throw new Error(`Interface key [${interfaceKey}] not found.`);
    }

    // Update preset patterns jika preset dipilih
    if (updates.preset && updates.preset !== 'custom' && PRESET_PATTERNS[updates.preset]) {
      updates.patterns = PRESET_PATTERNS[updates.preset].patterns;
      updates.description = PRESET_PATTERNS[updates.preset].description;
    }

    // Validasi cron patterns
    if (updates.patterns) {
      for (const p of updates.patterns) {
        if (!cron.validate(p.trim())) {
          throw new Error(`Invalid cron pattern: "${p}". Format must be valid 5-part cron syntax.`);
        }
      }
    }

    // Merge updates
    this.currentConfig.interfaces[interfaceKey] = {
      ...cfg,
      ...updates,
    };

    // Pastikan global scheduler aktif jika user menyalakan interface
    if (updates.enabled) {
      this.currentConfig.globalEnabled = true;
    }

    // Simpan ke disk
    this.saveConfiguration();

    // Reload task secara live
    this.initInterfaceTasks(interfaceKey);

    logger.info(`Scheduler for [${interfaceKey}] successfully updated and reloaded.`);
    return this.currentConfig.interfaces[interfaceKey];
  }

  /**
   * Menyalakan / mematikan scheduler secara global
   */
  public setGlobalEnabled(enabled: boolean): boolean {
    this.currentConfig.globalEnabled = enabled;
    this.saveConfiguration();

    if (enabled) {
      for (const key of Object.keys(this.currentConfig.interfaces)) {
        this.initInterfaceTasks(key);
      }
      logger.info('Global scheduler ENABLED.');
    } else {
      this.stop();
      logger.info('Global scheduler DISABLED.');
    }

    return this.currentConfig.globalEnabled;
  }
}

export const schedulerService = new SchedulerService();
