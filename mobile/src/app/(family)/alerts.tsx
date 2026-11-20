import { acknowledge, EventRow } from '@/components/care';
import { Muted, Notice, Screen, Title } from '@/components/ui';
import { eventSeverity } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useCare } from '@/lib/useCare';

export default function Alerts() {
  const { api } = useSession();
  const { data, error, refreshing, refresh } = useCare();
  const critical = data?.events.filter((event) => eventSeverity(event) === 'critical') ?? [];
  const warning = data?.events.filter((event) => eventSeverity(event) === 'warning') ?? [];

  return (
    <Screen refreshing={refreshing} onRefresh={() => refresh(true)}>
      <Title sub="Critical events require a check. Warnings should be handled soon.">Alerts</Title>
      {error ? <Notice tone="warn">{error}</Notice> : null}
      {!critical.length && !warning.length ? <Notice>No active alerts. Routine check-ins and completed reminders stay in Activity.</Notice> : null}
      {critical.length ? <Title sub="Possible falls and SOS events.">Critical</Title> : null}
      {critical.map((event) => data && <EventRow key={event.id} event={event} data={data} onAck={(item) => acknowledge(api, item, refresh)} />)}
      {warning.length ? <Title sub="Connection, battery, sensor or missed-response issues.">Warnings</Title> : null}
      {warning.map((event) => data && <EventRow key={event.id} event={event} data={data} onAck={(item) => acknowledge(api, item, refresh)} />)}
      <Muted>Acknowledging stops future escalation. It does not confirm that the person is safe.</Muted>
    </Screen>
  );
}
