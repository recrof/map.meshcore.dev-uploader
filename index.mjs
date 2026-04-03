import {
  BufferUtils, Packet, Constants,
  NodeJSSerialConnection, TCPConnection,
  Advert
} from '@liamcottle/meshcore.js';

import { KeyPair } from './supercop/index.mjs';
import crypto from 'crypto';

const device = process.argv[2] ?? '/dev/ttyACM0';
const apiURL = 'https://map.meshcore.io/api/v1/uploader/node';
const seenAdverts = {};
let clientInfo = {};

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
    console.warn('ignoring: signature verification failed', node);
    return;
  }

  if(seenAdverts[pubKey]) {
    if(seenAdverts[pubKey] >= advert.timestamp) {
      console.warn('ignoring: possible replay attack', node);
      return;
    }
    if(advert.timestamp < seenAdverts[pubKey] + 3600) {
      console.warn('ignoring: timestamp too new to reupload', node)
      return;
    }
  }

  console.log(`uploading`, node);
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

  console.log('sending', requestData)
  console.log(await req.json());

  seenAdverts[pubKey] = advert.timestamp;
}

console.log(`Connecting to ${device}...`);

let connection;
if(device.startsWith('/') || device.startsWith('COM')){
  connection = new NodeJSSerialConnection(device);
} else {
  const [ host, port ] = device.split(':');
  connection = new TCPConnection(host, port ?? 5000);
}

connection.on('connected', async () => {
  console.log(`Connected.`);

  connection.setManualAddContacts();

  clientInfo = await connection.getSelfInfo();
  clientInfo.kp = KeyPair.from({ publicKey: clientInfo.publicKey, secretKey: (await connection.exportPrivateKey()).privateKey });

  console.log('Map uploader waiting for adverts...');
});

connection.on(Constants.PushCodes.LogRxData, async (event) => {
  try {
    await processPacket(connection, event.raw);
  }
  catch(e) {
    console.error(e);
  }
});

await connection.connect();
