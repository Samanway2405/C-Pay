require('dotenv').config();

const StellarSdk = require('@stellar/stellar-sdk');

const NETWORKS = {
  testnet: {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    passphrase: StellarSdk.Networks.TESTNET,
    friendbotUrl: 'https://friendbot.stellar.org',
  },
  public: {
    horizonUrl: 'https://horizon.stellar.org',
    passphrase: StellarSdk.Networks.PUBLIC,
    friendbotUrl: null,
  },
};

const USDC_ISSUERS = {
  testnet: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  public: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
};

function getNetworkConfig() {
  const networkName = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase();
  const preset = NETWORKS[networkName] || NETWORKS.testnet;

  return {
    name: networkName,
    horizonUrl: process.env.STELLAR_HORIZON_URL || preset.horizonUrl,
    passphrase: process.env.STELLAR_NETWORK_PASSPHRASE || preset.passphrase,
    friendbotUrl: preset.friendbotUrl,
    baseFee: process.env.STELLAR_BASE_FEE || StellarSdk.BASE_FEE,
  };
}


function getServer() {
  const { horizonUrl } = getNetworkConfig();
  assertTrustedHorizonUrl(horizonUrl);

  return new StellarSdk.Horizon.Server(horizonUrl, {
    allowHttp: horizonUrl.startsWith('http://'),
  });
}

function assertTrustedHorizonUrl(horizonUrl) {
  const parsed = new URL(horizonUrl);
  const allowCustomHorizon = process.env.ALLOW_CUSTOM_HORIZON === 'true';
  const allowedHosts = new Set([
    'horizon-testnet.stellar.org',
    'horizon.stellar.org',
  ]);

  if (parsed.protocol !== 'https:' && process.env.ALLOW_HTTP_HORIZON !== 'true') {
    throw new Error('Horizon URL must use HTTPS unless ALLOW_HTTP_HORIZON=true');
  }

  if (!allowCustomHorizon && !allowedHosts.has(parsed.hostname)) {
    throw new Error('Custom Horizon hosts require ALLOW_CUSTOM_HORIZON=true');
  }
}

function getAssetConfig() {
  const network = getNetworkConfig();
  const expectedIssuer = network.name === 'public' ? USDC_ISSUERS.public : USDC_ISSUERS.testnet;
  const issuer = process.env.USDC_ASSET_ISSUER || expectedIssuer;

  if (issuer !== expectedIssuer) {
    throw new Error(`USDC_ASSET_ISSUER must be Circle's canonical ${network.name} issuer`);
  }

  return {
    code: 'USDC',
    issuer,
    distribution: process.env.DISTRIBUTION_PUBLIC_KEY || '',
    trustlineLimit: process.env.TRUSTLINE_LIMIT || '1000000000',
  };
}

function getAsset() {
  const { code, issuer } = getAssetConfig();
  if (!code || !issuer) {
    throw new Error('Canonical Circle USDC configuration is required');
  }

  return new StellarSdk.Asset(code, issuer);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

module.exports = {
  StellarSdk,
  getAsset,
  getAssetConfig,
  getNetworkConfig,
  getServer,
  requireEnv,
  USDC_ISSUERS,
};
