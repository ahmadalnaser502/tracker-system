/**
 * PM2 ecosystem config.
 * -----------------------------------------------------------------
 * This file defines HOW PM2 runs the app (process name, restart
 * policy, working directory). It does NOT hardcode env values —
 * those live in .env and are loaded by server.js itself via
 * `require("dotenv").config()`. That separation matters: this file
 * is safe to commit to Git; .env (with your actual machine paths)
 * is not — see .gitignore.
 *
 * Usage:
 *   cd D:\tracker-system\backend
 *   pm2 start ecosystem.config.js
 *
 * Common commands afterwards:
 *   pm2 status                        -> list running processes
 *   pm2 logs personal-tracker         -> live log tail
 *   pm2 restart personal-tracker      -> restart after a code change
 *   pm2 monit                         -> live CPU/memory dashboard
 *   pm2 save                          -> persist current process list
 */
module.exports = {
  apps: [
    {
      name: "personal-tracker",
      script: "server.js",
      cwd: __dirname,

      // Restart automatically if the process crashes, but stop
      // trying after repeated rapid failures (avoids a crash loop
      // silently hammering the disk).
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",

      // Watch is OFF by default: this is a long-running personal
      // data server, not a dev server — you don't want it randomly
      // restarting (and losing an in-flight write) because a backup
      // file changed inside the data directory.
      watch: false,
    },
  ],
};
