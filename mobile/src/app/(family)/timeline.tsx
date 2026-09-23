import { acknowledge, EventRow } from '@/components/care';
import { Muted, Notice, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useCare } from '@/lib/useCare';

export default function Timeline() {
  const { api } = useSession();
  const { data, error, refreshing, refresh } = useCare();
  return (
    <Screen refreshing={refreshing} onRefresh={() => refresh(true)}>
      <Title sub="What happened, and what was acknowledged.">Care timeline</Title>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {data?.events.map((event) => <EventRow key={event.id} event={event} data={data} onAck={(e) => acknowledge(api, e, refresh)} />)}
      {data && !data.events.length ? <Muted>A quiet timeline. Check-ins, reminders and alerts will appear here.</Muted> : null}
    </Screen>
  );
}
