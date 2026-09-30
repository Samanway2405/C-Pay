const { StellarSdk } = require('../src/config');
const {
  assertAmount,
  buildFeeBumpTransaction,
  isValidPublicKey,
  isValidSecret,
} = require('../src/stellarRail');

describe('stellarRail validation', () => {
  test('validates Stellar key formats', () => {
    const keypair = StellarSdk.Keypair.random();


    
    expect(isValidPublicKey(keypair.publicKey())).toBe(true);
    expect(isValidSecret(keypair.secret())).toBe(true);
    expect(isValidPublicKey('not-a-stellar-account')).toBe(false);
    expect(isValidSecret('not-a-secret')).toBe(false);
  });

  test('rejects non-positive payment amounts', () => {
    expect(() => assertAmount('0')).toThrow('positive');
    expect(() => assertAmount('-1')).toThrow('positive');
    expect(() => assertAmount('abc')).toThrow('positive');
    expect(() => assertAmount('1.50')).not.toThrow();
  });

  test('builds a fee-bump transaction around signed payment XDR', () => {
    const source = StellarSdk.Keypair.random();
    const destination = StellarSdk.Keypair.random();
    const feeSource = StellarSdk.Keypair.random();
    const account = new StellarSdk.Account(source.publicKey(), '1');

    const payment = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(StellarSdk.Operation.payment({
        destination: destination.publicKey(),
        asset: StellarSdk.Asset.native(),
        amount: '1',
      }))
      .setTimeout(60)
      .build();
    payment.sign(source);

    const feeBump = buildFeeBumpTransaction({
      feeSourceSecret: feeSource.secret(),
      innerTransactionXdr: payment.toXDR(),
    });

    expect(feeBump.feeSource).toBe(feeSource.publicKey());
    expect(feeBump.xdr.length).toBeGreaterThan(0);
  });
});
