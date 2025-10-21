// Cryptographic utilities using Web Crypto API
// Provides secure encryption/decryption for localStorage data

const SALT = 'nudistracker-security-v1';
const ITERATIONS = 100000;

/**
 * Derives a cryptographic key from a user password
 */
async function deriveKey(password: string, salt: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive AES-GCM key using PBKDF2
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return key;
}

/**
 * Encrypts data using AES-GCM with a password
 */
export async function encryptData(data: string, password: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const key = await deriveKey(password, SALT);

    // Generate random IV (Initialization Vector)
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt the data
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(data)
    );

    // Package IV and encrypted data together
    const result = {
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted)),
      version: 1 // For future compatibility
    };

    // Encode as base64 for storage
    return btoa(JSON.stringify(result));
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Error al cifrar los datos');
  }
}

/**
 * Decrypts data using AES-GCM with a password
 */
export async function decryptData(encryptedData: string, password: string): Promise<string> {
  try {
    const decoder = new TextDecoder();
    const key = await deriveKey(password, SALT);

    // Decode from base64 and parse
    const { iv, data } = JSON.parse(atob(encryptedData));

    // Convert arrays back to Uint8Array
    const ivArray = new Uint8Array(iv);
    const dataArray = new Uint8Array(data);

    // Decrypt the data
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivArray },
      key,
      dataArray
    );

    return decoder.decode(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Contraseña incorrecta o datos corruptos');
  }
}

/**
 * Validates if a password can decrypt the stored data
 */
export async function validatePassword(password: string, encryptedData: string): Promise<boolean> {
  try {
    await decryptData(encryptedData, password);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates a hash of the password for quick validation
 * (Not for security, just for UX - to avoid full decryption on every attempt)
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + SALT);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
