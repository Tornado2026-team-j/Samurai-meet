import { clearAuthStorage } from './auth';
import { clearKeyMaterial } from './key-management';
import {
  clearIdentityVerificationChoice,
  clearLanguage,
  clearLocalProfile,
} from './onboarding';

/**
 * Deletes every Samurai Meet value that this client knows how to persist on
 * the current device. It does not call the server and therefore does not
 * delete account data or ciphertext stored in the cloud.
 */
export async function resetDeviceLocalData(userID: string): Promise<void> {
  await Promise.all([
    clearKeyMaterial(userID),
    clearLocalProfile(userID),
    clearIdentityVerificationChoice(userID),
    clearLanguage(),
    clearAuthStorage(),
  ]);
}
