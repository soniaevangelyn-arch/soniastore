import { describe, it, expect } from 'vitest';
import { createNeonClient } from '../src/lib/neonClient.ts';

describe('Neon Auth (Managed Better Auth) - Unit & Integration Tests', () => {
  const client = createNeonClient();
  const validEmail = 'roidjr12@gmail.com';
  const validPassword = 'SoniaAdmin2026!#';

  it('klien harus memiliki metode auth yang lengkap', () => {
    expect(client.auth).toBeDefined();
    expect(['function', 'object']).toContain(typeof client.auth.signIn);
    expect(typeof client.auth.signIn.email).toBe('function');
    expect(['function', 'object']).toContain(typeof client.auth.signUp);
    expect(typeof client.auth.signUp.email).toBe('function');
    expect(typeof client.auth.signOut).toBe('function');
    expect(typeof client.auth.getSession).toBe('function');
    expect(typeof client.auth.signInWithPassword).toBe('function');
    expect(typeof client.auth.onAuthStateChange).toBe('function');
  });

  it('signIn.email() dengan password salah harus ditolak dan mengembalikan error', async () => {
    try {
      const res = await client.auth.signIn.email({
        email: validEmail,
        password: 'WrongPassword123!'
      });
      expect(res.error).toBeDefined();
      expect(res.error).not.toBeNull();
    } catch (err: any) {
      expect(err).toBeDefined();
      expect(err.message).toBeDefined();
    }
  });

  it('signInWithPassword() dengan password salah harus mengembalikan data null dan error', async () => {
    const res = await client.auth.signInWithPassword({
      email: validEmail,
      password: 'PasswordSalahTotal!'
    });

    expect(res.error).toBeDefined();
    expect(res.data?.user).toBeNull();
  });

  it('signUp.email() dengan email yang sudah ada harus ditolak (duplicate email handling)', async () => {
    try {
      const res = await client.auth.signUp.email({
        email: validEmail,
        password: 'NewPassword123!',
        name: 'Admin Test'
      });
      expect(res.error).toBeDefined();
    } catch (err: any) {
      expect(err).toBeDefined();
      expect(err.message).toBeDefined();
    }
  });

  it('signIn.email() dengan kredensial admin yang valid harus berhasil mengembalikan token', async () => {
    const res = await client.auth.signIn.email({
      email: validEmail,
      password: validPassword
    });

    expect(res.error).toBeNull();
    expect(res.data).toBeDefined();
    expect(res.data.token).toBeDefined();
    expect(typeof res.data.token).toBe('string');
    expect(res.data.user?.email).toBe(validEmail);
  });

  it('signInWithPassword() dengan kredensial valid harus mengembalikan objek user dan session yang kompatibel', async () => {
    const res = await client.auth.signInWithPassword({
      email: validEmail,
      password: validPassword
    });

    expect(res.error).toBeNull();
    expect(res.data?.user).toBeDefined();
    expect(res.data?.user?.email).toBe(validEmail);
  });

  it('onAuthStateChange() harus dapat mendaftarkan listener dan mengembalikan unsubscribe', () => {
    let triggered = false;
    const { data } = client.auth.onAuthStateChange((event: string, session: any) => {
      triggered = true;
    });

    expect(data.subscription).toBeDefined();
    expect(typeof data.subscription.unsubscribe).toBe('function');

    data.subscription.unsubscribe();
  });

  it('signOut() harus berhasil mengeksekusi logout tanpa error', async () => {
    const res = await client.auth.signOut();
    expect(res.error).toBeNull();
  });
});
