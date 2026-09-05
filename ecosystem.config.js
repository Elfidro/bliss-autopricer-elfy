// Optional pm2 launch config for the autopricer.
//
// This is NOT picked up by `pm2 restart bptf-autopricer` — pm2 keeps the args a
// process was originally started with. To adopt it once:
//
//   pm2 delete bptf-autopricer
//   pm2 start ecosystem.config.js
//   pm2 save
//
// After that the usual deploy (git pull && pm2 restart bptf-autopricer) works
// as before and keeps these settings.
//
// Why the heap cap: on a 64-bit host V8 will happily let the old space grow
// past 1 GB before it collects seriously, so a process that only *needs* a few
// hundred MB still sits on a large resident set. The schema (~20 MB of JSON)
// and the backpack.tf pricelist (~9 MB of JSON) are the only genuinely large
// long-lived objects here; 512 MB leaves ample headroom while making V8 collect
// at a sane point instead of drifting upward. Raise it if you see the process
// exit with "JavaScript heap out of memory".
module.exports = {
  apps: [
    {
      name: 'bptf-autopricer',
      script: 'bptf-autopricer.js',
      node_args: '--max-old-space-size=512',
      // Safety net, not the primary mechanism: a restart here means something
      // leaked, so it sits well above the heap cap. RSS also carries the new
      // space, code space and native buffers (pg, ws), so a heap legitimately
      // at 512 MB can put RSS past 700 MB; 900 MB keeps this a leak-only trip.
      max_memory_restart: '900M',
      watch: false,
      autorestart: true,
    },
  ],
};
