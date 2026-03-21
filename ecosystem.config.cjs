/**
 * DR-04: PM2 ecosystem config — automated restart on crash, OOM, or health failure.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs           # start
 *   pm2 reload ecosystem.config.cjs          # zero-downtime reload
 *   pm2 stop ems-backend                     # stop
 *   pm2 logs ems-backend                     # tail logs
 *   pm2 save && pm2 startup                  # persist across reboots
 *
 * Health check integration:
 *   PM2 does not natively poll HTTP endpoints. The built-in health watchdog
 *   (services/healthWatchdog.js) monitors DB/Redis internally and calls
 *   process.exit(1) when a critical dependency is unreachable for too long,
 *   which PM2 catches and restarts automatically.
 */

module.exports = {
  apps: [
    {
      name: 'ems-backend',
      script: 'start.js',

      // ── Process model ─────────────────────────────────────────────────────
      // Fork mode (not cluster) because Socket.IO uses a Redis adapter for
      // multi-instance broadcasting. Horizontal scaling is handled at the
      // Docker/Render layer, not via PM2 cluster mode.
      instances: 1,
      exec_mode: 'fork',

      // ── Restart policy ────────────────────────────────────────────────────
      // Restart immediately on crash; backoff prevents restart storms.
      autorestart: true,
      max_restarts: 15,       // Give up after 15 rapid restarts (prevents infinite loop)
      min_uptime: '15s',      // A restart counts only if the process lived < 15 s
      restart_delay: 3000,    // Wait 3 s before restarting after a crash
      exp_backoff_restart_delay: 200, // Exponential backoff: 200 ms → 400 → 800 → … → 15 s cap

      // ── Memory guard ─────────────────────────────────────────────────────
      // Restart the process if heap exceeds this limit — guards against
      // memory leaks accumulating until OOM kills the container.
      max_memory_restart: '512M',

      // ── Environment ───────────────────────────────────────────────────────
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },

      // ── Logging ───────────────────────────────────────────────────────────
      // Write structured JSON logs from pino to a rotating file.
      // Log rotation is delegated to pm2-logrotate or a system log rotator.
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // ── Graceful shutdown ─────────────────────────────────────────────────
      // Give the process up to 10 s to finish in-flight requests before SIGKILL.
      kill_timeout: 10000,
      listen_timeout: 8000,

      // ── Watch (dev only) ──────────────────────────────────────────────────
      // Disable file-watching in production — changes are deployed, not hot-reloaded.
      watch: false,
      ignore_watch: ['node_modules', 'logs', '.git'],
    },
  ],
};
