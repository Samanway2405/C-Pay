const {
  StellarSdk,
  getAsset,
  getAssetConfig,
  getNetworkConfig,
  getServer,
  requireEnv,
} = require('../src/config');

async function fundWithFriendbot(publicKey) {
  const { friendbotUrl } = getNetworkConfig();
  if (!friendbotUrl) return;

  const response = await fetch(`${friendbotUrl}?addr=${encodeURIComponent(publicKey)}`);
  if (!response.ok && response.status !== 400) {
    throw new Error(`Friendbot funding failed for ${publicKey}: ${await response.text()}`);
  }
}

async function main() {
  const distribution = StellarSdk.Keypair.fromSecret(requireEnv('DISTRIBUTION_SECRET'));
  const assetConfig = getAssetConfig();
  const asset = getAsset();
  const network = getNetworkConfig();
  const server = getServer();

  if (assetConfig.distribution && assetConfig.distribution !== distribution.publicKey()) {
    throw new Error('DISTRIBUTION_PUBLIC_KEY does not match DISTRIBUTION_SECRET');
  }

  await fundWithFriendbot(distribution.publicKey());
  const account = await server.loadAccount(distribution.publicKey());
  const hasTrustline = account.balances.some(
    balance => balance.asset_code === asset.code && balance.asset_issuer === asset.issuer,
  );

  if (!hasTrustline) {
    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: network.baseFee,
      networkPassphrase: network.passphrase,
    })
      .addOperation(StellarSdk.Operation.changeTrust({
        asset,
        limit: assetConfig.trustlineLimit,
      }))
      .setTimeout(60)
      .build();

    transaction.sign(distribution);
    const result = await server.submitTransaction(transaction);
    console.log(`USDC trustline created: ${result.hash}`);
  } else {
    console.log('USDC trustline already exists.');
  }

  console.log(`USDC_ASSET_ISSUER=${asset.issuer}`);
  console.log(`DISTRIBUTION_PUBLIC_KEY=${distribution.publicKey()}`);
  if (network.name === 'testnet') {
    console.log('Fund testnet USDC from Circle Faucet: https://faucet.circle.com');
  } else {
    console.log('Fund this account through an approved Circle/on-ramp flow before enabling distribution.');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
