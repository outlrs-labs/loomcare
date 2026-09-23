import { router } from 'expo-router';
import { useState } from 'react';

import { Button, Card, Choice, Field, Muted, Notice, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function SignIn() {
  const { signIn, server: savedServer, setMode } = useSession();
  const [mode, setFormMode] = useState<'login' | 'register'>('login');
  const [server, setServer] = useState(savedServer);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn({ server, email, password, ...(mode === 'register' ? { name, invite } : {}) });
      router.replace('/(family)');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title sub="Your parents keep their independence. You stay connected.">{mode === 'login' ? 'Welcome back' : 'Bring your family closer'}</Title>
      <Choice options={[{ value: 'login', label: 'Sign in' }, { value: 'register', label: 'Create account' }]} value={mode} onChange={setFormMode} />
      <Card>
        {mode === 'register' ? <Field label="Your name" value={name} onChangeText={setName} autoComplete="name" textContentType="name" /> : null}
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" />
        <Field label="Password (12+ characters)" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'login' ? 'current-password' : 'new-password'} textContentType={mode === 'login' ? 'password' : 'newPassword'} />
        {mode === 'register' ? <Field label="Invite code (to join an existing family)" value={invite} onChangeText={setInvite} autoCapitalize="characters" placeholder="ABCD-EFGH-JKMN" /> : null}
        <Field label="LOOMCARE server" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" />
        {error ? <Notice tone="alert">{error}</Notice> : null}
        <Button label={mode === 'login' ? 'Sign in securely' : 'Create my care space'} onPress={submit} busy={busy} disabled={!email || password.length < 12 || !server || (mode === 'register' && !name)} />
      </Card>
      <Button kind="secondary" label="Back" onPress={async () => { await setMode(null); router.replace('/welcome'); }} />
      <Muted>Prototype: use test identities. LOOMCARE is not a certified medical device.</Muted>
    </Screen>
  );
}
