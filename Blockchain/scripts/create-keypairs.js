const { StellarSdk } = require('../src/config');

function printKeypair(label) {
  const keypair = StellarSdk.Keypair.random();

  console.log(`${label}_PUBLIC_KEY=${keypair.publicKey()}`);
  console.log(`${label}_SECRET=${keypair.secret()}`);
  console.log('');
}

console.log('# Store secrets only in backend/server environments.');
console.log('# Public keys can be used by the app and database.');
console.log('');

printKeypair('SPONSOR');
printKeypair('DISTRIBUTION');
