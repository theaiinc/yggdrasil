import * as os from 'os';

import type { SystemResources } from '../types/index.js';

/**
 * Collects system resource metrics (CPU load, memory usage, uptime).
 *
 * CPU percent is computed over a sampling interval by measuring the delta
 * in idle time across two snapshots.
 */
export class ResourceCollector {
  private prevIdle = 0;
  private prevTotal = 0;
  private readonly sampleIntervalMs: number;

  constructor(sampleIntervalMs: number = 1000) {
    this.sampleIntervalMs = sampleIntervalMs;
    // Initial sample to establish baseline
    const { idle, total } = this.cpuTimes();
    this.prevIdle = idle;
    this.prevTotal = total;
  }

  /**
   * Gather a snapshot of current system resources.
   */
  async collect(): Promise<SystemResources> {
    const loadAvg = os.loadavg();
    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const memUsed = memTotal - memFree;

    const cpuPercent = await this.sampleCpuPercent();

    return {
      cpu: {
        load1: loadAvg[0] ?? 0,
        load5: loadAvg[1] ?? 0,
        load15: loadAvg[2] ?? 0,
        cpus: os.cpus().length,
        percent: cpuPercent,
      },
      memory: {
        total: memTotal,
        used: memUsed,
        free: memFree,
        percent: Math.round((memUsed / memTotal) * 10000) / 100,
      },
      uptime: Math.floor(os.uptime()),
    };
  }

  /**
   * Sample CPU usage by measuring idle/total delta over an interval.
   */
  private async sampleCpuPercent(): Promise<number> {
    const { idle, total } = this.cpuTimes();
    const idleDelta = idle - this.prevIdle;
    const totalDelta = total - this.prevTotal;

    this.prevIdle = idle;
    this.prevTotal = total;

    if (totalDelta === 0) return 0;
    return Math.round((1 - idleDelta / totalDelta) * 10000) / 100;
  }

  /**
   * Sum CPU times across all cores.
   */
  private cpuTimes(): { idle: number; total: number } {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
      idle += cpu.times.idle;
    }

    return { idle, total };
  }
}
