// Generates an Ed25519 key pair for signing audit anchors. Store the private key in the bank's vault and give the
// platform only AUDIT_ANCHOR_SIGNING_PRIVATE_KEY; give auditors / the verifier AUDIT_ANCHOR_PUBLIC_KEY.
import { generateKeyPairSync } from 'node:crypto';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
console.log('AUDIT_ANCHOR_SIGNING_PRIVATE_KEY=' + JSON.stringify(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim()));
console.log('AUDIT_ANCHOR_PUBLIC_KEY=' + JSON.stringify(publicKey.export({ type: 'spki', format: 'pem' }).toString().trim()));
