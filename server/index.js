'use strict';

const http = require('node:http');
const { createApp } = require('./app');
const { bootstrapAdmin } = require('./auth');
const realtime = require('./realtime');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

bootstrapAdmin();
const server = http.createServer(createApp());
realtime.setup(server);
server.listen(PORT, HOST, () => {
  console.log(`Bureau des enquêteurs disponible sur http://localhost:${PORT}`);
});
