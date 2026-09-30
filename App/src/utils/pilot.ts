const rawPilotMode = process.env.EXPO_PUBLIC_PILOT_MODE;

export const PILOT_MODE = rawPilotMode === undefined
  ? true
  : rawPilotMode.toLowerCase() !== 'false';

export const PILOT_ACCESS_CODE =
  process.env.EXPO_PUBLIC_PILOT_ACCESS_CODE?.trim() || '';

export const PILOT_ACCESS_REQUIRED = PILOT_MODE && PILOT_ACCESS_CODE.length > 0;

export const PILOT_NOTICE_TITLE = 'Closed Pilot';

export const PILOT_NOTICE_TEXT =
  'Testnet USDC is for testing only and has no monetary value.';

export const PILOT_TESTNET_TEXT =
  'Closed pilot on Stellar testnet. Testnet USDC has no monetary value.';

export function isPilotAccessCodeValid(input: string): boolean {
  if (!PILOT_ACCESS_REQUIRED) {
    return true;
  }

  return input.trim().toLowerCase() === PILOT_ACCESS_CODE.toLowerCase();
}
