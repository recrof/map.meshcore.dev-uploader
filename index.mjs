import {
  BufferUtils, Packet, Constants,
  NodeJSSerialConnection, TCPConnection,
  Advert
} from '@liamcottle/meshcore.js';

import { KeyPair } from './supercop/index.mjs';
import crypto from 'crypto';
import http from 'http';

const device = process.argv[2] ?? '/dev/ttyACM0';
const apiURL = 'https://map.meshcore.io/api/v1/uploader/node';
const seenAdverts = {};
let clientInfo = {};
let isHealthy = false;
const advertTimeoutMs = parseInt(process.env.ADVERT_TIMEOUT_MS ?? '300000', 10); // milliseconds
let lastAdvertTime = null;

// Wrapper for console methods that adds timestamp
const formatLog = (level, ...args) => {
  const timestamp = new Date().toISOString();
  return [`[${timestamp}] [${level}]`, ...args];
};

const log = (...args) => console.log(...formatLog('INFO', ...args));
const warn = (...args) => console.warn(...formatLog('WARN', ...args));
const error = (...args) => console.error(...formatLog('ERROR', ...args));

// Health check server
http.createServer((req, res) => {
  if (req.url === '/health') {
    if (!isHealthy) {
      res.writeHead(503);
      res.end('Not Ready');
    } else if (lastAdvertTime && Date.now() - lastAdvertTime > advertTimeoutMs) {
      const timeoutSec = Math.floor(advertTimeoutMs / 1000);
      res.writeHead(503);
      res.end(`No adverts received in ${timeoutSec} seconds`);
    } else {
      res.writeHead(200);
      res.end('OK');
    }
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(8080);

const signData = async (kp, data) => {
  const json = JSON.stringify(data);
  const dataHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
  );

  return { data: json, signature: BufferUtils.bytesToHex(await kp.sign(dataHash)) }
}

const processPacket = async (connection, rawPacket) => {
  const packet = Packet.fromBytes(rawPacket);

  if(packet.payload_type_string !== 'ADVERT') return;

  const advert = Advert.fromBytes(packet.payload);
  // console.debug('DEBUG: got advert', advert);
  if(advert.parsed.type === 'CHAT') return;

  const pubKey = BufferUtils.bytesToHex(advert.publicKey);
  const node = { pubKey, name: advert.parsed.name, ts: advert.timestamp, type: advert.parsed.type.toLowerCase() };

  if(!advert.isVerified()) {
    warn('ignoring: signature verification failed', node);
    return;
  }

  if(seenAdverts[pubKey]) {
    if(seenAdverts[pubKey] >= advert.timestamp) {
      warn('ignoring: possible replay attack', node);
      return;
    }
    if(advert.timestamp < seenAdverts[pubKey] + 3600) {
      warn('ignoring: timestamp too new to reupload', node)
      return;
    }
  }

  lastAdvertTime = Date.now();

  log(`uploading`, node);
  const data = {
    params: {
      freq: clientInfo.radioFreq / 1000,
      cr: clientInfo.radioCr,
      sf: clientInfo.radioSf,
      bw: clientInfo.radioBw / 1000
    },
    links: [`meshcore://${BufferUtils.bytesToHex(rawPacket)}`]
  };

  const requestData = await signData(clientInfo.kp, data);
  requestData.publicKey = BufferUtils.bytesToHex(clientInfo.publicKey);

  const req = await fetch(apiURL, {
    method: 'POST',
    body: JSON.stringify(requestData)
  });

  // console.debug('DEBUG: sent request', req);

  log('sending', requestData)
  log(await req.json());

  seenAdverts[pubKey] = advert.timestamp;
}

log(`Connecting to ${device}...`);

let connection;
if(device.startsWith('/') || device.startsWith('COM')){
  connection = new NodeJSSerialConnection(device);
} else {
  const [ host, port ] = device.split(':');
  connection = new TCPConnection(host, port ?? 5000);
}

connection.on('connected', async () => {
  log(`Connected.`);
  isHealthy = true;

  connection.setManualAddContacts();

  clientInfo = await connection.getSelfInfo();
  clientInfo.kp = KeyPair.from({ publicKey: clientInfo.publicKey, secretKey: (await connection.exportPrivateKey()).privateKey });

  log('Map uploader waiting for adverts...');
});

connection.on('disconnected', () => {
  log('Disconnected. Exiting...');
  process.exit(1);
});

connection.on('close', () => {
  log('Connection closed. Exiting...');
  process.exit(1);
});

connection.on('error', (err) => {
  error('Connection error:', err);
  process.exit(1);
});

connection.on(Constants.PushCodes.LogRxData, async (event) => {
  try {
    await processPacket(connection, event.raw);
  }
  catch(e) {
    error(e);
  }
});

await connection.connect();
