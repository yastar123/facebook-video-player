module.exports = {
  apps: [
    {
      name: 'facebook-video-player-runtime',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'runtime/server.ts',
      cwd: __dirname,
      interpreter: 'node',
      autorestart: true,
      exp_backoff_restart_delay: 1000,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '512M',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
